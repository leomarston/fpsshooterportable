/**
 * Player — first-person controller.
 *
 * Quake/CS-flavoured movement (ground friction + capped acceleration,
 * limited air control), mouse look with pitch clamp, crouch/sprint/jump,
 * view-bob, landing/recoil camera shake, and footstep noise the bots can
 * "hear". The camera lives at the eye; bullets are cast from it.
 */
import * as THREE from 'three';

const STAND_H = 1.78, CROUCH_H = 1.25;
const STAND_EYE = 1.62, CROUCH_EYE = 1.05;
const RADIUS = 0.42;

export class Player {
  constructor(camera, input, world, audio) {
    this.camera = camera;
    this.input = input;
    this.world = world;
    this.audio = audio;

    this.feet = new THREE.Vector3(0, 0, 0);
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0;
    this.onGround = false;
    this.crouch = false;
    this.height = STAND_H;
    this.eye = STAND_EYE;
    this.surface = 'sand';

    this.maxHealth = 100; this.health = 100;
    this.maxArmor = 100; this.armor = 100;
    this.alive = true;

    // tuning (metres, seconds)
    this.runSpeed = 7.2;
    this.walkSpeed = 3.6;
    this.crouchSpeed = 2.6;
    this.accel = 85;
    this.airAccel = 16;
    this.friction = 9.5;
    this.gravity = 20;
    this.jumpVel = 6.2;

    this.baseSens = 0.0022;
    this.bobPhase = 0; this.bobAmt = 0;
    this.shake = new THREE.Vector3();
    this.shakeDecay = 12;
    this.recoilPitch = 0; this.recoilYaw = 0;

    this._stepDist = 0;
    this._wasAir = false;
    this.noise = 0;            // current noise emission (decays); bots sample it
    this.lastFootstep = 0;
    this.damageDir = null;     // last hit direction (for HUD)
    this.fovKick = 0;          // additive fov for sprint/landing

    this.eyePos = new THREE.Vector3();
  }

  reset(pos) {
    this.feet.copy(pos);
    this.vel.set(0, 0, 0);
    this.health = this.maxHealth; this.armor = this.maxArmor;
    this.alive = true; this.crouch = false;
    this.height = STAND_H; this.eye = STAND_EYE;
    this.recoilPitch = this.recoilYaw = 0;
    this.shake.set(0, 0, 0);
  }

  setLookFrom(targetPos) {
    // face a target position from current feet (used on spawn)
    const dir = new THREE.Vector3().subVectors(targetPos, this.feet);
    this.yaw = Math.atan2(-dir.x, -dir.z);
    this.pitch = 0;
  }

  addShake(amount) {
    this.shake.x += (Math.random() - 0.5) * amount;
    this.shake.y += (Math.random() - 0.5) * amount;
    this.shake.z += (Math.random() - 0.5) * amount * 0.5;
  }

  // recoil applied by weapons (radians)
  addRecoil(pitch, yaw) { this.recoilPitch += pitch; this.recoilYaw += yaw; }

  takeDamage(amount, fromPos, headshot = false) {
    if (!this.alive) return;
    // armor absorbs a portion
    let dmg = amount;
    if (this.armor > 0) {
      const absorbed = Math.min(this.armor, dmg * 0.5);
      this.armor -= absorbed;
      dmg -= absorbed;
    }
    this.health -= dmg;
    this.addShake(0.06 + amount * 0.004);
    if (fromPos) {
      const dir = new THREE.Vector3().subVectors(fromPos, this.eyePos);
      this.damageDir = Math.atan2(dir.x, -dir.z) - this.yaw;
    }
    if (this.health <= 0) { this.health = 0; this.alive = false; }
  }

  _wishDir() {
    const a = this.input.moveAxis ? this.input.moveAxis() : { f: 0, s: 0 };
    let f = a.f, s = a.s;
    const mag = Math.hypot(f, s);
    if (mag > 1) { f /= mag; s /= mag; }    // clamp analog diagonals
    // forward/right in world space from yaw
    const sinY = Math.sin(this.yaw), cosY = Math.cos(this.yaw);
    // forward = (-sinY, 0, -cosY); right = (cosY, 0, -sinY)
    const dir = new THREE.Vector3(
      (-sinY) * f + (cosY) * s, 0, (-cosY) * f + (-sinY) * s);
    if (dir.lengthSq() > 0) dir.normalize();
    return dir;
  }

  update(dt, opts = {}) {
    if (!this.alive) { this._updateCamera(dt, true); return; }
    const inp = this.input;

    // --- mouse look ---
    const look = inp.consumeLook();
    this.yaw -= look.dx * this.baseSens;
    this.pitch -= look.dy * this.baseSens;
    const lim = Math.PI / 2 - 0.04;
    this.pitch = THREE.MathUtils.clamp(this.pitch, -lim, lim);

    // recoil recovery
    this.recoilPitch = THREE.MathUtils.damp(this.recoilPitch, 0, 9, dt);
    this.recoilYaw = THREE.MathUtils.damp(this.recoilYaw, 0, 9, dt);

    // --- crouch ---
    const wantCrouch = inp.down('ControlLeft') || inp.down('KeyC');
    const targetH = wantCrouch ? CROUCH_H : STAND_H;
    if (!wantCrouch && this.height < STAND_H) {
      // only stand if there's room
      const test = this.feet.clone();
      if (this.world.isFree(test, RADIUS, STAND_H)) this.crouch = false;
    } else this.crouch = wantCrouch;
    const goalH = this.crouch ? CROUCH_H : STAND_H;
    this.height = THREE.MathUtils.damp(this.height, goalH, 14, dt);
    this.eye = THREE.MathUtils.damp(this.eye, this.crouch ? CROUCH_EYE : STAND_EYE, 14, dt);

    // --- movement ---
    const sprint = inp.down('ShiftLeft') === false; // shift = slow/quiet walk in CS
    const walking = inp.down('ShiftLeft');
    let maxSpeed = this.crouch ? this.crouchSpeed : (walking ? this.walkSpeed : this.runSpeed);
    if (opts.aiming) maxSpeed *= 0.5;
    if (opts.frozen) maxSpeed = 0;          // freeze time: look but don't move
    const wish = opts.frozen ? new THREE.Vector3() : this._wishDir();

    if (this.onGround) {
      // friction
      const speed = Math.hypot(this.vel.x, this.vel.z);
      if (speed > 0.01) {
        const drop = speed * this.friction * dt;
        const ns = Math.max(speed - drop, 0) / speed;
        this.vel.x *= ns; this.vel.z *= ns;
      } else { this.vel.x = this.vel.z = 0; }
      // accelerate
      this._accelerate(wish, maxSpeed, this.accel, dt);
      // jump
      if (!opts.frozen && inp.down('Space')) {
        this.vel.y = this.jumpVel; this.onGround = false;
        this.audio?.footstep(this.surface, this.eyePos);
      }
    } else {
      this._accelerate(wish, maxSpeed, this.airAccel, dt);
      this.vel.y -= this.gravity * dt;
    }

    // integrate with collision
    const disp = new THREE.Vector3(this.vel.x * dt, this.vel.y * dt, this.vel.z * dt);
    const res = this.world.moveAABB(this.feet, RADIUS, this.height, disp);
    this.surface = res.surface || this.surface;

    if (res.onGround) {
      if (!this._wasAir === false && this.vel.y < -6) {
        // landed hard
        this.addShake(Math.min(0.12, -this.vel.y * 0.012));
        this.audio?.footstep(this.surface, this.eyePos);
        this.emitNoise(0.6);
      }
      this.vel.y = 0; this.onGround = true; this._wasAir = false;
    } else {
      this.onGround = false; this._wasAir = true;
    }
    if (res.ceiling && this.vel.y > 0) this.vel.y = 0;

    // --- footsteps & noise ---
    const horiz = Math.hypot(this.vel.x, this.vel.z);
    if (this.onGround && horiz > 0.6) {
      this._stepDist += horiz * dt;
      const stride = this.crouch ? 2.6 : (walking ? 2.4 : 1.9);
      if (this._stepDist > stride) {
        this._stepDist = 0;
        if (!walking) { this.audio?.footstep(this.surface, this.eyePos); }
        // noise: running is loud, walking/crouch quiet
        this.emitNoise(this.crouch ? 0.15 : walking ? 0.25 : 1.0);
      }
    }
    // bob
    if (this.onGround && horiz > 0.6) {
      this.bobPhase += dt * (8 + horiz);
      this.bobAmt = THREE.MathUtils.damp(this.bobAmt, Math.min(horiz / this.runSpeed, 1), 8, dt);
    } else {
      this.bobAmt = THREE.MathUtils.damp(this.bobAmt, 0, 8, dt);
    }

    // fov kick toward sprint
    const targetFov = (!walking && !this.crouch && horiz > this.runSpeed * 0.7) ? 4 : 0;
    this.fovKick = THREE.MathUtils.damp(this.fovKick, targetFov, 6, dt);

    // noise decay
    this.noise = Math.max(0, this.noise - dt * 4);

    this._updateCamera(dt);
  }

  emitNoise(level) { this.noise = Math.max(this.noise, level); }

  _accelerate(wish, maxSpeed, accel, dt) {
    const curSpeed = this.vel.x * wish.x + this.vel.z * wish.z;
    const add = maxSpeed - curSpeed;
    if (add <= 0) return;
    let accelSpeed = accel * dt * maxSpeed;
    if (accelSpeed > add) accelSpeed = add;
    this.vel.x += wish.x * accelSpeed;
    this.vel.z += wish.z * accelSpeed;
  }

  _updateCamera(dt, dead = false) {
    // shake decay
    this.shake.multiplyScalar(Math.max(0, 1 - this.shakeDecay * dt));

    this.eyePos.set(this.feet.x, this.feet.y + this.eye, this.feet.z);

    // view bob offsets
    const bobY = Math.sin(this.bobPhase * 2) * 0.045 * this.bobAmt;
    const bobX = Math.cos(this.bobPhase) * 0.035 * this.bobAmt;

    this.camera.position.set(
      this.eyePos.x + bobX + this.shake.x,
      this.eyePos.y + bobY + this.shake.y,
      this.eyePos.z + this.shake.z);

    let pitch = this.pitch + this.recoilPitch;
    let yaw = this.yaw + this.recoilYaw;
    if (dead) pitch = THREE.MathUtils.damp(pitch, -0.5, 4, dt); // fall view
    this.camera.rotation.set(pitch, yaw, this.shake.z * 0.5, 'YXZ');
  }

  get position() { return this.feet; }
  forward() { return new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); }
}
