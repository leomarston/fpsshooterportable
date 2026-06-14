/**
 * Collision — AABB world with a uniform-grid broadphase.
 *
 *  - Static world is a set of axis-aligned boxes, each tagged with a
 *    surface type (for footstep / impact sounds & decals).
 *  - The player is an AABB resolved one axis at a time so it slides
 *    along walls instead of sticking.
 *  - raycast() uses the slab method for bullets and AI line-of-sight.
 */
import * as THREE from 'three';

const CELL = 8;

export class Box {
  constructor(min, max, surface = 'concrete', solid = true, blocksSight = true) {
    this.min = min; this.max = max; this.surface = surface;
    this.solid = solid; this.blocksSight = blocksSight;
  }
  static fromCenter(cx, cy, cz, sx, sy, sz, surface = 'concrete', solid = true, blocksSight = true) {
    return new Box(
      new THREE.Vector3(cx - sx / 2, cy - sy / 2, cz - sz / 2),
      new THREE.Vector3(cx + sx / 2, cy + sy / 2, cz + sz / 2),
      surface, solid, blocksSight);
  }
}

export class CollisionWorld {
  constructor() {
    this.boxes = [];
    this.grid = new Map(); // "ix,iz" -> [boxIndex...]
    this.bounds = new THREE.Box3(
      new THREE.Vector3(Infinity, Infinity, Infinity),
      new THREE.Vector3(-Infinity, -Infinity, -Infinity));
  }

  _key(ix, iz) { return ix + ',' + iz; }

  add(box) {
    const idx = this.boxes.length;
    this.boxes.push(box);
    const ix0 = Math.floor(box.min.x / CELL), ix1 = Math.floor(box.max.x / CELL);
    const iz0 = Math.floor(box.min.z / CELL), iz1 = Math.floor(box.max.z / CELL);
    for (let ix = ix0; ix <= ix1; ix++)
      for (let iz = iz0; iz <= iz1; iz++) {
        const k = this._key(ix, iz);
        let arr = this.grid.get(k); if (!arr) this.grid.set(k, arr = []);
        arr.push(idx);
      }
    this.bounds.expandByPoint(box.min); this.bounds.expandByPoint(box.max);
    return box;
  }

  // candidate box indices near an AABB region
  _candidates(min, max) {
    const ix0 = Math.floor(min.x / CELL), ix1 = Math.floor(max.x / CELL);
    const iz0 = Math.floor(min.z / CELL), iz1 = Math.floor(max.z / CELL);
    const seen = new Set();
    const out = [];
    for (let ix = ix0; ix <= ix1; ix++)
      for (let iz = iz0; iz <= iz1; iz++) {
        const arr = this.grid.get(this._key(ix, iz));
        if (!arr) continue;
        for (const i of arr) if (!seen.has(i)) { seen.add(i); out.push(i); }
      }
    return out;
  }

  /**
   * Move an AABB (player) by `disp`, resolving collisions per axis.
   * feet = bottom-center position. Returns { onGround, surface, ceiling }.
   */
  moveAABB(feet, radius, height, disp) {
    const half = radius;
    let onGround = false, surface = 'sand', ceiling = false;
    // Build current AABB from feet.
    const aabb = {
      min: new THREE.Vector3(feet.x - half, feet.y, feet.z - half),
      max: new THREE.Vector3(feet.x + half, feet.y + height, feet.z + half),
    };

    const region = {
      min: new THREE.Vector3(Math.min(aabb.min.x + disp.x, aabb.min.x), Math.min(aabb.min.y + disp.y, aabb.min.y), Math.min(aabb.min.z + disp.z, aabb.min.z)),
      max: new THREE.Vector3(Math.max(aabb.max.x + disp.x, aabb.max.x), Math.max(aabb.max.y + disp.y, aabb.max.y), Math.max(aabb.max.z + disp.z, aabb.max.z)),
    };
    region.min.subScalar(0.1); region.max.addScalar(0.1);
    const cand = this._candidates(region.min, region.max).map(i => this.boxes[i]).filter(b => b.solid);

    const overlap = (a, b) =>
      a.min.x < b.max.x && a.max.x > b.min.x &&
      a.min.y < b.max.y && a.max.y > b.min.y &&
      a.min.z < b.max.z && a.max.z > b.min.z;

    // Substep so fast moves can't tunnel through thin walls/crates.
    const maxComp = Math.max(Math.abs(disp.x), Math.abs(disp.y), Math.abs(disp.z));
    const steps = Math.max(1, Math.ceil(maxComp / 0.4));
    const sx = disp.x / steps, sy = disp.y / steps, sz = disp.z / steps;

    for (let s = 0; s < steps; s++) {
      // X axis
      aabb.min.x += sx; aabb.max.x += sx;
      for (const b of cand) {
        if (!overlap(aabb, b)) continue;
        if (sx > 0) { const d = b.min.x - aabb.max.x; aabb.min.x += d; aabb.max.x += d; }
        else if (sx < 0) { const d = b.max.x - aabb.min.x; aabb.min.x += d; aabb.max.x += d; }
      }
      // Z axis
      aabb.min.z += sz; aabb.max.z += sz;
      for (const b of cand) {
        if (!overlap(aabb, b)) continue;
        if (sz > 0) { const d = b.min.z - aabb.max.z; aabb.min.z += d; aabb.max.z += d; }
        else if (sz < 0) { const d = b.max.z - aabb.min.z; aabb.min.z += d; aabb.max.z += d; }
      }
      // Y axis
      aabb.min.y += sy; aabb.max.y += sy;
      for (const b of cand) {
        if (!overlap(aabb, b)) continue;
        if (sy <= 0) { const d = b.max.y - aabb.min.y; aabb.min.y += d; aabb.max.y += d; onGround = true; surface = b.surface; }
        else { const d = b.min.y - aabb.max.y; aabb.min.y += d; aabb.max.y += d; ceiling = true; }
      }
    }

    feet.set(aabb.min.x + half, aabb.min.y, aabb.min.z + half);
    return { onGround, surface, ceiling };
  }

  // Is an AABB at this feet position free of overlaps? (for spawn checks)
  isFree(feet, radius, height) {
    const aabb = {
      min: new THREE.Vector3(feet.x - radius, feet.y, feet.z - radius),
      max: new THREE.Vector3(feet.x + radius, feet.y + height, feet.z + radius),
    };
    const cand = this._candidates(aabb.min, aabb.max).map(i => this.boxes[i]).filter(b => b.solid);
    for (const b of cand) {
      if (aabb.min.x < b.max.x && aabb.max.x > b.min.x &&
          aabb.min.y < b.max.y && aabb.max.y > b.min.y &&
          aabb.min.z < b.max.z && aabb.max.z > b.min.z) return false;
    }
    return true;
  }

  // Height of ground directly under a point (drop a ray down).
  groundHeight(x, z, fromY = 50) {
    const hit = this.raycast(new THREE.Vector3(x, fromY, z), new THREE.Vector3(0, -1, 0), 120, false);
    return hit ? hit.point.y : 0;
  }

  /**
   * Raycast against world boxes (slab method).
   * sightOnly: if true, only consider boxes that block sight (skip e.g. clip).
   * Returns { point, normal, dist, box, surface } or null.
   */
  raycast(origin, dir, maxDist = 1000, solidOnly = true) {
    // March cells along the ray for the broadphase, but simplest robust:
    // gather candidates along an inflated segment AABB.
    const end = new THREE.Vector3(origin.x + dir.x * maxDist, origin.y + dir.y * maxDist, origin.z + dir.z * maxDist);
    const min = new THREE.Vector3(Math.min(origin.x, end.x), Math.min(origin.y, end.y), Math.min(origin.z, end.z));
    const max = new THREE.Vector3(Math.max(origin.x, end.x), Math.max(origin.y, end.y), Math.max(origin.z, end.z));
    const cand = this._candidates(min, max);
    let best = null, bestT = maxDist;
    for (const i of cand) {
      const b = this.boxes[i];
      if (solidOnly && !b.solid) continue;
      const hit = this._raySlab(origin, dir, b, bestT);
      if (hit && hit.t < bestT) { bestT = hit.t; best = { t: hit.t, normal: hit.normal, box: b }; }
    }
    if (!best) return null;
    return {
      dist: best.t,
      point: new THREE.Vector3(origin.x + dir.x * best.t, origin.y + dir.y * best.t, origin.z + dir.z * best.t),
      normal: best.normal,
      box: best.box,
      surface: best.box.surface,
    };
  }

  // Does a clear line exist between a and b (for AI vision)?
  lineOfSight(a, b) {
    const dir = new THREE.Vector3().subVectors(b, a);
    const dist = dir.length();
    if (dist < 0.001) return true;
    dir.multiplyScalar(1 / dist);
    const hit = this.raycast(a, dir, dist - 0.05, true);
    return !hit || !hit.box.blocksSight;
  }

  _raySlab(o, d, box, maxT) {
    let tmin = 0, tmax = maxT;
    let nx = 0, ny = 0, nz = 0;
    // X
    {
      const inv = 1 / (d.x || 1e-9);
      let t1 = (box.min.x - o.x) * inv, t2 = (box.max.x - o.x) * inv;
      let sign = -1; if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; sign = 1; }
      if (t1 > tmin) { tmin = t1; nx = sign; ny = nz = 0; }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return null;
    }
    // Y
    {
      const inv = 1 / (d.y || 1e-9);
      let t1 = (box.min.y - o.y) * inv, t2 = (box.max.y - o.y) * inv;
      let sign = -1; if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; sign = 1; }
      if (t1 > tmin) { tmin = t1; ny = sign; nx = nz = 0; }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return null;
    }
    // Z
    {
      const inv = 1 / (d.z || 1e-9);
      let t1 = (box.min.z - o.z) * inv, t2 = (box.max.z - o.z) * inv;
      let sign = -1; if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; sign = 1; }
      if (t1 > tmin) { tmin = t1; nz = sign; nx = ny = 0; }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return null;
    }
    if (tmin < 0.0001) return null;
    return { t: tmin, normal: new THREE.Vector3(nx, ny, nz) };
  }
}
