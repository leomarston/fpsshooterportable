/**
 * Nav — grid navmesh + A* pathfinding, built automatically from the
 * collision world. Bots use this to hunt the player through corridors.
 *
 * A uniform grid is sampled across the map; a cell is walkable if the
 * player capsule fits there at ground height. Neighbours connect when
 * both are walkable, the step is small, and (for diagonals) the corner
 * isn't clipped. Paths are string-pulled to remove zig-zag.
 */
import * as THREE from 'three';

export class Nav {
  constructor(world, bounds, res = 1.6, maxFloor = 3.2) {
    this.world = world;
    this.res = res;
    this.maxFloor = maxFloor;   // cells whose floor is higher than this aren't walkable
    this.x0 = bounds.x0 + 1; this.x1 = bounds.x1 - 1;
    this.z0 = bounds.z0 + 1; this.z1 = bounds.z1 - 1;
    this.cols = Math.floor((this.x1 - this.x0) / res) + 1;
    this.rows = Math.floor((this.z1 - this.z0) / res) + 1;
    this.nodes = new Array(this.cols * this.rows);
    this.radius = 0.42;
    this.height = 1.7;
    this.stepUp = 0.6;   // matches the player/bot physics step-up height
    this._build();
  }

  _idx(c, r) { return r * this.cols + c; }
  _cx(c) { return this.x0 + c * this.res; }
  _cz(r) { return this.z0 + r * this.res; }

  _build() {
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const x = this._cx(c), z = this._cz(r);
        const gy = this.world.groundHeight(x, z, 30);
        const walkable = gy < this.maxFloor && this.world.isFree(new THREE.Vector3(x, gy + 0.06, z), this.radius, this.height);
        this.nodes[this._idx(c, r)] = { c, r, x, z, y: gy, walkable };
      }
    }
  }

  node(c, r) { return (c < 0 || r < 0 || c >= this.cols || r >= this.rows) ? null : this.nodes[this._idx(c, r)]; }

  nearest(pos) {
    let c = Math.round((pos.x - this.x0) / this.res);
    let r = Math.round((pos.z - this.z0) / this.res);
    c = THREE.MathUtils.clamp(c, 0, this.cols - 1);
    r = THREE.MathUtils.clamp(r, 0, this.rows - 1);
    const n = this.node(c, r);
    if (n && n.walkable) return n;
    // spiral outward for nearest walkable
    for (let ring = 1; ring < 8; ring++) {
      for (let dc = -ring; dc <= ring; dc++) for (let dr = -ring; dr <= ring; dr++) {
        if (Math.max(Math.abs(dc), Math.abs(dr)) !== ring) continue;
        const m = this.node(c + dc, r + dr);
        if (m && m.walkable) return m;
      }
    }
    return n;
  }

  _connected(a, b) {
    if (!a.walkable || !b.walkable) return false;
    if (Math.abs(a.y - b.y) > this.stepUp) return false;
    const dc = b.c - a.c, dr = b.r - a.r;
    if (dc !== 0 && dr !== 0) {
      // diagonal: both orthogonal corners must be walkable (no corner clip)
      const n1 = this.node(a.c + dc, a.r), n2 = this.node(a.c, a.r + dr);
      if (!n1 || !n2 || !n1.walkable || !n2.walkable) return false;
    }
    return true;
  }

  // A* between two world positions; returns array of Vector3 or null.
  findPath(from, to) {
    const start = this.nearest(from), goal = this.nearest(to);
    if (!start || !goal || !start.walkable || !goal.walkable) return null;
    if (start === goal) return [new THREE.Vector3(to.x, to.y, to.z)];

    const open = new MinHeap();
    const came = new Map();
    const g = new Map();
    const key = (n) => n.r * this.cols + n.c;
    g.set(key(start), 0);
    open.push(start, this._h(start, goal));
    const closed = new Set();
    const NB = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

    let iter = 0;
    while (open.size && iter++ < 6000) {
      const cur = open.pop();
      const ck = key(cur);
      if (cur === goal) return this._reconstruct(came, cur, to);
      if (closed.has(ck)) continue;
      closed.add(ck);
      for (const [dc, dr] of NB) {
        const nb = this.node(cur.c + dc, cur.r + dr);
        if (!nb || closed.has(key(nb)) || !this._connected(cur, nb)) continue;
        const step = (dc && dr) ? 1.4142 : 1;
        const tentative = g.get(ck) + step * this.res + Math.abs(nb.y - cur.y) * 0.5;
        const nk = key(nb);
        if (tentative < (g.get(nk) ?? Infinity)) {
          came.set(nk, cur);
          g.set(nk, tentative);
          open.push(nb, tentative + this._h(nb, goal));
        }
      }
    }
    return null;
  }

  _h(a, b) {
    const dx = Math.abs(a.c - b.c), dz = Math.abs(a.r - b.r);
    return (dx + dz + (1.4142 - 2) * Math.min(dx, dz)) * this.res;
  }

  _reconstruct(came, cur, to) {
    const path = [];
    const key = (n) => n.r * this.cols + n.c;
    while (cur) { path.push(new THREE.Vector3(cur.x, cur.y, cur.z)); cur = came.get(key(cur)); }
    path.reverse();
    path.push(new THREE.Vector3(to.x, to.y, to.z));
    return this._smooth(path);
  }

  // String-pull: drop intermediate points when the straight line is walkable.
  _smooth(path) {
    if (path.length <= 2) return path;
    const out = [path[0]];
    let i = 0;
    while (i < path.length - 1) {
      let j = path.length - 1;
      for (; j > i + 1; j--) {
        if (this._clearWalk(path[i], path[j])) break;
      }
      out.push(path[j]);
      i = j;
    }
    return out;
  }

  _clearWalk(a, b) {
    const steps = Math.ceil(a.distanceTo(b) / (this.res * 0.6));
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
      const gy = this.world.groundHeight(x, z, 30);
      if (gy > this.maxFloor || !this.world.isFree(new THREE.Vector3(x, gy + 0.06, z), this.radius, this.height)) return false;
    }
    return true;
  }

  randomPoint() {
    for (let i = 0; i < 60; i++) {
      const n = this.nodes[(Math.random() * this.nodes.length) | 0];
      if (n && n.walkable) return new THREE.Vector3(n.x, n.y, n.z);
    }
    return new THREE.Vector3(0, 0, 0);
  }

  // Debug: build a points cloud of walkable cells.
  debugMesh() {
    const pts = [];
    for (const n of this.nodes) if (n.walkable) pts.push(n.x, n.y + 0.05, n.z);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return new THREE.Points(geo, new THREE.PointsMaterial({ color: 0x39ff8e, size: 0.12 }));
  }
}

// Tiny binary min-heap for A*.
class MinHeap {
  constructor() { this.items = []; this.prio = []; }
  get size() { return this.items.length; }
  push(item, p) {
    this.items.push(item); this.prio.push(p);
    let i = this.items.length - 1;
    while (i > 0) {
      const par = (i - 1) >> 1;
      if (this.prio[par] <= this.prio[i]) break;
      this._swap(i, par); i = par;
    }
  }
  pop() {
    const top = this.items[0];
    const last = this.items.length - 1;
    this._swap(0, last);
    this.items.pop(); this.prio.pop();
    let i = 0;
    const n = this.items.length;
    while (true) {
      const l = 2 * i + 1, r = 2 * i + 2; let s = i;
      if (l < n && this.prio[l] < this.prio[s]) s = l;
      if (r < n && this.prio[r] < this.prio[s]) s = r;
      if (s === i) break;
      this._swap(i, s); i = s;
    }
    return top;
  }
  _swap(a, b) {
    const ti = this.items[a]; this.items[a] = this.items[b]; this.items[b] = ti;
    const tp = this.prio[a]; this.prio[a] = this.prio[b]; this.prio[b] = tp;
  }
}
