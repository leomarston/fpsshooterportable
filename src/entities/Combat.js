/**
 * Combat — hitscan resolution shared by the player and the bots.
 *
 * A shot raycasts the world for the nearest blocking surface, then
 * tests character hitboxes (separate head boxes for headshots) that are
 * closer than that surface. Damage uses range falloff + headshot
 * multipliers; tracers, impact particles, blood and hit-markers are
 * spawned here so all fire feels consistent.
 */
import * as THREE from 'three';

export class Combat {
  constructor(world, fx, audio) {
    this.world = world;
    this.fx = fx;
    this.audio = audio;
    this.player = null;
    this.enemies = null;     // EnemyManager
    // hooks (set by Game)
    this.onHitmarker = null; // (headshot, killed)
    this.onKill = null;      // (enemy, weapon, headshot)
    this.onPlayerHit = null; // (dmg, fromPos, headshot)
    this.onScope = null;     // (bool)
    this._tmpOrigin = new THREE.Vector3();
  }

  setPlayer(p) { this.player = p; }
  setEnemies(m) { this.enemies = m; }
  muzzleFlashWorld(pos) { this.fx.muzzleFlashWorld(pos); }
  setScope(on) { this.onScope?.(on); }

  /* ----------------------- player → world / enemies ----------------------- */
  resolveShot(origin, dir, weapon, isFirst, isMelee = false) {
    const range = weapon.range || 100;
    const wHit = this.world.raycast(origin, dir, range, true);
    const wDist = wHit ? wHit.dist : range;

    // nearest enemy hitbox closer than the wall
    let best = null;
    if (this.enemies) {
      for (const e of this.enemies.enemies) {
        if (e.dead) continue;
        const head = rayAABB(origin, dir, e.headBox());
        const body = rayAABB(origin, dir, e.bodyBox());
        let t = null, headshot = false;
        if (head != null && (body == null || head <= body)) { t = head; headshot = true; }
        else if (body != null) { t = body; headshot = false; }
        if (t != null && t < wDist && t <= range && (!best || t < best.t)) {
          best = { t, headshot, enemy: e };
        }
      }
    }

    const muzzle = this._muzzlePoint(origin, dir);

    if (best) {
      const point = origin.clone().addScaledVector(dir, best.t);
      let dmg = weapon.damage;
      dmg *= falloff(weapon, best.t);
      if (best.headshot) dmg *= (weapon.headshotMult || 1);
      this.fx.tracer(muzzle, point);
      this.fx.blood(point, dir);
      const killed = best.enemy.hit(dmg, best.headshot, dir, this.fx);
      this.audio.hitMarker(best.headshot);
      this.onHitmarker?.(best.headshot, killed);
      if (killed) this.onKill?.(best.enemy, weapon, best.headshot);
      return { hit: 'enemy', headshot: best.headshot, killed, point };
    }

    if (wHit) {
      this.fx.tracer(muzzle, wHit.point);
      this.fx.impact(wHit.point, wHit.normal, wHit.surface);
      this.audio.impact(wHit.surface, wHit.point);
      return { hit: 'world', point: wHit.point };
    }

    if (!isMelee) {
      const end = origin.clone().addScaledVector(dir, range);
      this.fx.tracer(muzzle, end);
    }
    return { hit: null };
  }

  /* ------------------------- enemy → world / player ------------------------- */
  resolveEnemyShot(origin, dir, enemy, playerEye) {
    const w = enemy.cfg.weapon;
    const range = w.range || 90;
    const wHit = this.world.raycast(origin, dir, range, true);
    const wDist = wHit ? wHit.dist : range;

    const p = this.player;
    let pt = null, headshot = false;
    if (p && p.alive) {
      const body = rayAABB(origin, dir, playerBox(p));
      const head = rayAABB(origin, dir, playerHeadBox(p));
      if (head != null && (body == null || head <= body)) { pt = head; headshot = true; }
      else if (body != null) { pt = body; headshot = false; }
    }

    if (pt != null && pt < wDist && pt <= range) {
      const point = origin.clone().addScaledVector(dir, pt);
      let dmg = w.damage * falloff(w, pt);
      if (headshot) dmg *= (w.headshotMult || 1);
      dmg *= enemy.cfg.damageMult || 1;
      this.fx.tracer(origin, point);
      p.takeDamage(dmg, enemy.position.clone().setY(point.y), headshot);
      this.onPlayerHit?.(dmg, enemy.position, headshot);
      return;
    }

    // missed the player — whizz if it passed close, then hit the world
    if (p && p.alive) {
      const close = pointLineDist(p.eyePos, origin, dir, Math.min(wDist, range));
      if (close < 1.6) this.audio.whizz(null, this._panFor(origin));
    }
    if (wHit) {
      this.fx.tracer(origin, wHit.point);
      this.fx.impact(wHit.point, wHit.normal, wHit.surface);
      this.audio.impact(wHit.surface, wHit.point);
    } else {
      this.fx.tracer(origin, origin.clone().addScaledVector(dir, range));
    }
  }

  _muzzlePoint(origin, dir) {
    // start tracer a little ahead of the eye so it reads as gun-fired
    return origin.clone().addScaledVector(dir, 0.7).add(new THREE.Vector3(0, -0.12, 0));
  }
  _panFor() { return 0; }
}

/* ------------------------------ helpers ------------------------------ */
function falloff(weapon, dist) {
  const f = weapon.falloff;
  if (!f) return 1;
  if (dist <= f.start) return 1;
  if (dist >= f.end) return f.min;
  return THREE.MathUtils.lerp(1, f.min, (dist - f.start) / (f.end - f.start));
}

function playerBox(p) {
  const r = 0.4;
  return { min: new THREE.Vector3(p.feet.x - r, p.feet.y + 0.1, p.feet.z - r),
           max: new THREE.Vector3(p.feet.x + r, p.feet.y + p.height - 0.28, p.feet.z + r) };
}
function playerHeadBox(p) {
  const r = 0.22;
  return { min: new THREE.Vector3(p.feet.x - r, p.feet.y + p.height - 0.32, p.feet.z - r),
           max: new THREE.Vector3(p.feet.x + r, p.feet.y + p.height, p.feet.z + r) };
}

// Ray vs AABB slab test; returns entry distance t>0 or null.
function rayAABB(o, d, box) {
  let tmin = 0.0001, tmax = Infinity;
  for (const ax of ['x', 'y', 'z']) {
    const inv = 1 / (d[ax] || 1e-9);
    let t1 = (box.min[ax] - o[ax]) * inv;
    let t2 = (box.max[ax] - o[ax]) * inv;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  return tmin;
}

// Closest distance from point P to ray (o + d*t), t in [0, maxT].
function pointLineDist(P, o, d, maxT) {
  const ox = P.x - o.x, oy = P.y - o.y, oz = P.z - o.z;
  let t = ox * d.x + oy * d.y + oz * d.z;
  t = THREE.MathUtils.clamp(t, 0, maxT);
  const cx = o.x + d.x * t - P.x, cy = o.y + d.y * t - P.y, cz = o.z + d.z * t - P.z;
  return Math.hypot(cx, cy, cz);
}
