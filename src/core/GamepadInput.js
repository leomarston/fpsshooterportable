/**
 * GamepadInput — drives a player from a gamepad while exposing the same
 * interface as the keyboard/mouse Input (down/pressed/moveAxis/consumeLook/
 * buttons/justClicked/endFrame/update), so Player and WeaponManager don't
 * care which device a player uses.
 *
 * Standard mapping: left stick = move, right stick = look, RT = fire,
 * LT = aim, A = jump, B = crouch, X = reload, Y = switch, D-pad = weapon
 * slots / pickup, Back = buy, Start = pause.
 */
const DEAD = 0.20;
const GP_LOOK = 1500;   // right-stick -> look (radians/sec feel, scaled by sens)

function dz(v) { return Math.abs(v) < DEAD ? 0 : (v - Math.sign(v) * DEAD) / (1 - DEAD); }

// gamepad button index -> our action "code"
const BTN = {
  0: 'Space',        // A  -> jump
  1: 'ControlLeft',  // B  -> crouch
  2: 'KeyR',         // X  -> reload
  3: 'KeyQ',         // Y  -> switch weapon
  4: 'Slot:prev',    // LB
  5: 'Slot:next',    // RB
  8: 'KeyB',         // Back  -> buy
  9: 'Escape',       // Start -> pause
  12: 'Digit1',      // D-up
  13: 'KeyG',        // D-down -> pickup
  14: 'Digit2',      // D-left
  15: 'Digit3',      // D-right
};

export class GamepadInput {
  constructor(index) {
    this.index = index;
    this.kind = 'gamepad';
    this.enabled = false;
    this.locked = true;          // no pointer lock; satisfies lock checks
    this.invertY = false;
    this.sensitivity = 1.0;
    this.keys = new Set();
    this.justPressed = new Set();
    this._prev = new Set();
    this.buttons = { left: false, right: false };
    this.justClicked = { left: false, right: false };
    this._prevLeft = false; this._prevRight = false;
    this.wheel = 0;
    this._lookDX = 0; this._lookDY = 0;
    this._axis = { f: 0, s: 0 };
  }

  get connected() {
    const gp = navigator.getGamepads ? navigator.getGamepads()[this.index] : null;
    return !!(gp && gp.connected);
  }

  update(dt) {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = pads[this.index];
    this.justPressed.clear();
    if (!gp || !gp.connected) { this.keys.clear(); this._axis = { f: 0, s: 0 }; this.buttons.left = this.buttons.right = false; return; }

    // movement (left stick): forward = up = -axisY
    this._axis = { f: -dz(gp.axes[1] || 0), s: dz(gp.axes[0] || 0) };

    // look (right stick) accumulates like mouse delta
    const rx = dz(gp.axes[2] || 0), ry = dz(gp.axes[3] || 0);
    const k = GP_LOOK * this.sensitivity * (dt || 0.016) / 0.0022; // undo Player's baseSens
    this._lookDX += rx * k * 0.0022;     // -> ~radians via Player baseSens
    this._lookDY += (this.invertY ? -ry : ry) * k * 0.0022;

    // buttons -> codes (with edge detection)
    const now = new Set();
    for (const idxStr in BTN) {
      const i = +idxStr; const b = gp.buttons[i];
      if (b && b.pressed) {
        const code = BTN[i];
        now.add(code);
        if (!this._prev.has(code)) this.justPressed.add(code);
      }
    }
    this.keys = now; this._prev = now;

    // triggers -> fire / aim
    const rt = (gp.buttons[7] && gp.buttons[7].value) || 0;
    const lt = (gp.buttons[6] && gp.buttons[6].value) || 0;
    this.buttons.left = rt > 0.5;
    this.buttons.right = lt > 0.5;
    this.justClicked.left = this.buttons.left && !this._prevLeft;
    this.justClicked.right = this.buttons.right && !this._prevRight;
    this._prevLeft = this.buttons.left; this._prevRight = this.buttons.right;
  }

  pressed(code) {
    // LB/RB report as Slot:prev/next; treat as KeyQ cycle too
    if (code === 'KeyQ') return this.justPressed.has('KeyQ') || this.justPressed.has('Slot:next') || this.justPressed.has('Slot:prev');
    return this.justPressed.has(code);
  }
  down(code) { return this.keys.has(code); }
  moveAxis() { return this._axis; }

  consumeLook() {
    const dx = this._lookDX, dy = this._lookDY;
    this._lookDX = 0; this._lookDY = 0;
    return { dx, dy };
  }

  endFrame() {
    this.justClicked.left = false; this.justClicked.right = false; this.wheel = 0;
  }

  // no-ops for API parity
  requestLock() {}
  exitLock() {}
}
