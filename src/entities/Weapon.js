/**
 * WeaponManager — viewmodels, firing, recoil/spread, reloads, ADS/scope.
 *
 * Viewmodels are built procedurally (boxes/cylinders) into the engine's
 * overlay scene so they never clip world geometry. Firing is hitscan:
 * the manager computes a spread-perturbed ray from the camera and hands
 * it to `combat.resolveShot(...)`, which deals damage and spawns impact
 * FX. Recoil is fed back into the player view; spread drives the
 * dynamic crosshair.
 */
import * as THREE from 'three';
import { WEAPONS } from './WeaponData.js';
import { buildWeaponModel } from './WeaponModels.js';

const VM_BASE = new THREE.Vector3(0.2, -0.2, -0.55);

export class WeaponManager {
  constructor(engine, camera, input, audio, player, combat) {
    this.engine = engine;
    this.camera = camera;          // main camera (for ray origin/dir)
    this.input = input;
    this.audio = audio;
    this.player = player;
    this.combat = combat;          // { resolveShot, muzzleFlashWorld }
    this.vmScene = engine.vmScene;
    if (engine.envMap) this.vmScene.environment = engine.envMap;  // reflections on the gun

    this.models = {};              // key -> {group, muzzle, parts}
    this.ammo = {};                // key -> {mag, reserve}
    this.available = [];           // weapon keys the player owns
    this.current = null;
    this.currentModel = null;

    this.cooldown = 0;
    this.reloadTimer = 0;
    this.reloading = false;
    this.swapTimer = 0;
    this.recoilIndex = 0;
    this.sinceShot = 99;
    this.inaccuracy = 0;
    this.scoped = false;
    this.adsAmount = 0;            // 0..1 zoom blend
    this.baseFov = 90;

    // viewmodel animation state
    this.vmPos = VM_BASE.clone();
    this.vmRot = new THREE.Euler(0, 0, 0);
    this.kickBack = 0;             // recoil push along z
    this.swayX = 0; this.swayY = 0;
    this.bobT = 0;
    this.reloadAnim = 0;
    this.equipAnim = 0;
    this.shells = [];
    this.actionT = 0;     // slide/bolt reciprocation per shot (1 -> 0)
    this.pumpT = 0;       // shotgun pump cycle progress (0..1)
    this.breathT = 0;     // idle breathing phase

    // muzzle flash sprite
    this._flash = this._makeFlash();
    this._flashTime = 0;

    this.onShoot = null;          // callback(weapon, originWorld) for noise/AI
    this.onAmmoChange = null;
    this.onReloadStateChange = null;
  }

  /* ----------------------------- ownership ----------------------------- */

  give(keys, refill = true) {
    this.available = keys.slice();
    for (const k of keys) {
      const w = WEAPONS[k];
      if (!this.ammo[k] || refill) {
        this.ammo[k] = { mag: w.magSize === Infinity ? Infinity : w.magSize, reserve: w.reserve };
      }
    }
    if (!this.current || !keys.includes(this.current)) this.equip(keys.find(k => WEAPONS[k].type !== 'melee') || keys[0]);
  }

  refillAll() {
    for (const k of this.available) {
      const w = WEAPONS[k];
      this.ammo[k] = { mag: w.magSize === Infinity ? Infinity : w.magSize, reserve: w.reserve };
    }
    this._emitAmmo();
  }

  equip(key) {
    if (!key || !WEAPONS[key]) return;
    if (this.currentModel) this.currentModel.group.visible = false;
    this.current = key;
    if (!this.models[key]) this.models[key] = this._buildModel(key);
    this.currentModel = this.models[key];
    this.currentModel.group.visible = true;
    this.reloading = false; this.reloadTimer = 0; this.recoilIndex = 0;
    this.scoped = false; this.adsAmount = 0;
    this.swapTimer = WEAPONS[key].swapTime || 0.8;
    this.equipAnim = 1;
    this.engine.setFov?.(this.baseFov);
    this.audio?.reload('charge');
    this._emitAmmo();
  }

  nextWeapon() {
    const i = this.available.indexOf(this.current);
    this.equip(this.available[(i + 1) % this.available.length]);
  }

  get data() { return WEAPONS[this.current]; }
  get curAmmo() { return this.ammo[this.current]; }

  /* ------------------------------ update ------------------------------ */

  update(dt, playerSpeed01, airborne, frozen = false) {
    const w = this.data;
    if (!w) return;
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.swapTimer = Math.max(0, this.swapTimer - dt);
    this.sinceShot += dt;
    this._flashTime = Math.max(0, this._flashTime - dt);
    this._flash.visible = this._flashTime > 0;

    // weapon switching
    if (this.input.pressed('Digit1')) this._equipSlot(1);
    if (this.input.pressed('Digit2')) this._equipSlot(2);
    if (this.input.pressed('Digit3')) this._equipSlot(3);
    if (this.input.pressed('KeyQ')) this.nextWeapon();
    if (this.input.wheel !== 0) this.nextWeapon();

    // reload
    if (this.input.pressed('KeyR')) this.startReload();
    this._updateReload(dt);

    // ADS / scope
    const wantADS = this.input.buttons.right && !this.reloading && this.swapTimer <= 0;
    this._updateADS(dt, wantADS);

    // recoil index decays when not firing
    if (this.sinceShot > 0.18) this.recoilIndex = Math.max(0, this.recoilIndex - dt * 9);

    // firing (disabled during freeze time)
    if (frozen) { /* no shooting */ }
    else if (w.type === 'melee') {
      if (this.input.justClicked.left) this._melee();
    } else {
      const wantFire = w.automatic ? this.input.buttons.left : this.input.justClicked.left;
      if (wantFire && this.cooldown <= 0 && !this.reloading && this.swapTimer <= 0) {
        this._fire(playerSpeed01, airborne);
      }
      // auto-reload on empty trigger pull
      if (this.input.justClicked.left && this.curAmmo.mag === 0 && !this.reloading) {
        this.audio?.dryFire();
        this.startReload();
      }
    }

    // inaccuracy for crosshair
    this._computeInaccuracy(playerSpeed01, airborne);

    this._animate(dt, playerSpeed01, airborne);
    this._updateShells(dt);
  }

  _equipSlot(slot) {
    const k = this.available.find(k => WEAPONS[k].slot === slot);
    if (k && k !== this.current) this.equip(k);
  }

  _computeInaccuracy(speed01, airborne) {
    const w = this.data;
    let inacc = (this.scoped ? w.spread : (w.type === 'sniper' && !this.scoped ? (w.unscopedSpread || 0.09) : w.spread));
    inacc += (w.moveSpread || 0) * speed01;
    if (airborne) inacc += (w.jumpSpread || 0);
    inacc += this.recoilIndex * (w.recoil?.kickUp || 0.01) * 0.6;
    if (this.adsAmount > 0 && w.type !== 'sniper') inacc *= (1 - 0.5 * this.adsAmount);
    this.inaccuracy = inacc;
  }

  /* ------------------------------ firing ------------------------------ */

  _fire(speed01, airborne) {
    const w = this.data;
    const a = this.curAmmo;
    if (a.mag <= 0) { this.audio?.dryFire(); this.startReload(); return; }
    a.mag = a.mag === Infinity ? a.mag : a.mag - 1;
    this.cooldown = 60 / w.fireRate;
    this.sinceShot = 0;
    this.recoilIndex += 1;

    // ray origin/dir from camera
    const origin = new THREE.Vector3();
    this.camera.getWorldPosition(origin);
    const baseDir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion).normalize();

    const pellets = w.pellets || 1;
    for (let p = 0; p < pellets; p++) {
      const dir = this._spreadDir(baseDir, this.inaccuracy);
      this.combat.resolveShot(origin, dir, w, p === 0);
    }

    // recoil to player view
    const rc = w.recoil;
    const rise = Math.min(this.recoilIndex / (rc.rise || 8), 1);
    const up = rc.kickUp * (0.55 + 0.9 * rise);
    const side = rc.kickSide * Math.sin(this.recoilIndex * 0.9) * (0.5 + rise) + (Math.random() - 0.5) * rc.kickSide * 0.5;
    this.player.addRecoil(up, side);
    this.player.addShake(0.01 + up * 0.3);
    this.kickBack = Math.min(0.12, this.kickBack + 0.06 + up);
    this.actionT = 1;                                   // slide/bolt recip
    if (w.type === 'shotgun') this.pumpT = 0.0001;      // begin pump rack

    // muzzle flash + light + sound + shell + noise
    this._muzzleFlash();
    this.audio?.gunshot(w.audio, null);
    if (w.type !== 'sniper') this._ejectShell();
    if (this.scoped && w.type === 'sniper') { this.scoped = false; this._updateADS(0, false); } // bolt unscopes

    if (this.onShoot) this.onShoot(w, origin);
    this._emitAmmo();
  }

  _melee() {
    if (this.cooldown > 0) return;
    const w = this.data;
    this.cooldown = 60 / w.fireRate;
    this.kickBack = 0.06;
    this.reloadAnim = 0; this.swayX += 0.2;
    const origin = new THREE.Vector3(); this.camera.getWorldPosition(origin);
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion).normalize();
    this.combat.resolveShot(origin, dir, w, true, true);
    this.audio?.impact('metal', null);
  }

  _spreadDir(baseDir, inacc) {
    if (inacc <= 0.00001) return baseDir.clone();
    // random point in a cone around baseDir
    const up = Math.abs(baseDir.y) < 0.95 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const right = new THREE.Vector3().crossVectors(baseDir, up).normalize();
    const trueUp = new THREE.Vector3().crossVectors(right, baseDir).normalize();
    // gaussian-ish using two uniforms
    const ang = Math.random() * Math.PI * 2;
    const r = (Math.random() + Math.random()) * 0.5 * inacc;
    const dir = baseDir.clone()
      .addScaledVector(right, Math.cos(ang) * r)
      .addScaledVector(trueUp, Math.sin(ang) * r);
    return dir.normalize();
  }

  /* ------------------------------ reload ------------------------------ */

  startReload() {
    const w = this.data;
    const a = this.curAmmo;
    if (this.reloading || w.magSize === Infinity) return;
    if (a.mag >= w.magSize || a.reserve <= 0) return;
    this.reloading = true;
    this.reloadTimer = w.reloadTime;
    this.reloadAnim = 0;
    this.scoped = false;
    this.audio?.reload('magout');
    this.onReloadStateChange?.(true);
  }

  _updateReload(dt) {
    if (!this.reloading) return;
    const w = this.data, a = this.curAmmo;
    const prev = this.reloadTimer;
    this.reloadTimer -= dt;
    // mid-reload click
    if (prev > w.reloadTime * 0.5 && this.reloadTimer <= w.reloadTime * 0.5) this.audio?.reload('magin');
    if (this.reloadTimer <= 0) {
      const need = w.magSize - a.mag;
      const take = Math.min(need, a.reserve);
      a.mag += take; a.reserve -= take;
      this.reloading = false;
      this.recoilIndex = 0;
      this.audio?.reload('charge');
      this.onReloadStateChange?.(false);
      this._emitAmmo();
    }
  }

  /* ------------------------------- ADS -------------------------------- */

  _updateADS(dt, want) {
    const w = this.data;
    if (w.type === 'sniper') {
      // toggle scope on right-click press
      if (this.input.justClicked.right && !this.reloading && this.swapTimer <= 0) {
        this.scoped = !this.scoped;
        this.audio?.reload('magin');
      }
      const target = this.scoped ? 1 : 0;
      this.adsAmount = THREE.MathUtils.damp(this.adsAmount, target, 18, dt || 0.0001);
      const fov = THREE.MathUtils.lerp(this.baseFov, w.scopeFov, this.adsAmount);
      this.engine.setFov?.(fov);
      this.combat.setScope?.(this.scoped && this.adsAmount > 0.6);
      this.currentModel.group.visible = this.adsAmount < 0.5;
    } else {
      const target = want ? 1 : 0;
      this.adsAmount = THREE.MathUtils.damp(this.adsAmount, target, 14, dt || 0.0001);
      const fov = THREE.MathUtils.lerp(this.baseFov, this.baseFov - 18, this.adsAmount);
      this.engine.setFov?.(fov);
    }
  }

  setBaseFov(f) { this.baseFov = f; if (!this.scoped && this.adsAmount < 0.01) this.engine.setFov?.(f); }

  /* --------------------------- muzzle / shells --------------------------- */

  _makeFlash() {
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: 0xfff0b0, transparent: true, opacity: 0.95, depthTest: false, blending: THREE.AdditiveBlending });
    const star = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.18, 6), mat);
    star.rotation.x = -Math.PI / 2; g.add(star);
    const glow = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 8), new THREE.MeshBasicMaterial({ color: 0xffd070, transparent: true, opacity: 0.7, depthTest: false, blending: THREE.AdditiveBlending }));
    g.add(glow);
    g.visible = false;
    this.vmScene?.add(g);
    return g;
  }

  _muzzleFlash() {
    if (!this.currentModel) return;
    const m = this.currentModel.muzzle;
    this._flash.position.copy(m.position);
    this._flash.rotation.z = Math.random() * Math.PI;
    const s = 0.7 + Math.random() * 0.6;
    this._flash.scale.set(s, s, s);
    this._flashTime = 0.05;
    this._flash.visible = true;
    // world light flash for environment
    const worldMuzzle = new THREE.Vector3();
    this.camera.getWorldPosition(worldMuzzle);
    worldMuzzle.addScaledVector(new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion), 0.6);
    this.combat.muzzleFlashWorld?.(worldMuzzle);
  }

  _ejectShell() {
    const mat = new THREE.MeshStandardMaterial({ color: 0xd9a441, metalness: 0.8, roughness: 0.4 });
    const shell = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.045, 6), mat);
    const m = this.currentModel.muzzle;
    shell.position.set(this.vmPos.x + 0.05, this.vmPos.y + 0.08, this.vmPos.z + 0.25);
    shell.userData.vel = new THREE.Vector3(1.4 + Math.random(), 1.5 + Math.random(), 0.5);
    shell.userData.av = new THREE.Vector3(Math.random() * 20, Math.random() * 20, Math.random() * 20);
    shell.userData.life = 1.2;
    this.vmScene.add(shell);
    this.shells.push(shell);
  }

  _updateShells(dt) {
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const s = this.shells[i];
      s.userData.life -= dt;
      s.userData.vel.y -= 9 * dt;
      s.position.addScaledVector(s.userData.vel, dt);
      s.rotation.x += s.userData.av.x * dt;
      s.rotation.y += s.userData.av.y * dt;
      if (s.userData.life <= 0) { this.vmScene.remove(s); s.geometry.dispose(); this.shells.splice(i, 1); }
    }
  }

  /* ----------------------------- animation ----------------------------- */

  _animate(dt, speed01, airborne) {
    this.swayX = THREE.MathUtils.damp(this.swayX, 0, 8, dt);
    this.swayY = THREE.MathUtils.damp(this.swayY, 0, 8, dt);
    this.kickBack = THREE.MathUtils.damp(this.kickBack, 0, 14, dt);  // snappier recovery
    this.equipAnim = THREE.MathUtils.damp(this.equipAnim, 0, 6, dt);
    this.actionT = THREE.MathUtils.damp(this.actionT, 0, 26, dt);

    // bob
    this.bobT += dt * (6 + speed01 * 8);
    const bobX = Math.cos(this.bobT) * 0.012 * speed01;
    const bobY = Math.abs(Math.sin(this.bobT)) * 0.012 * speed01;

    // idle breathing (fades out as you move)
    this.breathT += dt * 1.5;
    const idle = 1 - Math.min(1, speed01 * 3);
    const breatheY = Math.sin(this.breathT) * 0.006 * idle;
    const breatheX = Math.cos(this.breathT * 0.7) * 0.004 * idle;

    // reload dip
    let reloadDipY = 0, reloadRot = 0;
    if (this.reloading) {
      const w = this.data;
      const t = 1 - this.reloadTimer / w.reloadTime; // 0..1
      const dip = Math.sin(t * Math.PI);
      reloadDipY = -0.12 * dip;
      reloadRot = -0.5 * dip;
    }
    // equip raise
    const equipY = -0.25 * this.equipAnim;
    const equipRot = 0.6 * this.equipAnim;

    // ADS: pull the weapon toward the eye/centre
    const ads = this.adsAmount;
    const adsX = -VM_BASE.x * 0.85 * ads;
    const adsY = (-VM_BASE.y - 0.04) * 0.5 * ads;
    const adsZ = 0.1 * ads;

    const g = this.currentModel.group;
    const tgtX = VM_BASE.x + bobX + breatheX + this.swayX * 0.06 + adsX;
    const tgtY = VM_BASE.y + bobY + breatheY + reloadDipY + equipY + this.swayY * 0.06 + adsY;
    const tgtZ = VM_BASE.z + this.kickBack + adsZ;
    g.position.set(
      THREE.MathUtils.damp(g.position.x, tgtX, 18, dt),
      THREE.MathUtils.damp(g.position.y, tgtY, 18, dt),
      THREE.MathUtils.damp(g.position.z, tgtZ, 18, dt));
    g.rotation.set(
      THREE.MathUtils.damp(g.rotation.x, reloadRot * 0.4 - this.kickBack * 2.4, 16, dt),
      THREE.MathUtils.damp(g.rotation.y, equipRot * 0.3 + reloadRot * 0.3, 16, dt),
      THREE.MathUtils.damp(g.rotation.z, reloadRot - this.swayX * 0.04, 16, dt));

    this._animateParts(dt);

    // keep flash glued to muzzle (vmScene is the root, so world == scene space)
    if (this._flash.visible) {
      g.updateMatrixWorld(true);
      this.currentModel.muzzle.getWorldPosition(this._flash.position);
    }
  }

  // Reciprocating slide / bolt / pump action on the current viewmodel.
  _animateParts(dt) {
    const p = this.currentModel.parts;
    if (!p) return;
    if (this.pumpT > 0) { this.pumpT += dt * 2.6; if (this.pumpT >= 1) this.pumpT = 0; }
    // parts reciprocate along the gun's length (design-space X, toward shooter)
    if (p.slide) p.slide.position.x = (p.slideBase ?? 0) - this.actionT * 0.04;   // pistol blowback
    if (p.bolt) p.bolt.position.x = (p.boltBase ?? 0) - this.actionT * 0.03;      // rifle/sniper bolt
    if (p.pump) p.pump.position.x = (p.pumpBase ?? 0) - Math.sin(this.pumpT * Math.PI) * 0.1; // shotgun rack
  }

  addLookSway(dx, dy) { this.swayX += -dx * 0.0006; this.swayY += dy * 0.0006; }

  _emitAmmo() {
    if (!this.onAmmoChange) return;
    const a = this.curAmmo;
    this.onAmmoChange(this.data, a ? a.mag : 0, a ? a.reserve : 0, this.reloading);
  }

  /* --------------------------- viewmodel builders --------------------------- */

  _buildModel(key) {
    const built = buildWeaponModel(WEAPONS[key]);
    built.group.position.copy(VM_BASE);
    built.group.visible = false;
    this.vmScene.add(built.group);
    return { group: built.group, muzzle: built.muzzle, parts: built.parts, eject: built.eject, key };
  }
}
