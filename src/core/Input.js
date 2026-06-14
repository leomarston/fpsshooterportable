/**
 * Input — keyboard state, accumulated mouse look deltas, mouse buttons,
 * and Pointer Lock management. Look deltas are consumed once per frame.
 */
export class Input {
  constructor(domElement) {
    this.dom = domElement;
    this.kind = 'keyboard';
    this.keys = new Set();
    this.justPressed = new Set();   // edge-triggered, cleared each frame
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.buttons = { left: false, right: false };
    this.justClicked = { left: false, right: false };
    this.wheel = 0;
    this.locked = false;
    this.enabled = false;           // gameplay reads input only when enabled
    this.invertY = false;
    this.sensitivity = 1.0;

    this.onLockChange = null;       // callback(locked)

    this._bind();
  }

  _bind() {
    addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      const k = e.code;
      if (!this.keys.has(k)) this.justPressed.add(k);
      this.keys.add(k);
      // Prevent page scroll on space / arrows.
      if (['Space', 'ArrowUp', 'ArrowDown', 'Tab'].includes(k)) e.preventDefault();
    });
    addEventListener('keyup', (e) => { this.keys.delete(e.code); });

    document.addEventListener('mousemove', (e) => {
      if (!this.locked || !this.enabled) return;
      const s = this.sensitivity;
      this.mouseDX += e.movementX * s;
      this.mouseDY += (this.invertY ? -e.movementY : e.movementY) * s;
    });

    this.dom.addEventListener('mousedown', (e) => {
      if (!this.locked || !this.enabled) return;
      if (e.button === 0) { this.buttons.left = true; this.justClicked.left = true; }
      if (e.button === 2) { this.buttons.right = true; this.justClicked.right = true; }
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) this.buttons.left = false;
      if (e.button === 2) this.buttons.right = false;
    });
    this.dom.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('wheel', (e) => { if (this.enabled && this.locked) this.wheel += Math.sign(e.deltaY); }, { passive: true });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.dom;
      if (!this.locked) { this.buttons.left = this.buttons.right = false; this.keys.clear(); }
      this.onLockChange?.(this.locked);
    });
  }

  requestLock() {
    if (document.pointerLockElement !== this.dom) {
      const p = this.dom.requestPointerLock?.();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    }
  }
  exitLock() { if (document.pointerLockElement) document.exitPointerLock(); }

  update() { /* keyboard/mouse is event-driven; gamepads poll here */ }

  // Edge-trigger helpers
  pressed(code) { return this.justPressed.has(code); }
  down(code) { return this.keys.has(code); }

  // Source-agnostic analog move axis: forward (+W/-S), strafe (+D/-A).
  moveAxis() {
    return {
      f: (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0),
      s: (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0),
    };
  }

  // Consume look deltas (call once per frame, then reset).
  consumeLook() {
    const dx = this.mouseDX, dy = this.mouseDY;
    this.mouseDX = 0; this.mouseDY = 0;
    return { dx, dy };
  }

  // Clear per-frame edge state. Call at end of frame.
  endFrame() {
    this.justPressed.clear();
    this.justClicked.left = false;
    this.justClicked.right = false;
    this.wheel = 0;
  }
}
