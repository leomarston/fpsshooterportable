/**
 * MeshWorld — a collision world backed by an arbitrary triangle mesh (an
 * imported glTF map) instead of axis-aligned boxes. It exposes the SAME
 * interface as CollisionWorld (moveAABB / groundHeight / raycast /
 * lineOfSight / isFree / boxes / bounds) so Player, Enemy, Combat and Nav
 * use it unchanged.
 *
 * Triangles are bucketed into a uniform XZ grid for fast ray queries
 * (Möller–Trumbore). The character controller is ray-sampled: per-axis wall
 * rays for sliding, a downward ray for floor/step, an upward ray for the
 * ceiling — robust enough for FPS movement on imported geometry.
 */
import * as THREE from 'three';
import { Box } from './Collision.js';

const CELL = 3;                 // XZ grid cell size (metres)
const SURF = ['concrete', 'metal'];

export class MeshWorld {
  constructor() {
    this.tri = null;            // Float32Array, 9 per triangle (a,b,c)
    this.triN = null;           // Float32Array, 3 per triangle (face normal)
    this.triS = null;           // Uint8Array, surface index per triangle
    this.count = 0;
    this.grid = new Map();      // "ix,iz" -> [triIndex...]
    this.boxes = [];            // synthesized wall rects (minimap only)
    this.bounds = new THREE.Box3(
      new THREE.Vector3(Infinity, Infinity, Infinity),
      new THREE.Vector3(-Infinity, -Infinity, -Infinity));
    this._noFloor = 9999;
  }

  /* ----------------------------- build ----------------------------- */

  // Build from a THREE.Object3D (world-space triangles of all its meshes).
  buildFromObject(root) {
    root.updateMatrixWorld(true);
    const tris = []; const norms = []; const surfs = [];
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    const ab = new THREE.Vector3(), ac = new THREE.Vector3(), n = new THREE.Vector3();
    root.traverse((o) => {
      if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
      const surf = this._surfaceOf(o);
      const g = o.geometry;
      const pos = g.attributes.position;
      const idx = g.index;
      const m = o.matrixWorld;
      const triCount = idx ? idx.count / 3 : pos.count / 3;
      for (let t = 0; t < triCount; t++) {
        const i0 = idx ? idx.getX(t * 3) : t * 3;
        const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
        const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
        a.fromBufferAttribute(pos, i0).applyMatrix4(m);
        b.fromBufferAttribute(pos, i1).applyMatrix4(m);
        c.fromBufferAttribute(pos, i2).applyMatrix4(m);
        ab.subVectors(b, a); ac.subVectors(c, a); n.crossVectors(ab, ac);
        if (n.lengthSq() < 1e-12) continue;     // degenerate
        n.normalize();
        tris.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
        norms.push(n.x, n.y, n.z);
        surfs.push(surf);
      }
    });

    this.count = surfs.length;
    this.tri = new Float32Array(tris);
    this.triN = new Float32Array(norms);
    this.triS = new Uint8Array(surfs);

    // bucket into the XZ grid + record min/max + wall cells (for the minimap)
    const wallCells = new Set();
    for (let i = 0; i < this.count; i++) {
      const o = i * 9;
      const minx = Math.min(this.tri[o], this.tri[o + 3], this.tri[o + 6]);
      const maxx = Math.max(this.tri[o], this.tri[o + 3], this.tri[o + 6]);
      const miny = Math.min(this.tri[o + 1], this.tri[o + 4], this.tri[o + 7]);
      const maxy = Math.max(this.tri[o + 1], this.tri[o + 4], this.tri[o + 7]);
      const minz = Math.min(this.tri[o + 2], this.tri[o + 5], this.tri[o + 8]);
      const maxz = Math.max(this.tri[o + 2], this.tri[o + 5], this.tri[o + 8]);
      this.bounds.expandByPoint(new THREE.Vector3(minx, miny, minz));
      this.bounds.expandByPoint(new THREE.Vector3(maxx, maxy, maxz));
      const ix0 = Math.floor(minx / CELL), ix1 = Math.floor(maxx / CELL);
      const iz0 = Math.floor(minz / CELL), iz1 = Math.floor(maxz / CELL);
      const wall = Math.abs(this.triN[i * 3 + 1]) < 0.6 && maxy > 0.4 && miny < 2.4;
      for (let ix = ix0; ix <= ix1; ix++)
        for (let iz = iz0; iz <= iz1; iz++) {
          const k = ix + ',' + iz;
          let arr = this.grid.get(k); if (!arr) this.grid.set(k, arr = []);
          arr.push(i);
          if (wall) wallCells.add(k);
        }
    }

    // synthesize blocky wall rects so the minimap has something to draw
    for (const k of wallCells) {
      const [ix, iz] = k.split(',').map(Number);
      this.boxes.push(new Box(
        new THREE.Vector3(ix * CELL, 0, iz * CELL),
        new THREE.Vector3((ix + 1) * CELL, 2.4, (iz + 1) * CELL),
        'concrete', true, true));
    }
    return this;
  }

  _surfaceOf(mesh) {
    const s = ((mesh.name || '') + ' ' + ((mesh.material && mesh.material.name) || '')).toLowerCase();
    if (/metal|rail|train|subway|door|gate|machine|seat|chair|glass/.test(s)) return 1; // metal
    return 0; // concrete / tile
  }

  /* --------------------------- ray query --------------------------- */

  // Nearest triangle hit along origin+dir*t, t in (eps, maxDist].
  raycast(origin, dir, maxDist = 1000, _solidOnly = true) {
    const ox = origin.x, oy = origin.y, oz = origin.z;
    const dx = dir.x, dy = dir.y, dz = dir.z;
    const ex = ox + dx * maxDist, ez = oz + dz * maxDist;
    const cells = this._segCells(ox, oz, ex, ez);
    let bestT = maxDist, bi = -1;
    const tri = this.tri;
    for (const i of cells) {
      const o = i * 9;
      const t = rayTri(ox, oy, oz, dx, dy, dz,
        tri[o], tri[o + 1], tri[o + 2], tri[o + 3], tri[o + 4], tri[o + 5], tri[o + 6], tri[o + 7], tri[o + 8]);
      if (t > 1e-4 && t < bestT) { bestT = t; bi = i; }
    }
    if (bi < 0) return null;
    const nrm = new THREE.Vector3(this.triN[bi * 3], this.triN[bi * 3 + 1], this.triN[bi * 3 + 2]);
    if (nrm.x * dx + nrm.y * dy + nrm.z * dz > 0) nrm.negate();   // face the ray
    return {
      dist: bestT,
      point: new THREE.Vector3(ox + dx * bestT, oy + dy * bestT, oz + dz * bestT),
      normal: nrm, box: null, surface: SURF[this.triS[bi]],
    };
  }

  // Unique triangle indices in the XZ cells the segment passes through.
  _segCells(ox, oz, ex, ez) {
    const out = new Set();
    const add = (x, z) => { const arr = this.grid.get(Math.floor(x / CELL) + ',' + Math.floor(z / CELL)); if (arr) for (const i of arr) out.add(i); };
    const len = Math.hypot(ex - ox, ez - oz);
    if (len < 1e-4) { add(ox, oz); return out; }
    const steps = Math.ceil(len / (CELL * 0.5)) + 1;
    for (let s = 0; s <= steps; s++) { const t = s / steps; add(ox + (ex - ox) * t, oz + (ez - oz) * t); }
    return out;
  }

  // Floor height under (x,z): the highest STANDABLE up-facing surface at/below
  // fromY — i.e. one with ~1.7m of clear headroom (so ceiling beam-tops and
  // cramped ledges are rejected). A plain downward ray would hit the ceiling.
  groundHeight(x, z, fromY = 50) {
    const arr = this.grid.get(Math.floor(x / CELL) + ',' + Math.floor(z / CELL));
    if (!arr) return this._noFloor;
    const tri = this.tri;
    // gather every plane intersection at (x,z): height + whether it faces up
    const ys = [], up = [];
    for (const i of arr) {
      const o = i * 9;
      const y = floorYAt(x, z, tri[o], tri[o + 1], tri[o + 2], tri[o + 3], tri[o + 4], tri[o + 5], tri[o + 6], tri[o + 7], tri[o + 8]);
      if (y === null) continue;
      ys.push(y); up.push(this.triN[i * 3 + 1] > 0.25);
    }
    // highest standable up-facing surface (≥1.7m headroom) at/below fromY —
    // the platform/concourse, never a cramped beam-top.
    let best = -Infinity;
    for (let k = 0; k < ys.length; k++) {
      if (!up[k] || ys[k] > fromY + 0.05 || ys[k] <= best) continue;
      let ceil = Infinity;                          // nearest surface above this floor
      for (let j = 0; j < ys.length; j++) if (ys[j] > ys[k] + 0.05 && ys[j] < ceil) ceil = ys[j];
      if (ceil - ys[k] >= 1.7) best = ys[k];        // standable headroom
    }
    return best > -Infinity ? best : this._noFloor;
  }

  lineOfSight(a, b) {
    const dir = new THREE.Vector3().subVectors(b, a);
    const d = dir.length();
    if (d < 0.001) return true;
    dir.multiplyScalar(1 / d);
    return !this.raycast(a, dir, d - 0.05, true);
  }

  // Headroom test (capsule fits standing here?) — used for spawn / nav cells.
  isFree(feet, radius, height) {
    const up = this.raycast(new THREE.Vector3(feet.x, feet.y + 0.12, feet.z), UP, height - 0.12, false);
    return !up;
  }

  /* ----------------------- character controller ----------------------- */

  moveAABB(feet, radius, height, disp) {
    const STEP = 0.6;
    // --- horizontal, one axis at a time so you slide along walls ---
    this._slideAxis(feet, radius, height, STEP, disp.x, 0);
    this._slideAxis(feet, radius, height, STEP, 0, disp.z);

    // --- ceiling when moving up ---
    let ceiling = false;
    let dy = disp.y;
    if (dy > 0) {
      const up = this.raycast(new THREE.Vector3(feet.x, feet.y + height, feet.z), UP, dy + 0.1, false);
      if (up && up.dist <= dy + 0.05) { dy = Math.max(0, up.dist - 0.05); ceiling = true; }
    }

    // --- floor / step / gravity ---
    let onGround = false, surface = 'concrete';
    let newY = feet.y + dy;
    const floor = this.raycast(new THREE.Vector3(feet.x, feet.y + STEP + 0.2, feet.z), DOWN, 140, false);
    if (floor) {
      const fh = floor.point.y;
      if (newY <= fh + 0.02 && fh - feet.y <= STEP + 0.05) { newY = fh; onGround = true; surface = floor.surface; }
    }
    feet.y = newY;
    return { onGround, surface, ceiling };
  }

  // Move along a single horizontal axis, stopped `radius` short of walls.
  _slideAxis(feet, radius, height, STEP, dx, dz) {
    const dist = Math.hypot(dx, dz);
    if (dist < 1e-6) return;
    const dirx = dx / dist, dirz = dz / dist;
    const perpx = -dirz, perpz = dirx;            // sideways offset for edge rays
    let allowed = dist;
    for (const hy of [STEP + 0.2, height * 0.5, height - 0.12]) {
      for (const off of [0, radius * 0.85, -radius * 0.85]) {
        const ox = feet.x + perpx * off, oz = feet.z + perpz * off;
        const hit = this.raycast(new THREE.Vector3(ox, feet.y + hy, oz), new THREE.Vector3(dirx, 0, dirz), dist + radius, true);
        if (hit) allowed = Math.min(allowed, hit.dist - radius);
      }
    }
    if (allowed < 0) allowed = 0;
    feet.x += dirx * allowed; feet.z += dirz * allowed;
  }
}

const DOWN = new THREE.Vector3(0, -1, 0);
const UP = new THREE.Vector3(0, 1, 0);

// Height on a triangle's plane at (px,pz) if (px,pz) is inside its XZ
// projection, else null. (Barycentric in the XZ plane.)
function floorYAt(px, pz, ax, ay, az, bx, by, bz, cx, cy, cz) {
  const v0x = cx - ax, v0z = cz - az, v1x = bx - ax, v1z = bz - az, v2x = px - ax, v2z = pz - az;
  const det = v0x * v1z - v1x * v0z;
  if (det > -1e-9 && det < 1e-9) return null;
  const u = (v2x * v1z - v1x * v2z) / det;
  const v = (v0x * v2z - v2x * v0z) / det;
  if (u < -1e-4 || v < -1e-4 || u + v > 1 + 1e-4) return null;
  return ay + u * (cy - ay) + v * (by - ay);
}

// Möller–Trumbore ray/triangle; returns t>0 or -1.
function rayTri(ox, oy, oz, dx, dy, dz, ax, ay, az, bx, by, bz, cx, cy, cz) {
  const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
  const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
  const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (det > -1e-8 && det < 1e-8) return -1;
  const inv = 1 / det;
  const tx = ox - ax, ty = oy - ay, tz = oz - az;
  const u = (tx * px + ty * py + tz * pz) * inv;
  if (u < -1e-5 || u > 1 + 1e-5) return -1;
  const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
  const v = (dx * qx + dy * qy + dz * qz) * inv;
  if (v < -1e-5 || u + v > 1 + 1e-5) return -1;
  return (e2x * qx + e2y * qy + e2z * qz) * inv;
}
