/**
 * Combat — hitscan resolution shared by every combatant (players + bots).
 *
 * A shot raycasts the world for the nearest blocking surface, then tests the
 * hitboxes of every OTHER combatant on an opposing team (friendly fire off),
 * picking the nearest one closer than that surface (separate head boxes give
 * headshots). Damage uses range falloff + headshot/owner multipliers; tracers,
 * impacts, blood and hit-markers are spawned here so all fire feels consistent.
 */
import * as THREE from 'three';

export class Combat {
  constructor(world, fx, audio) {
    this.world = world;
    this.fx = fx;
    this.audio = audio;
    this.combatants = [];    // every fighter on the map (player ents + bots)
    // hooks (set by Game)
    this.onHit = null;       // (owner, victim, weapon, headshot, killed)
    this.onScope = null;     // (owner, bool)
    this._tmpOrigin = new THREE.Vector3();
  }

  setCombatants(arr) { this.combatants = arr || []; }
  muzzleFlashWorld(pos) { this.fx.muzzleFlashWorld(pos); }
  setScope(on, owner) { this.onScope?.(owner, on); }

  /* --------------------- one shot from any combatant --------------------- */
  resolveShot(origin, dir, weapon, isFirst, isMelee = false, owner = null) {
    const range = weapon.range || 100;
    const wHit = this.world.raycast(origin, dir, range, true);
    const wDist = wHit ? wHit.dist : range;
    const ownerTeam = owner ? owner.team : -1;

    // nearest opposing combatant whose hitbox is closer than the wall
    let best = null;
    for (const c of this.combatants) {
      if (c === owner || !c.alive || c.team === ownerTeam) continue;
      const head = rayAABB(origin, dir, c.headBox());
      const body = rayAABB(origin, dir, c.bodyBox());
      let t = null, headshot = false;
      if (head != null && (body == null || head <= body)) { t = head; headshot = true; }
      else if (body != null) { t = body; headshot = false; }
      if (t != null && t < wDist && t <= range && (!best || t < best.t)) best = { t, headshot, victim: c };
    }

    const muzzle = isMelee ? origin : this._muzzlePoint(origin, dir);

    if (best) {
      const point = origin.clone().addScaledVector(dir, best.t);
      let dmg = weapon.damage * falloff(weapon, best.t);
      if (best.headshot) dmg *= (weapon.headshotMult || 1);
      dmg *= (owner && owner.damageMult) || 1;
      this.fx.tracer(muzzle, point);
      const fromPos = owner ? (owner.eyePos || owner.position) : point;
      const killed = best.victim.applyDamage(dmg, best.headshot, dir, fromPos, this.fx);
      if (owner && owner.hudOwner) this.audio.hitMarker(best.headshot);  // only humans get the click
      this.onHit?.(owner, best.victim, weapon, best.headshot, killed);
      return { hit: 'combatant', headshot: best.headshot, killed, point, victim: best.victim };
    }

    if (wHit) {
      this.fx.tracer(muzzle, wHit.point);
      this.fx.impact(wHit.point, wHit.normal, wHit.surface);
      this.audio.impact(wHit.surface, wHit.point);
    } else if (!isMelee) {
      this.fx.tracer(muzzle, origin.clone().addScaledVector(dir, range));
    }

    // a bot's miss that whizzes past a human ear
    if (owner && owner.isBot) {
      for (const c of this.combatants) {
        if (!c.alive || c.isBot || c.team === ownerTeam) continue;
        const close = pointLineDist(c.eyePos, origin, dir, Math.min(wDist, range));
        if (close < 1.6) { this.audio.whizz(null, 0); break; }
      }
    }
    return { hit: wHit ? 'world' : null, point: wHit ? wHit.point : null };
  }

  _muzzlePoint(origin, dir) {
    // start tracer a little ahead of the eye so it reads as gun-fired
    return origin.clone().addScaledVector(dir, 0.7).add(new THREE.Vector3(0, -0.12, 0));
  }
}

/* ------------------------------ helpers ------------------------------ */
function falloff(weapon, dist) {
  const f = weapon.falloff;
  if (!f) return 1;
  if (dist <= f.start) return 1;
  if (dist >= f.end) return f.min;
  return THREE.MathUtils.lerp(1, f.min, (dist - f.start) / (f.end - f.start));
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
