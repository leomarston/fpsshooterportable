/**
 * Enemy bots + EnemyManager.
 *
 * Each bot is a primitive-built humanoid with a separate head hitbox
 * (headshots). A finite-state AI (idle → hunt → engage → reload/cover)
 * drives it: it perceives the player via an FoV cone + line-of-sight and
 * by *hearing* the player's footstep/gunfire noise, paths to the last
 * known position with A*, and shoots back with difficulty-scaled aim,
 * reaction time and recoil. Bullets are hitscan and respect cover.
 */
import * as THREE from 'three';
import { roundedBox, capsule } from '../core/Geo.js';

const EYE = 1.55, HEIGHT = 1.75, RADIUS = 0.4;

let _id = 0;

export class Enemy {
  constructor(scene, opts) {
    this.id = _id++;
    this.scene = scene;
    this.cfg = opts;                     // difficulty config + weapon stats
    this.feet = opts.spawn.clone();
    this.vel = new THREE.Vector3();
    this.onGround = false;

    this.maxHealth = opts.health;
    this.health = opts.health;
    this.dead = false;
    this.deadTime = 0;

    this.state = 'idle';
    this.stateTime = 0;
    this.aimYaw = Math.random() * Math.PI * 2;
    this.aimPitch = 0;
    this.lastKnown = null;               // Vector3 last seen/heard player pos
    this.lastSeen = -99;
    this.alert = 0;                       // 0..1 awareness
    this.path = null; this.pathIdx = 0;
    this.repathTimer = 0;
    this.reactionTimer = 0;
    this.fireCooldown = 0.4 + Math.random() * 0.5;
    this.burstLeft = 0;
    this.burstPause = 0;
    this.mag = opts.weapon.magSize === Infinity ? 30 : opts.weapon.magSize;
    this.reloadTimer = 0;
    this.strafeDir = Math.random() < 0.5 ? 1 : -1;
    this.strafeTimer = 0;
    this.muzzleFlashT = 0;

    this._tmp = new THREE.Vector3();
    this._build();
  }

  _build() {
    const g = new THREE.Group();
    this.group = g;
    const env = 1.0;
    const skin = new THREE.MeshStandardMaterial({ color: 0x9c7a55, roughness: 0.62, metalness: 0.0 });
    const clothCol = this.cfg.color || 0x555a48;
    const cloth = new THREE.MeshStandardMaterial({ color: clothCol, roughness: 0.85, metalness: 0.05, envMapIntensity: env });
    const clothDark = new THREE.MeshStandardMaterial({ color: 0x3a3e30, roughness: 0.8, metalness: 0.05 });
    const vest = new THREE.MeshStandardMaterial({ color: 0x262922, roughness: 0.55, metalness: 0.3, envMapIntensity: env });
    const rubber = new THREE.MeshStandardMaterial({ color: 0x14140f, roughness: 0.8, metalness: 0.1 });
    const accent = new THREE.MeshStandardMaterial({ color: 0xc23a2c, roughness: 0.5, metalness: 0.2, emissive: 0x4a0e07, emissiveIntensity: 0.5 }); // red = hostile readability
    const gunMat = new THREE.MeshStandardMaterial({ color: 0x17191d, roughness: 0.45, metalness: 0.65, envMapIntensity: env });
    const glove = new THREE.MeshStandardMaterial({ color: 0x2a2c26, roughness: 0.7, metalness: 0.1 });

    const add = (mesh, parent = g) => { mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh; };
    const M = (geo, mat) => new THREE.Mesh(geo, mat);

    // ---------- legs (groups pivot at the hip) ----------
    const buildLeg = (side) => {
      const leg = new THREE.Group();
      leg.position.set(0.13 * side, 0.92, 0);
      const thigh = add(M(capsule(0.13, 0.34, 6, 12), cloth), leg); thigh.position.y = -0.28;
      const knee = add(M(new THREE.SphereGeometry(0.12, 12, 10), clothDark), leg); knee.position.y = -0.5;
      const shin = add(M(capsule(0.11, 0.32, 6, 12), clothDark), leg); shin.position.y = -0.7;
      const boot = add(M(roundedBox(0.18, 0.18, 0.34, 0.06), rubber), leg); boot.position.set(0, -0.9, 0.05);
      // knee pad
      const pad = add(M(roundedBox(0.16, 0.16, 0.05, 0.04), clothDark), leg); pad.position.set(0, -0.5, 0.11);
      g.add(leg); return leg;
    };
    this.legL = buildLeg(-1);
    this.legR = buildLeg(1);

    // ---------- pelvis + belt ----------
    add(M(roundedBox(0.42, 0.26, 0.3, 0.1), clothDark)).position.set(0, 0.98, 0);
    const belt = add(M(new THREE.TorusGeometry(0.22, 0.045, 8, 20), vest)); belt.rotation.x = Math.PI / 2; belt.position.y = 0.92; belt.scale.z = 0.72;

    // ---------- torso ----------
    this.torso = add(M(capsule(0.22, 0.34, 8, 16), cloth)); this.torso.position.y = 1.2; this.torso.scale.set(1.05, 1, 0.72);
    // tactical vest shell
    const vestShell = add(M(roundedBox(0.5, 0.5, 0.34, 0.1), vest)); vestShell.position.set(0, 1.22, 0.01);
    // chest pouches
    for (const px of [-0.13, 0.13]) { const p = add(M(roundedBox(0.13, 0.16, 0.08, 0.03), clothDark)); p.position.set(px, 1.12, 0.2); }
    // red readability stripe + collar
    const stripe = add(M(roundedBox(0.52, 0.07, 0.36, 0.03), accent)); stripe.position.set(0, 1.38, 0);
    add(M(new THREE.CylinderGeometry(0.1, 0.12, 0.12, 12), skin)).position.set(0, 1.5, 0); // neck
    // backpack / radio
    const pack = add(M(roundedBox(0.32, 0.34, 0.16, 0.06), clothDark)); pack.position.set(0, 1.2, -0.22);
    const antenna = add(M(new THREE.CylinderGeometry(0.008, 0.008, 0.4, 6), gunMat)); antenna.position.set(0.12, 1.5, -0.26);

    // ---------- shoulders + arms ----------
    const buildArm = (side) => {
      const arm = new THREE.Group();
      arm.position.set(0.3 * side, 1.42, 0);
      const shoulder = add(M(new THREE.SphereGeometry(0.14, 12, 10), cloth), arm); shoulder.position.y = 0.02;
      const upper = add(M(capsule(0.1, 0.22, 6, 12), cloth), arm); upper.position.y = -0.18;
      const elbow = add(M(new THREE.SphereGeometry(0.095, 10, 8), clothDark), arm); elbow.position.y = -0.36;
      const fore = add(M(capsule(0.085, 0.2, 6, 12), clothDark), arm); fore.position.y = -0.5;
      const hand = add(M(new THREE.SphereGeometry(0.085, 10, 8), glove), arm); hand.position.y = -0.66;
      // shoulder pad
      const pad = add(M(roundedBox(0.18, 0.12, 0.2, 0.05), vest), arm); pad.position.set(0.02 * side, 0.04, 0);
      if (side < 0) { const band = add(M(new THREE.TorusGeometry(0.1, 0.025, 8, 16), accent), arm); band.position.y = -0.18; band.rotation.y = Math.PI / 2; } // red armband on left
      g.add(arm); return arm;
    };
    this.armL = buildArm(-1);
    this.armR = buildArm(1);

    // ---------- head + helmet ----------
    this.head = add(M(new THREE.SphereGeometry(0.135, 16, 14), skin)); this.head.position.y = 1.63; this.head.scale.set(0.92, 1.05, 1.0);
    const helmet = add(M(new THREE.SphereGeometry(0.155, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.62), vest));
    helmet.position.y = 1.66;
    const helmRim = add(M(new THREE.TorusGeometry(0.15, 0.022, 8, 18), clothDark)); helmRim.rotation.x = Math.PI / 2; helmRim.position.y = 1.62;
    // NVG mount + red visor (readability)
    add(M(roundedBox(0.07, 0.06, 0.07, 0.02), clothDark)).position.set(0, 1.72, 0.12);
    const visor = add(M(roundedBox(0.2, 0.05, 0.04, 0.02), accent)); visor.position.set(0, 1.62, 0.13);
    // ear cups
    for (const s of [-1, 1]) add(M(new THREE.SphereGeometry(0.05, 10, 8), clothDark)).position.set(0.135 * s, 1.62, 0);

    // ---------- weapon in hands ----------
    this.gun = new THREE.Group();
    add(M(roundedBox(0.08, 0.11, 0.46, 0.03), gunMat), this.gun);                   // receiver
    const handg = add(M(new THREE.CylinderGeometry(0.03, 0.03, 0.2, 10), gunMat), this.gun); handg.rotation.x = Math.PI / 2; handg.position.z = -0.28;
    const barrel = add(M(new THREE.CylinderGeometry(0.016, 0.016, 0.16, 10), gunMat), this.gun); barrel.rotation.x = Math.PI / 2; barrel.position.z = -0.42;
    const mag = add(M(roundedBox(0.05, 0.2, 0.09, 0.02), gunMat), this.gun); mag.position.set(0, -0.13, 0.02); mag.rotation.x = 0.4;
    const stock = add(M(roundedBox(0.05, 0.08, 0.18, 0.03), gunMat), this.gun); stock.position.z = 0.28;
    this.gun.position.set(0.26, 1.2, -0.18);
    g.add(this.gun);
    this.muzzle = new THREE.Object3D(); this.muzzle.position.set(0, 0, -0.5); this.gun.add(this.muzzle);

    // muzzle flash
    this.flash = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xffe0a0, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.flash.visible = false; this.gun.add(this.flash); this.flash.position.set(0, 0, -0.52);

    // health bar billboard
    this.hpBar = this._makeHpBar();
    this.hpBar.position.set(0, 2.08, 0);
    g.add(this.hpBar);
    this.hpBarTime = 0;

    g.position.copy(this.feet);
    this.scene.add(g);
  }

  _makeHpBar() {
    const grp = new THREE.Group();
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.1),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.6, depthTest: false }));
    bg.renderOrder = 999;
    const fill = new THREE.Mesh(new THREE.PlaneGeometry(0.76, 0.07),
      new THREE.MeshBasicMaterial({ color: 0xff3b30, depthTest: false }));
    fill.position.z = 0.001; fill.renderOrder = 1000;
    this.hpFill = fill;
    grp.add(bg); grp.add(fill);
    grp.visible = false;
    return grp;
  }

  get position() { return this.feet; }
  eyePosition(out) { return (out || this._tmp).set(this.feet.x, this.feet.y + EYE, this.feet.z); }

  bodyBox() {
    return { min: new THREE.Vector3(this.feet.x - RADIUS, this.feet.y + 0.05, this.feet.z - RADIUS),
             max: new THREE.Vector3(this.feet.x + RADIUS, this.feet.y + 1.5, this.feet.z + RADIUS) };
  }
  headBox() {
    return { min: new THREE.Vector3(this.feet.x - 0.17, this.feet.y + 1.46, this.feet.z - 0.17),
             max: new THREE.Vector3(this.feet.x + 0.17, this.feet.y + 1.8, this.feet.z + 0.17) };
  }

  hit(dmg, headshot, dir, fx) {
    if (this.dead) return false;
    this.health -= dmg;
    this.hpBarTime = 2.5; this.hpBar.visible = true;
    this.alert = 1; this.lastSeen = this.cfg.now ? this.cfg.now() : 0;
    if (fx) fx.blood(this.eyePosition(new THREE.Vector3()).addScaledVector(dir, 0.1), dir);
    // flinch
    this.aimYaw += (Math.random() - 0.5) * 0.05;
    if (this.health <= 0) { this._die(); return true; }
    return false;
  }

  _die() {
    this.dead = true; this.state = 'dead'; this.deadTime = 0;
    this.hpBar.visible = false;
    this.vel.set(0, 0, 0);
  }

  /* ------------------------------ AI update ------------------------------ */

  update(dt, ctx) {
    if (this.dead) { this._updateDead(dt); return; }
    this.stateTime += dt;
    this.fireCooldown -= dt;
    this.reactionTimer -= dt;
    this.repathTimer -= dt;
    this.strafeTimer -= dt;
    this.muzzleFlashT -= dt;
    this.flash.visible = this.muzzleFlashT > 0;
    if (this.hpBarTime > 0) { this.hpBarTime -= dt; if (this.hpBarTime <= 0) this.hpBar.visible = false; }

    // physics: gravity + collision
    this.vel.y -= 20 * dt;

    this._perceive(dt, ctx);
    this._think(dt, ctx);

    // integrate
    const disp = this._tmp.set(this.vel.x * dt, this.vel.y * dt, this.vel.z * dt);
    const res = ctx.world.moveAABB(this.feet, RADIUS, HEIGHT, disp);
    if (res.onGround) { this.vel.y = 0; this.onGround = true; } else this.onGround = false;

    this._animate(dt, ctx);
  }

  _perceive(dt, ctx) {
    const p = ctx.player;
    const eye = this.eyePosition(new THREE.Vector3());
    const pe = p.eyePos;
    const toP = new THREE.Vector3().subVectors(pe, eye);
    const dist = toP.length();
    let see = false;
    if (p.alive && dist < this.cfg.viewDist) {
      const fwd = new THREE.Vector3(-Math.sin(this.aimYaw), 0, -Math.cos(this.aimYaw));
      const flat = new THREE.Vector3(toP.x, 0, toP.z).normalize();
      const dot = fwd.dot(flat);
      const inFov = dot > Math.cos(THREE.MathUtils.degToRad(62)) || this.alert > 0.5;
      if (inFov && ctx.world.lineOfSight(eye, pe)) see = true;
    }
    if (see) {
      this.canSee = true;
      this.lastKnown = p.eyePos.clone();
      this.lastKnownFeet = p.position.clone();
      this.lastSeen = ctx.now();
      this.alert = 1;
      if (this.state === 'idle' || this.state === 'patrol' || this.state === 'hunt' || this.state === 'search') {
        this._setState('engage');
        // reaction delay before first shot
        this.reactionTimer = this.cfg.reaction * (0.7 + Math.random() * 0.6);
      }
    } else {
      this.canSee = false;
      // hearing: player noise
      if (p.alive && p.noise > 0.05) {
        const hearRange = this.cfg.hearing * (0.4 + p.noise);
        if (dist < hearRange) {
          this.lastKnown = p.position.clone().add(new THREE.Vector3((Math.random() - 0.5) * 3, 0, (Math.random() - 0.5) * 3));
          this.lastKnownFeet = this.lastKnown.clone();
          this.alert = Math.max(this.alert, 0.7);
          if (this.state === 'idle' || this.state === 'patrol') this._setState('hunt');
        }
      }
      this.alert = Math.max(0, this.alert - dt * 0.1);
    }
  }

  _setState(s) { this.state = s; this.stateTime = 0; }

  _think(dt, ctx) {
    switch (this.state) {
      case 'idle':
        this.vel.x = this.vel.z = 0;
        if (this.stateTime > 0.6 + Math.random()) {
          // wander toward a site / random point to look for player
          this.lastKnownFeet = ctx.nav.randomPoint();
          this._setState('hunt');
        }
        break;
      case 'patrol':
      case 'hunt': this._hunt(dt, ctx); break;
      case 'engage': this._engage(dt, ctx); break;
      case 'reload': this._reload(dt, ctx); break;
      case 'search': this._search(dt, ctx); break;
    }
  }

  _hunt(dt, ctx) {
    const target = this.lastKnownFeet || (this.lastKnown ? this.lastKnown.clone() : null);
    if (!target) { this._setState('idle'); return; }
    this._followPath(dt, ctx, target, this.cfg.moveSpeed);
    // reached target?
    if (this.feet.distanceTo(target) < 1.6) {
      if (this.canSee) this._setState('engage');
      else this._setState('search');
    }
    if (this.canSee) this._setState('engage');
  }

  _search(dt, ctx) {
    this.vel.x *= 0.8; this.vel.z *= 0.8;
    // look around
    this.aimYaw += dt * 1.5 * this.strafeDir;
    if (this.stateTime > 2.5) {
      this.lastKnownFeet = ctx.nav.randomPoint();
      this._setState('hunt');
    }
    if (this.canSee) this._setState('engage');
  }

  _engage(dt, ctx) {
    const p = ctx.player;
    const eye = this.eyePosition(new THREE.Vector3());
    const aimTarget = this.canSee ? p.eyePos.clone().add(new THREE.Vector3(0, -0.15, 0)) : (this.lastKnown || p.eyePos);

    // turn toward target
    const desired = new THREE.Vector3().subVectors(aimTarget, eye);
    const desiredYaw = Math.atan2(-desired.x, -desired.z);
    const desiredPitch = Math.atan2(desired.y, Math.hypot(desired.x, desired.z));
    const turn = this.cfg.turnSpeed * dt;
    this.aimYaw = approachAngle(this.aimYaw, desiredYaw, turn);
    this.aimPitch = THREE.MathUtils.damp(this.aimPitch, desiredPitch, 10, dt);

    // lost sight?
    if (!this.canSee) {
      if (ctx.now() - this.lastSeen > this.cfg.memory) { this._setState('hunt'); return; }
    }

    // strafe / hold ground while engaging
    if (this.strafeTimer <= 0) { this.strafeTimer = 0.6 + Math.random() * 1.0; if (Math.random() < 0.4) this.strafeDir *= -1; }
    const dist = this.feet.distanceTo(p.position);
    let moveDir = new THREE.Vector3();
    const toPlayerFlat = new THREE.Vector3(p.position.x - this.feet.x, 0, p.position.z - this.feet.z).normalize();
    const rightFlat = new THREE.Vector3(-toPlayerFlat.z, 0, toPlayerFlat.x);
    if (this.canSee) {
      // keep preferred range depending on weapon
      const pref = this.cfg.preferredRange;
      if (dist > pref + 4) moveDir.add(toPlayerFlat);
      else if (dist < pref - 4) moveDir.sub(toPlayerFlat);
      moveDir.addScaledVector(rightFlat, this.cfg.strafe * this.strafeDir);
    } else {
      moveDir.add(toPlayerFlat); // push toward last known
    }
    this._separation(ctx, moveDir);
    if (moveDir.lengthSq() > 0) moveDir.normalize();
    const spd = this.cfg.moveSpeed * (this.canSee ? 0.7 : 1.0);
    this.vel.x = moveDir.x * spd; this.vel.z = moveDir.z * spd;
    // block walking into walls toward player handled by collision

    // shooting
    if (this.mag <= 0) { this._setState('reload'); this.reloadTimer = this.cfg.weapon.reloadTime * 1.1; return; }
    const aimErr = Math.abs(angleDiff(this.aimYaw, desiredYaw)) + Math.abs(this.aimPitch - desiredPitch);
    const canShoot = this.canSee && this.reactionTimer <= 0 && this.fireCooldown <= 0 && aimErr < 0.18;
    if (canShoot) this._shoot(ctx, eye, p);
  }

  _reload(dt, ctx) {
    this.vel.x *= 0.85; this.vel.z *= 0.85;
    // back off toward cover a bit
    const p = ctx.player;
    const away = new THREE.Vector3(this.feet.x - p.position.x, 0, this.feet.z - p.position.z).normalize();
    this.vel.x += away.x * this.cfg.moveSpeed * 0.3 * dt * 8;
    this.vel.z += away.z * this.cfg.moveSpeed * 0.3 * dt * 8;
    this.reloadTimer -= dt;
    if (this.reloadTimer <= 0) {
      this.mag = this.cfg.weapon.magSize === Infinity ? 30 : this.cfg.weapon.magSize;
      this._setState(this.canSee ? 'engage' : 'hunt');
    }
  }

  _shoot(ctx, eye, p) {
    const w = this.cfg.weapon;
    this.mag--;
    // burst control for autos
    if (w.automatic) {
      if (this.burstLeft <= 0) { this.burstLeft = 3 + (Math.random() * 4 | 0); }
      this.burstLeft--;
      this.fireCooldown = 60 / w.fireRate;
      if (this.burstLeft <= 0) this.fireCooldown += 0.25 + Math.random() * 0.45;
    } else {
      this.fireCooldown = Math.max(60 / w.fireRate, 0.35 + Math.random() * 0.5);
    }

    // aim direction with spread from accuracy + movement
    const muzzleWorld = this.muzzle.getWorldPosition(new THREE.Vector3());
    const baseDir = new THREE.Vector3().subVectors(p.eyePos.clone().add(new THREE.Vector3(0, -0.1, 0)), muzzleWorld).normalize();
    const moving = Math.hypot(this.vel.x, this.vel.z) > 1;
    let cone = this.cfg.spread + (moving ? 0.04 : 0);
    const dir = coneRandom(baseDir, cone);

    ctx.combat.resolveEnemyShot(muzzleWorld, dir, this, p.eyePos);
    // fx
    this.muzzleFlashT = 0.04;
    const s = 0.7 + Math.random() * 0.5; this.flash.scale.set(s, s, s);
    ctx.fx.muzzleFlashWorld(muzzleWorld);
    ctx.audio.gunshot(w.audio, this.feet);
    // recoil: nudge aim up slightly
    this.aimPitch += w.recoil ? w.recoil.kickUp * 0.6 : 0.01;
  }

  _separation(ctx, moveDir) {
    for (const e of ctx.enemies) {
      if (e === this || e.dead) continue;
      const dx = this.feet.x - e.feet.x, dz = this.feet.z - e.feet.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < 2.2 && d2 > 0.0001) {
        const d = Math.sqrt(d2);
        moveDir.x += (dx / d) * (1 - d / 1.5) * 0.8;
        moveDir.z += (dz / d) * (1 - d / 1.5) * 0.8;
      }
    }
  }

  _followPath(dt, ctx, target, speed) {
    if (this.repathTimer <= 0 || !this.path) {
      this.path = ctx.nav.findPath(this.feet, target) || null;
      this.pathIdx = this.path ? 1 : 0;
      this.repathTimer = 0.5 + Math.random() * 0.5;
    }
    if (!this.path || this.pathIdx >= this.path.length) {
      // direct steer fallback
      const dir = new THREE.Vector3(target.x - this.feet.x, 0, target.z - this.feet.z);
      if (dir.lengthSq() > 0.04) dir.normalize();
      this._separation(ctx, dir);
      if (dir.lengthSq() > 0) dir.normalize();
      this.vel.x = dir.x * speed; this.vel.z = dir.z * speed;
      this._faceMove();
      return;
    }
    const wp = this.path[this.pathIdx];
    const dir = new THREE.Vector3(wp.x - this.feet.x, 0, wp.z - this.feet.z);
    const d = dir.length();
    if (d < 1.0) { this.pathIdx++; }
    if (d > 0.001) dir.normalize();
    this._separation(ctx, dir);
    if (dir.lengthSq() > 0) dir.normalize();
    this.vel.x = dir.x * speed; this.vel.z = dir.z * speed;
    this._faceMove();
  }

  _faceMove() {
    if (Math.hypot(this.vel.x, this.vel.z) > 0.5 && !this.canSee) {
      const yaw = Math.atan2(-this.vel.x, -this.vel.z);
      this.aimYaw = approachAngle(this.aimYaw, yaw, 0.15);
    }
  }

  _animate(dt, ctx) {
    this.group.position.copy(this.feet);
    this.group.rotation.y = this.aimYaw;
    // leg walk cycle
    const speed = Math.hypot(this.vel.x, this.vel.z);
    if (speed > 0.4) {
      this._walkPhase = (this._walkPhase || 0) + dt * (4 + speed);
      const sw = Math.sin(this._walkPhase) * 0.5;
      this.legL.rotation.x = sw; this.legR.rotation.x = -sw;
      this.armL.rotation.x = -sw * 0.5;
    } else {
      this.legL.rotation.x *= 0.8; this.legR.rotation.x *= 0.8;
    }
    // gun pitch toward aim
    this.gun.rotation.x = -this.aimPitch;
    this.armR.rotation.x = -this.aimPitch - 0.2;
    // head pitch
    this.head.rotation.x = THREE.MathUtils.clamp(-this.aimPitch * 0.5, -0.5, 0.5);
    // hp bar billboard + fill
    if (this.hpBar.visible) {
      this.hpBar.lookAt(ctx.camera.position);
      this.hpBar.rotation.z = 0;
      const f = Math.max(0, this.health / this.maxHealth);
      this.hpFill.scale.x = f;
      this.hpFill.position.x = -(1 - f) * 0.38;
      this.hpFill.material.color.setHex(f > 0.5 ? 0x4caf50 : f > 0.25 ? 0xffb300 : 0xff3b30);
    }
  }

  _updateDead(dt) {
    this.deadTime += dt;
    // topple + sink + fade
    const t = Math.min(1, this.deadTime / 0.6);
    this.group.rotation.x = -t * Math.PI / 2 * 0.9;
    this.group.position.y = this.feet.y - t * 0.2;
    if (this.deadTime > 4) {
      const fade = Math.max(0, 1 - (this.deadTime - 4) / 1.5);
      this.group.traverse(o => { if (o.isMesh && o.material && 'opacity' in o.material) { o.material.transparent = true; o.material.opacity = fade; } });
    }
  }

  finished() { return this.dead && this.deadTime > 5.5; }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse(o => { if (o.isMesh) { o.geometry.dispose(); } });
  }
}

/* --------------------------- helpers --------------------------- */
function angleDiff(a, b) { let d = a - b; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; }
function approachAngle(cur, target, maxStep) {
  const d = angleDiff(target, cur);
  if (Math.abs(d) <= maxStep) return target;
  return cur + Math.sign(d) * maxStep;
}
function coneRandom(dir, halfAngle) {
  if (halfAngle <= 1e-5) return dir.clone();
  const up = Math.abs(dir.y) < 0.95 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const right = new THREE.Vector3().crossVectors(dir, up).normalize();
  const tup = new THREE.Vector3().crossVectors(right, dir).normalize();
  const ang = Math.random() * Math.PI * 2;
  const r = (Math.random() + Math.random()) * 0.5 * halfAngle;
  return dir.clone().addScaledVector(right, Math.cos(ang) * r).addScaledVector(tup, Math.sin(ang) * r).normalize();
}

/* ============================ manager ============================ */
export class EnemyManager {
  constructor(scene, world, nav, audio, fx, combat, camera) {
    this.scene = scene; this.world = world; this.nav = nav;
    this.audio = audio; this.fx = fx; this.combat = combat; this.camera = camera;
    this.enemies = [];
    this._now = () => performance.now() / 1000;
  }

  spawn(spawnPos, difficulty) {
    const cfg = Object.assign({ spawn: spawnPos, now: this._now }, difficulty);
    const e = new Enemy(this.scene, cfg);
    this.enemies.push(e);
    return e;
  }

  update(dt, player) {
    const ctx = {
      player, world: this.world, nav: this.nav, audio: this.audio,
      fx: this.fx, combat: this.combat, enemies: this.enemies,
      now: this._now, camera: this.camera,
    };
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      e.update(dt, ctx);
      if (e.finished()) { e.dispose(); this.enemies.splice(i, 1); }
    }
  }

  get aliveCount() { let n = 0; for (const e of this.enemies) if (!e.dead) n++; return n; }
  clearAll() { for (const e of this.enemies) e.dispose(); this.enemies = []; }
}
