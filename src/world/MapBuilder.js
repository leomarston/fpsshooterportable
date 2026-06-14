/**
 * MapBuilder — a faithful reconstruction of the de_dust2 *layout* (its
 * areas, flow and callouts) built from 100% original geometry and the
 * procedural AssetForge textures. No third-party art/models/map files.
 *
 * The playable space is laid out on a band grid (T spawn → three routes:
 * Long A / Mid / Tunnels-to-B → the two bombsites → CT spawn). Solid
 * "building" masses fill the non-playable negative space; floors stay at
 * y=0 with modest stepped elevation (catwalk, goose, back-plat) so the
 * auto-navmesh keeps every area connected.
 *
 *  X bands:  x0 -56 | a -44 | b -24 | c -8 | d 8 | e 18 | f 28 | g 44 | x1 56
 *  Z bands:  z0 -64 | t -50 | n -10 | m 16 | s 38 | z1 52        (north→south)
 *
 *      Bfar | Tunnels | W-bldg | MID | catwalk | E-bldg | LONG | pit
 *   ┌─────────────────  T SPAWN  ─────────────────┐
 *   │  uppertun │ ████ │ Tmid │ ████ │ ████ │ long │      Z2
 *   │  lowertun │ ████ │ CTmid│ catw │ ████ │ long │ pit  Z3
 *   │   B SITE        │█│ CTmid│   A   SITE        │      Z4
 *   │ ████ │   CT SPAWN      │ ████ │              │      Z5
 *   └──────────────────────────────────────────────┘
 */
import * as THREE from 'three';
import { Box } from './Collision.js';
import { roundedBox } from '../core/Geo.js';

const WALL_H = 6;
const DOOR_H = 3.4;
const BUILD_H = 8.5;   // solid building masses (tall, no peeking over)
const T = 1;

// band edges
const X = { x0: -56, a: -44, b: -24, c: -8, d: 8, e: 18, f: 28, g: 44, x1: 56 };
const Z = { z0: -64, t: -50, n: -10, m: 16, s: 38, z1: 52 };

export class MapBuilder {
  constructor(scene, world, forge) {
    this.scene = scene; this.world = world; this.forge = forge;
    this.group = new THREE.Group(); this.group.name = 'map'; scene.add(this.group);
    this.spawnsT = []; this.spawnsCT = []; this.sites = {}; this.lights = [];
    this.X0 = X.x0; this.X1 = X.x1; this.Z0 = Z.z0; this.Z1 = Z.z1;
  }

  /* ----------------------------- primitives ----------------------------- */
  box(cx, cy, cz, sx, sy, sz, mat, opts = {}) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    mesh.position.set(cx, cy, cz);
    mesh.castShadow = opts.cast ?? true; mesh.receiveShadow = opts.receive ?? true;
    this.group.add(mesh);
    if (opts.solid !== false)
      this.world.add(Box.fromCenter(cx, cy, cz, sx, sy, sz, opts.surface || 'concrete', true, opts.sight ?? true));
    return mesh;
  }
  deco(cx, cy, cz, sx, sy, sz, mat, opts = {}) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    mesh.position.set(cx, cy, cz);
    mesh.castShadow = opts.cast ?? true; mesh.receiveShadow = opts.receive ?? true;
    if (opts.rotY) mesh.rotation.y = opts.rotY;
    this.group.add(mesh);
    return mesh;
  }

  // Solid building mass filling non-playable space.
  fill(x0, x1, z0, z1, h = BUILD_H, mat = null) {
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, w = Math.abs(x1 - x0), d = Math.abs(z1 - z0);
    this.box(cx, h / 2, cz, w, h, d, mat || this.forge.sandstone(Math.max(2, Math.round(Math.max(w, d) / 8))), { surface: 'concrete' });
    // parapet cap
    this.deco(cx, h + 0.2, cz, w + 0.3, 0.4, d + 0.3, this.forge.plaster(2), { cast: false });
  }

  wallAlongX(z, xStart, xEnd, opts = {}) {
    const h = opts.h ?? WALL_H, t = opts.t ?? T, y0 = opts.y0 ?? 0;
    const mat = opts.mat || this.forge.sandstone(2), surface = opts.surface || 'concrete';
    const gaps = (opts.gaps || []).slice().sort((a, b) => a[0] - b[0]);
    let x = xStart; const segs = [];
    for (const [g0, g1] of gaps) { if (g0 > x) segs.push([x, g0]); x = Math.max(x, g1); }
    if (x < xEnd) segs.push([x, xEnd]);
    for (const [a, b] of segs) { const w = b - a; if (w <= 0.01) continue; this.box((a + b) / 2, y0 + h / 2, z, w, h, t, mat, { surface }); }
    for (const [g0, g1] of gaps) {
      if (opts.noLintel) continue; const w = g1 - g0; if (w <= 0.01) continue;
      this.box((g0 + g1) / 2, y0 + DOOR_H + (h - DOOR_H) / 2, z, w, h - DOOR_H, t, mat, { surface });
      if (opts.frame !== false) this._doorFrame((g0 + g1) / 2, z, w, true);
    }
  }
  wallAlongZ(x, zStart, zEnd, opts = {}) {
    const h = opts.h ?? WALL_H, t = opts.t ?? T, y0 = opts.y0 ?? 0;
    const mat = opts.mat || this.forge.sandstone(2), surface = opts.surface || 'concrete';
    const gaps = (opts.gaps || []).slice().sort((a, b) => a[0] - b[0]);
    let z = zStart; const segs = [];
    for (const [g0, g1] of gaps) { if (g0 > z) segs.push([z, g0]); z = Math.max(z, g1); }
    if (z < zEnd) segs.push([z, zEnd]);
    for (const [a, b] of segs) { const w = b - a; if (w <= 0.01) continue; this.box(x, y0 + h / 2, (a + b) / 2, t, h, w, mat, { surface }); }
    for (const [g0, g1] of gaps) {
      if (opts.noLintel) continue; const w = g1 - g0; if (w <= 0.01) continue;
      this.box(x, y0 + DOOR_H + (h - DOOR_H) / 2, (g0 + g1) / 2, t, h - DOOR_H, w, mat, { surface });
      if (opts.frame !== false) this._doorFrame(x, (g0 + g1) / 2, w, false);
    }
  }
  _doorFrame(cx, cz, w, alongX) {
    const wood = this.forge.wood(1);
    if (alongX) {
      this.deco(cx - w / 2, DOOR_H / 2, cz, 0.25, DOOR_H, 0.25, wood);
      this.deco(cx + w / 2, DOOR_H / 2, cz, 0.25, DOOR_H, 0.25, wood);
      this.deco(cx, DOOR_H + 0.05, cz, w + 0.4, 0.3, 0.3, wood);
    } else {
      this.deco(cx, DOOR_H / 2, cz - w / 2, 0.25, DOOR_H, 0.25, wood);
      this.deco(cx, DOOR_H / 2, cz + w / 2, 0.25, DOOR_H, 0.25, wood);
      this.deco(cx, DOOR_H + 0.05, cz, 0.3, 0.3, w + 0.4, wood);
    }
  }

  /* ------------------------------- props ------------------------------- */
  crate(cx, cz, size = 2, y = null, mat = null) {
    const s = size, baseY = y ?? this.world.groundHeight(cx, cz, 30);
    const mesh = new THREE.Mesh(roundedBox(s, s, s, s * 0.04, 3), mat || this.forge.wood(1));
    mesh.position.set(cx, baseY + s / 2, cz); mesh.rotation.y = (Math.random() - 0.5) * 0.12;
    mesh.castShadow = mesh.receiveShadow = true; this.group.add(mesh);
    this.world.add(Box.fromCenter(cx, baseY + s / 2, cz, s, s, s, 'wood', true, true));
    return baseY + s;
  }
  crateStack(cx, cz, opts = {}) {
    const base = this.world.groundHeight(cx, cz, 30);
    this.crate(cx, cz, 2, base); this.crate(cx + 2, cz + 0.3, 2, base);
    this.crate(cx + 1, cz + 0.1, 1.6, base + 2);
    if (opts.tall) this.crate(cx + 0.2, cz - 1.8, 1.4, base);
  }
  barrel(cx, cz, color = 'red') {
    const base = this.world.groundHeight(cx, cz, 30);
    const mat = color === 'red' ? this.forge.metalRed() : color === 'blue' ? this.forge.metalBlue() : this.forge.metalRust();
    const r = 0.45, hgt = 1.15;
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, hgt, 16), mat);
    mesh.position.set(cx, base + hgt / 2, cz); mesh.castShadow = mesh.receiveShadow = true; this.group.add(mesh);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(r, 0.05, 8, 18), this.forge.metalDark());
    rim.rotation.x = Math.PI / 2; rim.position.set(cx, base + hgt - 0.08, cz); this.group.add(rim);
    this.world.add(Box.fromCenter(cx, base + hgt / 2, cz, r * 1.9, hgt, r * 1.9, 'metal', true, false));
    return base + hgt;
  }
  sandbags(cx, cz, len = 3, rotY = 0) {
    const mat = this.forge.flat(0x9c8455, 0.95);
    const g = new THREE.Group(); const base = this.world.groundHeight(cx, cz, 30);
    for (let layer = 0; layer < 2; layer++) {
      const n = Math.floor(len / 0.6);
      for (let i = 0; i < n; i++) {
        const bag = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.34, 4, 8), mat);
        bag.rotation.z = Math.PI / 2;
        bag.position.set(-len / 2 + i * 0.6 + (layer * 0.3), 0.28 + layer * 0.42, 0);
        bag.castShadow = bag.receiveShadow = true; g.add(bag);
      }
    }
    g.position.set(cx, base, cz); g.rotation.y = rotY; this.group.add(g);
    this.world.add(Box.fromCenter(cx, base + 0.5, cz,
      Math.abs(Math.cos(rotY)) * len + Math.abs(Math.sin(rotY)) * 0.8 + 0.3, 1.0,
      Math.abs(Math.sin(rotY)) * len + Math.abs(Math.cos(rotY)) * 0.8 + 0.3, 'sand', true, false));
  }

  // Wrecked car (B site landmark).
  car(cx, cz, rotY = 0) {
    const g = new THREE.Group();
    const body = this.forge.metalRust(), dark = this.forge.metalDark(), glass = this.forge.flat(0x26333a, 0.2, 0.4);
    const chassis = new THREE.Mesh(roundedBox(4.4, 0.8, 2.0, 0.15), body); chassis.position.y = 0.7; g.add(chassis);
    const cabin = new THREE.Mesh(roundedBox(2.2, 1.0, 1.85, 0.2), body); cabin.position.set(-0.3, 1.55, 0); g.add(cabin);
    const wind = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.7, 1.6), glass); wind.position.set(0.85, 1.6, 0); g.add(wind);
    const hood = new THREE.Mesh(roundedBox(1.6, 0.5, 1.9, 0.12), body); hood.position.set(1.4, 1.0, 0); g.add(hood);
    for (const [wx, wz] of [[1.3, 1.0], [1.3, -1.0], [-1.3, 1.0], [-1.3, -1.0]]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.4, 14), this.forge.flat(0x15130f, 0.9));
      w.rotation.x = Math.PI / 2; w.position.set(wx, 0.5, wz); g.add(w);
    }
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    g.position.set(cx, 0, cz); g.rotation.y = rotY; g.rotation.z = 0.04; this.group.add(g);
    const along = Math.abs(Math.cos(rotY)) > 0.5;
    this.world.add(Box.fromCenter(cx, 1.0, cz, along ? 4.6 : 2.2, 2.0, along ? 2.2 : 4.6, 'metal', true, true));
  }

  archway(cx, cz, w = 4, alongX = true) {
    const mat = this.forge.sandstone(1); const colH = DOOR_H + 0.6;
    if (alongX) {
      this.box(cx - w / 2 - 0.3, colH / 2, cz, 0.7, colH, 1.2, mat); this.box(cx + w / 2 + 0.3, colH / 2, cz, 0.7, colH, 1.2, mat);
      this.deco(cx, colH + 0.3, cz, w + 1.6, 0.8, 1.3, mat);
    } else {
      this.box(cx, colH / 2, cz - w / 2 - 0.3, 1.2, colH, 0.7, mat); this.box(cx, colH / 2, cz + w / 2 + 0.3, 1.2, colH, 0.7, mat);
      this.deco(cx, colH + 0.3, cz, 1.3, 0.8, w + 1.6, mat);
    }
  }

  platform(cx, cz, w, d, height, mat = null, surface = 'concrete') {
    this.box(cx, height / 2, cz, w, height, d, mat || this.forge.concrete(2), { surface });
    return height;
  }
  // staircase ascending in a direction; dir: +1/-1 along x, +2/-2 along z
  steps(cx, cz, dir, count, rise, run, width, mat = null) {
    mat = mat || this.forge.concrete(2);
    for (let i = 0; i < count; i++) {
      const h = (i + 1) * rise;
      if (Math.abs(dir) === 1) this.box(cx + dir * (i * run), h / 2, cz, run, h, width, mat, { surface: 'concrete' });
      else this.box(cx, h / 2, cz + Math.sign(dir) * (i * run), width, h, run, mat, { surface: 'concrete' });
    }
  }
  railing(x0, z0, x1, z1, h = 1.0) {
    const wood = this.forge.wood(1);
    const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz), cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const rot = Math.atan2(dz, dx);
    const top = this.deco(cx, h, cz, len, 0.08, 0.08, wood); top.rotation.y = -rot;
    const n = Math.max(2, Math.round(len / 1.6));
    for (let i = 0; i <= n; i++) {
      const t = i / n; this.deco(x0 + dx * t, h / 2, z0 + dz * t, 0.08, h, 0.08, wood);
    }
  }
  tarp(cx, cy, cz, w, h, color = 0xb04a32, rotY = 0) {
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.95, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h, 6, 4), mat);
    const pos = mesh.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setZ(i, Math.sin(pos.getX(i) * 1.5) * 0.12 + Math.sin(pos.getY(i) * 2) * 0.05);
    pos.needsUpdate = true; mesh.geometry.computeVertexNormals();
    mesh.position.set(cx, cy, cz); mesh.rotation.y = rotY; mesh.castShadow = true; this.group.add(mesh);
  }
  pointLight(x, y, z, color, intensity, dist) {
    const l = new THREE.PointLight(color, intensity, dist, 2); l.position.set(x, y, z);
    this.group.add(l); this.lights.push(l); return l;
  }
  _palm(x, z) {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 5, 8), this.forge.flat(0x6b4f2c, 0.95));
    trunk.position.set(x, 2.5, z); trunk.castShadow = true; this.group.add(trunk);
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x5f7a35, roughness: 0.9, flatShading: true });
    for (let i = 0; i < 7; i++) {
      const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.5, 3.2, 4), leafMat);
      leaf.position.set(x + Math.cos((i / 7) * Math.PI * 2) * 1.3, 5, z + Math.sin((i / 7) * Math.PI * 2) * 1.3);
      leaf.rotation.z = Math.PI / 2.6; leaf.rotation.y = (i / 7) * Math.PI * 2; leaf.castShadow = true; this.group.add(leaf);
    }
    this.world.add(Box.fromCenter(x, 2.5, z, 0.7, 5, 0.7, 'wood', true, false));
  }

  /* --------------------------- dressing helpers --------------------------- */
  lamp(x, y, z, color = 0xffc878) {
    this.deco(x, y + 0.1, z, 0.14, 0.5, 0.14, this.forge.metalDark(), { cast: false });
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 10),
      new THREE.MeshStandardMaterial({ color: 0xfff2cf, emissive: color, emissiveIntensity: 2.6, roughness: 0.4 }));
    bulb.position.set(x, y - 0.12, z); this.group.add(bulb);
    this.pointLight(x, y - 0.05, z, color, 5.5, 13);
  }
  bush(x, z, scale = 1) {
    const base = this.world.groundHeight(x, z, 30);
    const mat = new THREE.MeshStandardMaterial({ color: 0x536e2f, roughness: 0.95, flatShading: true });
    const g = new THREE.Group();
    for (let i = 0; i < 6; i++) {
      const s = (0.35 + Math.random() * 0.45) * scale;
      const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 1), mat);
      blob.position.set((Math.random() - 0.5) * 0.9 * scale, s * 0.7 + Math.random() * 0.2, (Math.random() - 0.5) * 0.9 * scale);
      blob.castShadow = blob.receiveShadow = true; g.add(blob);
    }
    g.position.set(x, base, z); this.group.add(g);
  }
  cable(a, b, sag = 1.3) {
    const mid = a.clone().add(b).multiplyScalar(0.5); mid.y -= sag;
    const curve = new THREE.CatmullRomCurve3([a, mid, b]);
    const m = new THREE.Mesh(new THREE.TubeGeometry(curve, 18, 0.03, 6, false), this.forge.flat(0x14130f, 0.85));
    m.castShadow = true; this.group.add(m);
  }
  ammoCrate(x, z, rotY = null) {
    const base = this.world.groundHeight(x, z, 30); const r = rotY ?? (Math.random() - 0.5) * 0.5;
    const w = 1.5, h = 0.95, d = 0.85;
    const m = new THREE.Mesh(roundedBox(w, h, d, 0.06), this.forge.metalGreen());
    m.position.set(x, base + h / 2, z); m.rotation.y = r; m.castShadow = m.receiveShadow = true; this.group.add(m);
    const lid = new THREE.Mesh(roundedBox(w * 1.04, 0.14, d * 1.04, 0.04), this.forge.metalDark());
    lid.position.set(x, base + h - 0.02, z); lid.rotation.y = r; lid.castShadow = true; this.group.add(lid);
    this.world.add(Box.fromCenter(x, base + h / 2, z, w, h, d, 'metal', true, true));
  }
  rubble(x, z, n = 7) {
    const base = this.world.groundHeight(x, z, 30);
    const mat = new THREE.MeshStandardMaterial({ color: 0x8a8174, roughness: 0.95, flatShading: true });
    for (let i = 0; i < n; i++) {
      const s = 0.14 + Math.random() * 0.34; const r = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), mat);
      r.position.set(x + (Math.random() - 0.5) * 2.4, base + s * 0.45, z + (Math.random() - 0.5) * 2.4);
      r.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3); r.castShadow = r.receiveShadow = true; this.group.add(r);
    }
  }
  scaffold(x, z, rotY = 0) {
    const base = this.world.groundHeight(x, z, 30); const wood = this.forge.wood(1); const g = new THREE.Group();
    for (const dx of [-1.1, 1.1]) { const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.09, 4.2, 8), wood); pole.position.set(dx, 2.1, 0); pole.castShadow = true; g.add(pole); }
    for (const yy of [1.3, 2.7, 3.9]) { const plank = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.12, 0.55), wood); plank.position.set(0, yy, 0); plank.castShadow = true; g.add(plank); }
    g.position.set(x, base, z); g.rotation.y = rotY; this.group.add(g);
  }
  _scatterRocks(count = 30) {
    const mat = new THREE.MeshStandardMaterial({ color: 0x877e70, roughness: 0.96, flatShading: true });
    for (let i = 0; i < count; i++) {
      const x = this.X0 + 2 + Math.random() * (this.X1 - this.X0 - 4), z = this.Z0 + 2 + Math.random() * (this.Z1 - this.Z0 - 4);
      const gy = this.world.groundHeight(x, z, 30); if (gy > 0.4) continue;
      if (!this.world.isFree(new THREE.Vector3(x, gy + 0.05, z), 0.3, 0.9)) continue;
      const s = 0.1 + Math.random() * 0.22; const r = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), mat);
      r.position.set(x, gy + s * 0.4, z); r.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3); r.castShadow = true; this.group.add(r);
    }
  }

  /* =================================================================== */
  build() {
    const sand = this.forge.sand(20);
    // ground
    const W = X.x1 - X.x0, D = Z.z1 - Z.z0, cx = (X.x0 + X.x1) / 2, cz = (Z.z0 + Z.z1) / 2;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(W + 40, D + 40), sand);
    ground.rotation.x = -Math.PI / 2; ground.position.set(cx, 0.001, cz); ground.receiveShadow = true; this.group.add(ground);
    this.world.add(Box.fromCenter(cx, -1, cz, W + 60, 2, D + 60, 'sand', true, false));
    // outer dunes
    for (let i = 0; i < 24; i++) {
      const ang = (i / 24) * Math.PI * 2, rad = 78 + Math.random() * 28;
      const dune = new THREE.Mesh(new THREE.SphereGeometry(8 + Math.random() * 10, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), this.forge.sand(4));
      dune.scale.y = 0.25 + Math.random() * 0.25; dune.position.set(cx + Math.cos(ang) * rad, -0.5, cz + Math.sin(ang) * rad);
      dune.receiveShadow = true; this.group.add(dune);
    }
    // perimeter
    const ph = WALL_H + 2;
    this.wallAlongX(Z.z0, X.x0, X.x1, { h: ph, noLintel: true });
    this.wallAlongX(Z.z1, X.x0, X.x1, { h: ph, noLintel: true });
    this.wallAlongZ(X.x0, Z.z0, Z.z1, { h: ph, noLintel: true });
    this.wallAlongZ(X.x1, Z.z0, Z.z1, { h: ph, noLintel: true });

    this._buildings();
    this._tSpawn();
    this._mid();
    this._longAndA();
    this._tunnelsAndB();
    this._ctSpawn();
    this._dress();

    this.sites.A = { center: new THREE.Vector3(30, 0, 26), radius: 10 };
    this.sites.B = { center: new THREE.Vector3(-37, 0, 24), radius: 10 };
    this._siteMarker(this.sites.A.center, 'A');
    this._siteMarker(this.sites.B.center, 'B');

    return { spawnsT: this.spawnsT, spawnsCT: this.spawnsCT, sites: this.sites,
      bounds: { x0: X.x0, x1: X.x1, z0: Z.z0, z1: Z.z1 }, group: this.group };
  }

  // Solid masses filling the non-playable negative space (the "buildings").
  _buildings() {
    // West edge mass (north of B back-plat) + south of B
    this.fill(X.x0, X.a, Z.z0, Z.m);          // X1 Z1-Z3
    this.fill(X.x0, X.a, Z.s, Z.z1);          // X1 Z5 (south of B)
    // East edge mass (north of pit) + east of pit + south of A
    this.fill(X.g, X.x1, Z.z0, Z.n);          // X8 Z1-Z2
    this.fill(54, X.x1, Z.n, Z.m);            // east wall of pit
    this.fill(X.g, X.x1, Z.m, Z.z1);          // X8 Z4-Z5
    // West-central building (between tunnels/B and mid)
    this.fill(X.b, X.c, Z.t, 24);             // X3 Z2-Z3 + north of B-doors
    this.fill(X.b, -12, Z.s, Z.z1);           // X3 south sliver (west of CT spawn)
    // East-central building (between mid/catwalk and long, T side)
    this.fill(X.d, X.f, Z.t, Z.n);            // X5-X6 Z2 (T mid<->long)
    this.fill(X.e, X.f, Z.n, Z.m);            // X6 Z3 (mid-belt)
    // South-of-A mass
    this.fill(X.f, X.g, Z.s, Z.z1);           // X7 Z5
    // CT-mid / A-site divider wall (no door; A is via catwalk/long/ramp)
    this.wallAlongZ(X.d, Z.m, Z.s, { gaps: [] });
  }

  _tSpawn() {
    for (const [x, z] of [[-36, -58], [-24, -58], [-12, -59], [0, -59], [12, -59], [24, -58], [36, -58], [-18, -54], [18, -54]])
      this.spawnsT.push(new THREE.Vector3(x, 0, z));
    // T banner + cover
    this.deco(0, 4, Z.z0 + 0.6, 12, 3, 0.2, this.forge.flat(0x8a5a2a, 0.9));
    this.crateStack(-38, -55); this.crate(38, -55, 2.2);
    this.barrel(-2, -57, 'rust'); this.barrel(2, -57.6, 'red');
    this.sandbags(10, -52.5, 5, 0);
    // long doors (T -> long)
    this.archway(36, Z.t, 6, true);
    this.tarp(-26, 4.2, Z.z0 + 0.7, 6, 3, 0xb04a32);
  }

  _mid() {
    // mid doors at Z=n across X4 with a central double-door gap
    this.wallAlongX(Z.n, X.c, X.d, { mat: this.forge.plaster(2), gaps: [[-2.2, 2.2]] });
    this.deco(-1.1, DOOR_H / 2, Z.n, 2.0, DOOR_H, 0.16, this.forge.metalBlue());
    this.deco(1.1, DOOR_H / 2, Z.n, 2.0, DOOR_H, 0.16, this.forge.metalBlue());
    // Xbox (jumpable crate in T mid)
    this.crate(2, -22, 2.0);
    this.barrel(-4, -30, 'red'); this.barrel(5, -16, 'rust');
    // CT mid cover
    this.crate(-3, 6, 2.0); this.barrel(4, 14, 'blue');
    this._palm(-5, -40); this._palm(5, 28);
    this.pointLight(0, 4.5, Z.n, 0xffeccb, 5, 16);

    // catwalk: raised walkway from CT mid (west) over to A short (south)
    const cw = 1.0;
    this.platform((X.d + X.e) / 2, 3, X.e - X.d, 26, cw, this.forge.concrete(2)); // X5 Z[-10,16] raised
    this.steps(X.d - 0.5, -7, 1, 2, 0.5, 0.7, 5);   // up from CT mid (east)
    this.steps(13, Z.m + 0.5, -2, 2, 0.5, 0.7, 8);  // down into A short (south)
    this.railing(X.d + 0.2, Z.n + 1, X.d + 0.2, Z.m - 1, cw + 0.9);
    this.railing(X.e - 0.2, Z.n + 1, X.e - 0.2, 6, cw + 0.9);
  }

  _longAndA() {
    // Long A corridor cover (X7 Z2-Z3)
    this.crate(31, -34, 2.2); this.crate(33, -31, 1.8);
    this.barrel(41, -20, 'rust'); this.barrel(40, -19, 'red');
    this.sandbags(30, -2, 5, Math.PI / 2);
    // Pit (X8 Z3) — a CT hold cubby east of long, opening to long
    this.platform(49, 9, 10, 14, 0.5, this.forge.concrete(2));   // slightly raised pit floor
    this.steps(44.5, 9, 1, 1, 0.5, 1.0, 14);                     // lip up from long into pit (nav-climbable)
    this.crate(50, 4, 2);
    this.archway(X.g, 9, 8, false);                              // long<->pit mouth

    // A SITE (X[8,44] Z[16,38])
    // goose / A platform (raised) at NW of site
    this.platform(20, 22, 10, 9, 1.4, this.forge.concrete(2));
    this.steps(25.5, 22, 1, 3, 0.5, 0.7, 9);                     // ramp up onto goose (from site centre)
    // default crates (plant spots)
    this.crate(30, 26, 2.4); this.crate(32, 24, 2.0); this.crateStack(36, 30);
    this.barrel(27, 33, 'red'); this.barrel(38, 22, 'blue');
    this.ammoCrate(33, 33);
    // CT ramp into A (south edge shared with CT spawn at X[16,28] Z=s) — a short step up
    this.steps(22, Z.s - 0.5, -2, 1, 0.5, 1.0, 12);
    this.tarp(X.g - 1, 4.5, 26, 6, 3, 0xb89a55, Math.PI / 2);
    this.pointLight(30, 4.5, 26, 0xffdca0, 7, 26);
  }

  _tunnelsAndB() {
    // Upper/Lower tunnels (X2): a mid pillar to suggest upper/lower split
    this.crate(-40, -40, 2); this.crate(-38, -37, 1.6);
    this.deco(-34, 3, -22, 1.6, 6, 6, this.forge.sandstone(1)); // tunnel pillar
    this.barrel(-28, -6, 'rust');
    this.archway(X.b, 10, 7, false);   // tunnels/B doors region

    // B SITE (X[-56,-24] Z[16,38])
    this.car(-37, 24, 0);              // the car
    this.crate(-28, 20, 2.2); this.crate(-30, 22, 1.8); this.crateStack(-46, 28);
    this.barrel(-26, 30, 'blue'); this.barrel(-25, 32, 'red');
    this.ammoCrate(-31, 31);
    // back-plat (raised platform at the back/west of B)
    this.platform(-51, 22, 8, 14, 1.2, this.forge.concrete(2));
    this.steps(-47.5, 22, 1, 2, 0.6, 0.8, 14);  // ramp up to back-plat from site
    this.sandbags(-33, 16.5, 5, 0);
    // B doors (CT -> B) opening in the X3 building at Z[24,38] is already open;
    this.archway(-13, 30, 6, false);
    this.tarp(X.x0 + 1, 4.5, 24, 6, 3, 0x35506e, Math.PI / 2);
    this.pointLight(-37, 4.5, 24, 0xffdca0, 7, 26);
  }

  _ctSpawn() {
    for (const [x, z] of [[0, 46], [-6, 47], [6, 47], [12, 45], [-10, 44], [18, 44], [-4, 42], [10, 42]])
      this.spawnsCT.push(new THREE.Vector3(x, 0, z));
    this.crate(-8, 44, 2); this.crate(22, 43, 2);
    this.sandbags(4, 49, 6, 0);
    this.crateStack(16, 40);
    this.barrel(-6, 40, 'blue'); this.barrel(20, 39, 'blue');
    this.tarp(0, 4.4, Z.z1 - 0.6, 8, 3, 0x35506e);
    this.pointLight(6, 4.5, 44, 0xffe6b0, 6, 22);
  }

  _siteMarker(center, label) {
    const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
    g.clearRect(0, 0, 256, 256); g.strokeStyle = 'rgba(230,210,140,0.85)'; g.lineWidth = 10; g.strokeRect(24, 24, 208, 208);
    g.fillStyle = 'rgba(230,210,140,0.9)'; g.font = 'bold 150px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(label, 128, 138);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(7, 7), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.9 }));
    m.rotation.x = -Math.PI / 2; m.position.set(center.x, 0.04, center.z); this.group.add(m);
  }

  _dress() {
    // architecture on the perimeter
    this._dressWallLine('x', Z.z0, X.x0, X.x1, WALL_H + 2);
    this._dressWallLine('x', Z.z1, X.x0, X.x1, WALL_H + 2);
    this._dressWallLine('z', X.x0, Z.z0, Z.z1, WALL_H + 2);
    this._dressWallLine('z', X.x1, Z.z0, Z.z1, WALL_H + 2);
    // lamps for atmosphere (key choke points)
    for (const [x, z] of [[X.c + 0.6, -20], [X.d - 0.6, -20], [X.f + 0.6, -16], [X.b + 0.6, -2],
                          [X.c - 0.6, 6], [30, 18], [-37, 16], [6, 40], [49, 2]]) this.lamp(x, 4.3, z);
    // vegetation
    for (const [x, z] of [[-42, -58], [42, -58], [-50, 30], [50, 30], [-20, 48], [24, 48], [12, -46]])
      this.bush(x, z, 0.9 + Math.random() * 0.6);
    // cables
    this.cable(new THREE.Vector3(X.c, 5.2, -24), new THREE.Vector3(X.d, 5.0, -24));
    this.cable(new THREE.Vector3(X.b, 5.0, 4), new THREE.Vector3(X.c, 5.2, 4));
    this.cable(new THREE.Vector3(X.f, 5.0, -30), new THREE.Vector3(X.g, 5.4, -30));
    // misc props
    this.rubble(-44, -6); this.rubble(45, -8); this.rubble(-30, 34);
    this.scaffold(X.x0 + 1.6, 30, Math.PI / 2); this.scaffold(X.x1 - 1.6, -4, -Math.PI / 2);
    this._scatterRocks();
  }

  _dressWallLine(axis, fixed, a, b, h = WALL_H) {
    const plaster = this.forge.plaster(2), stone = this.forge.sandstone(1);
    const len = Math.abs(b - a), mid = (a + b) / 2;
    if (axis === 'x') {
      this.deco(mid, h - 0.12, fixed, len, 0.55, 1.6, plaster, { cast: false });
      this.deco(mid, 0.4, fixed, len, 0.8, 1.55, plaster, { cast: false });
    } else {
      this.deco(fixed, h - 0.12, mid, 1.6, 0.55, len, plaster, { cast: false });
      this.deco(fixed, 0.4, mid, 1.55, 0.8, len, plaster, { cast: false });
    }
    const step = 11, n = Math.floor(len / step);
    for (let i = 1; i < n; i++) {
      const t = a + (i * len) / n;
      if (axis === 'x') this.deco(t, (h - 0.7) / 2 + 0.4, fixed, 1.1, h - 1.0, 1.7, stone);
      else this.deco(fixed, (h - 0.7) / 2 + 0.4, t, 1.7, h - 1.0, 1.1, stone);
    }
  }
}
