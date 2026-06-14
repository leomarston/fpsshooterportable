/**
 * KeyboardInput2 — Player 2 on the SAME keyboard, exposing the same
 * interface as the Player 1 Input so Player/WeaponManager work unchanged.
 *
 * Controls (right side of the keyboard):
 *   Move  : I/J/K/L  (I fwd, K back, J left, L right)
 *   Look  : Arrow keys (← → turn, ↑ ↓ pitch)   [keyboard turn]
 *   Fire  : Right Shift     Aim/scope : /  (Slash)
 *   Reload: P   Switch : O   Jump : '  Crouch : .   Buy : U   Pickup : Y
 */
const TURN_YAW = 2.6;     // rad/s keyboard turn
const TURN_PITCH = 1.9;
const BASE_SENS = 0.0022; // matches Player.baseSens

// canonical action code -> P2 physical key code
const MAP = {
  Space: 'Quote',         // jump
  ControlLeft: 'Period',  // crouch
  KeyC: 'Period',
  KeyR: 'KeyP',           // reload
  KeyQ: 'KeyO',           // switch weapon
  KeyG: 'KeyY',           // pickup
  KeyB: 'KeyU',           // buy
};
const P2_KEYS = new Set(['KeyI', 'KeyJ', 'KeyK', 'KeyL', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'ShiftRight', 'Slash', 'KeyP', 'KeyO', 'Quote', 'Period', 'KeyU', 'KeyY']);

export class KeyboardInput2 {
  constructor() {
    this.kind = 'keyboard';
    this.pointer = false;        // P2 has no mouse → navigates menus by keyboard
    this.locked = true;          // no pointer lock for P2
    this.enabled = false;
    this.invertY = false;
    this.sensitivity = 1.0;
    this.keys = new Set();
    this.justPressed = new Set();
    this.buttons = { left: false, right: false };
    this.justClicked = { left: false, right: false };
    this._prevFire = false; this._prevAim = false;
    this.wheel = 0;
    this._lookDX = 0; this._lookDY = 0;
    this._bind();
  }

  _bind() {
    addEventListener('keydown', (e) => {
      if (!this.enabled || !P2_KEYS.has(e.code)) return;
      if (!this.keys.has(e.code)) this.justPressed.add(e.code);
      this.keys.add(e.code);
      if (e.code.startsWith('Arrow') || e.code === 'Quote') e.preventDefault();
    });
    addEventListener('keyup', (e) => { this.keys.delete(e.code); });
  }

  update(dt) {
    // keyboard-turn look from arrow keys, in mouse-delta units
    let yaw = 0, pitch = 0;
    if (this.keys.has('ArrowLeft')) yaw += 1;
    if (this.keys.has('ArrowRight')) yaw -= 1;
    if (this.keys.has('ArrowUp')) pitch -= 1;
    if (this.keys.has('ArrowDown')) pitch += 1;
    const k = (dt || 0.016) / BASE_SENS * this.sensitivity;
    this._lookDX += yaw * TURN_YAW * k;
    this._lookDY += (this.invertY ? -pitch : pitch) * TURN_PITCH * k;
    // fire / aim edges
    const fire = this.keys.has('ShiftRight'), aim = this.keys.has('Slash');
    this.buttons.left = fire; this.buttons.right = aim;
    this.justClicked.left = fire && !this._prevFire;
    this.justClicked.right = aim && !this._prevAim;
    this._prevFire = fire; this._prevAim = aim;
  }

  moveAxis() {
    return {
      f: (this.keys.has('KeyI') ? 1 : 0) - (this.keys.has('KeyK') ? 1 : 0),
      s: (this.keys.has('KeyL') ? 1 : 0) - (this.keys.has('KeyJ') ? 1 : 0),
    };
  }
  down(code) { const k = MAP[code]; return k ? this.keys.has(k) : false; }
  pressed(code) { const k = MAP[code]; return k ? this.justPressed.has(k) : false; }

  consumeLook() { const dx = this._lookDX, dy = this._lookDY; this._lookDX = 0; this._lookDY = 0; return { dx, dy }; }
  endFrame() { this.justPressed.clear(); this.justClicked.left = false; this.justClicked.right = false; this.wheel = 0; }
  requestLock() {} exitLock() {}
}
