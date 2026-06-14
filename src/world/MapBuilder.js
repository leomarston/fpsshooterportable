/**
 * MapBuilder — "de_dust II"-inspired desert competition map (original geometry).
 *
 * Layout is a readable three-lane bomb-defusal arena evoking dust2:
 *
 *                       NORTH  (T SPAWN, spans all lanes)
 *   +----------------------------------------------------------+
 *   |  UPPER TUNNELS   |     T MID        |     LONG A          |
 *   |   (B lane)       |  [mid doors]     |   (A lane)          |
 *   |                  |                  |                     |
 *   |  LOWER TUNNELS   |     CT MID       |     LONG A / PIT    |
 *   +---- door --------+----- door -------+------ door ---------+
 *   |   BOMBSITE B     |    CT SPAWN      |    BOMBSITE A       |
 *   |   [truck+crates] |                  |   [platform+crates] |
 *   +----------------------------------------------------------+
 *                       SOUTH
 *
 * Builds visual meshes (into a group) and AABB colliders (into the
 * CollisionWorld), and returns spawn points, bombsite info and props.
 */
import * as THREE from 'three';
import { Box } from './Collision.js';
import { roundedBox } from '../core/Geo.js';

const WALL_H = 6;
const DOOR_H = 3.4;
const T = 1; // wall thickness

export class MapBuilder {
  constructor(scene, world, forge) {
    this.scene = scene;
    this.world = world;
    this.forge = forge;
    this.group = new THREE.Group();
    this.group.name = 'map';
    scene.add(this.group);

    this.spawnsT = [];
    this.spawnsCT = [];
    this.sites = {};
    this.props = [];
    this.lights = [];

    // map extents
    this.X0 = -42; this.X1 = 42;
    this.Z0 = -52; this.Z1 = 52;
  }

  /* ----------------------------- primitives ----------------------------- */

  // Solid box: adds a mesh and a collider.
  box(cx, cy, cz, sx, sy, sz, mat, opts = {}) {
    const geo = new THREE.BoxGeometry(sx, sy, sz);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(cx, cy, cz);
    mesh.castShadow = opts.cast ?? true;
    mesh.receiveShadow = opts.receive ?? true;
    this.group.add(mesh);
    if (opts.solid !== false) {
      this.world.add(Box.fromCenter(cx, cy, cz, sx, sy, sz,
        opts.surface || 'concrete', true, opts.sight ?? true));
    }
    return mesh;
  }

  // Visual-only box (no collider).
  deco(cx, cy, cz, sx, sy, sz, mat, opts = {}) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    mesh.position.set(cx, cy, cz);
    mesh.castShadow = opts.cast ?? true;
    mesh.receiveShadow = opts.receive ?? true;
    if (opts.rotY) mesh.rotation.y = opts.rotY;
    this.group.add(mesh);
    return mesh;
  }

  // Wall running along X at constant z. gaps:[[x1,x2]...] are doorways.
  wallAlongX(z, xStart, xEnd, opts = {}) {
    const h = opts.h ?? WALL_H, t = opts.t ?? T, y0 = opts.y0 ?? 0;
    const mat = opts.mat || this.forge.sandstone(2);
    const surface = opts.surface || 'concrete';
    const gaps = (opts.gaps || []).slice().sort((a, b) => a[0] - b[0]);
    let x = xStart;
    const segs = [];
    for (const [g0, g1] of gaps) { if (g0 > x) segs.push([x, g0]); x = Math.max(x, g1); }
    if (x < xEnd) segs.push([x, xEnd]);
    for (const [a, b] of segs) {
      const w = b - a; if (w <= 0.01) continue;
      this.box((a + b) / 2, y0 + h / 2, z, w, h, t, mat, { surface });
    }
    // lintels above doorways
    for (const [g0, g1] of gaps) {
      if (opts.noLintel) continue;
      const w = g1 - g0; if (w <= 0.01) continue;
      this.box((g0 + g1) / 2, y0 + DOOR_H + (h - DOOR_H) / 2, z, w, h - DOOR_H, t, mat, { surface });
      if (opts.frame !== false) this._doorFrame((g0 + g1) / 2, z, w, true);
    }
  }

  // Wall running along Z at constant x.
  wallAlongZ(x, zStart, zEnd, opts = {}) {
    const h = opts.h ?? WALL_H, t = opts.t ?? T, y0 = opts.y0 ?? 0;
    const mat = opts.mat || this.forge.sandstone(2);
    const surface = opts.surface || 'concrete';
    const gaps = (opts.gaps || []).slice().sort((a, b) => a[0] - b[0]);
    let z = zStart;
    const segs = [];
    for (const [g0, g1] of gaps) { if (g0 > z) segs.push([z, g0]); z = Math.max(z, g1); }
    if (z < zEnd) segs.push([z, zEnd]);
    for (const [a, b] of segs) {
      const w = b - a; if (w <= 0.01) continue;
      this.box(x, y0 + h / 2, (a + b) / 2, t, h, w, mat, { surface });
    }
    for (const [g0, g1] of gaps) {
      if (opts.noLintel) continue;
      const w = g1 - g0; if (w <= 0.01) continue;
      this.box(x, y0 + DOOR_H + (h - DOOR_H) / 2, (g0 + g1) / 2, t, h - DOOR_H, w, mat, { surface });
      if (opts.frame !== false) this._doorFrame(x, (g0 + g1) / 2, w, false);
    }
  }

  // A wooden door frame around an opening (decorative).
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
    const s = size;
    const baseY = y ?? this.world.groundHeight(cx, cz, 30);
    // beveled visual mesh (edges catch light) + AABB collider
    const mesh = new THREE.Mesh(roundedBox(s, s, s, s * 0.04, 3), mat || this.forge.wood(1));
    mesh.position.set(cx, baseY + s / 2, cz);
    mesh.rotation.y = (Math.random() - 0.5) * 0.12;
    mesh.castShadow = mesh.receiveShadow = true;
    this.group.add(mesh);
    this.world.add(Box.fromCenter(cx, baseY + s / 2, cz, s, s, s, 'wood', true, true));
    return baseY + s; // top height
  }

  crateStack(cx, cz, opts = {}) {
    // a little cluster of crates of varied sizes
    const base = this.world.groundHeight(cx, cz, 30);
    this.crate(cx, cz, 2, base);
    this.crate(cx + 2, cz + 0.3, 2, base);
    this.crate(cx + 1, cz + 0.1, 1.6, base + 2);
    if (opts.tall) this.crate(cx + 0.2, cz - 1.8, 1.4, base);
  }

  barrel(cx, cz, color = 'red') {
    const base = this.world.groundHeight(cx, cz, 30);
    const mat = color === 'red' ? this.forge.metalRed() : color === 'blue' ? this.forge.metalBlue() : this.forge.metalRust();
    const r = 0.45, hgt = 1.15;
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, hgt, 16), mat);
    mesh.position.set(cx, base + hgt / 2, cz);
    mesh.castShadow = mesh.receiveShadow = true;
    this.group.add(mesh);
    // rim
    const rim = new THREE.Mesh(new THREE.TorusGeometry(r, 0.05, 8, 18), this.forge.metalDark());
    rim.rotation.x = Math.PI / 2; rim.position.set(cx, base + hgt - 0.08, cz);
    this.group.add(rim);
    this.world.add(Box.fromCenter(cx, base + hgt / 2, cz, r * 1.9, hgt, r * 1.9, 'metal', true, false));
    return base + hgt;
  }

  sandbags(cx, cz, len = 3, rotY = 0) {
    const mat = this.forge.flat(0x9c8455, 0.95);
    const g = new THREE.Group();
    const base = this.world.groundHeight(cx, cz, 30);
    for (let layer = 0; layer < 2; layer++) {
      const n = Math.floor(len / 0.6);
      for (let i = 0; i < n; i++) {
        const bag = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.34, 4, 8), mat);
        bag.rotation.z = Math.PI / 2;
        bag.position.set(-len / 2 + i * 0.6 + (layer * 0.3), 0.28 + layer * 0.42, 0);
        bag.castShadow = bag.receiveShadow = true;
        g.add(bag);
      }
    }
    g.position.set(cx, base, cz); g.rotation.y = rotY;
    this.group.add(g);
    this.world.add(Box.fromCenter(cx, base + 0.5, cz,
      Math.abs(Math.cos(rotY)) * len + Math.abs(Math.sin(rotY)) * 0.8 + 0.3, 1.0,
      Math.abs(Math.sin(rotY)) * len + Math.abs(Math.cos(rotY)) * 0.8 + 0.3, 'sand', true, false));
  }

  // Cargo truck — the hero prop at bombsite B.
  truck(cx, cz, rotY = 0) {
    const g = new THREE.Group();
    const body = this.forge.metalGreen();
    const dark = this.forge.metalDark();
    const glass = this.forge.flat(0x2a3640, 0.2, 0.4);
    // chassis
    const chassis = new THREE.Mesh(new THREE.BoxGeometry(7.5, 0.7, 2.6), dark);
    chassis.position.y = 0.9; g.add(chassis);
    // cargo box
    const cargo = new THREE.Mesh(new THREE.BoxGeometry(4.6, 2.6, 2.6), body);
    cargo.position.set(-1.3, 2.4, 0); g.add(cargo);
    // canvas top
    const top = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.4, 2.7), this.forge.flat(0x6b5d3e, 0.95));
    top.position.set(-1.3, 3.85, 0); g.add(top);
    // cab
    const cab = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.0, 2.5), body);
    cab.position.set(2.6, 2.1, 0); g.add(cab);
    const hood = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.0, 2.4), body);
    hood.position.set(3.9, 1.6, 0); g.add(hood);
    const windshield = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.0, 2.2), glass);
    windshield.position.set(1.6, 2.5, 0); g.add(windshield);
    // wheels
    const wheelGeo = new THREE.CylinderGeometry(0.7, 0.7, 0.5, 16);
    for (const [wx, wz] of [[2.6, 1.2], [2.6, -1.2], [-1.6, 1.2], [-1.6, -1.2], [-3.1, 1.2], [-3.1, -1.2]]) {
      const w = new THREE.Mesh(wheelGeo, this.forge.flat(0x16140f, 0.9));
      w.rotation.x = Math.PI / 2; w.position.set(wx, 0.7, wz);
      w.castShadow = true; g.add(w);
    }
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    g.position.set(cx, 0, cz); g.rotation.y = rotY;
    this.group.add(g);
    // collider (approximate, axis-aligned wrt rotation 0/90)
    const along = Math.abs(Math.cos(rotY)) > 0.5;
    this.world.add(Box.fromCenter(cx, 2.2, cz, along ? 7.6 : 2.7, 4.4, along ? 2.7 : 7.6, 'metal', true, true));
    return g;
  }

  archway(cx, cz, w = 4, alongX = true) {
    const mat = this.forge.sandstone(1);
    const colH = DOOR_H + 0.6;
    if (alongX) {
      this.box(cx - w / 2 - 0.3, colH / 2, cz, 0.7, colH, 1.2, mat, { surface: 'concrete' });
      this.box(cx + w / 2 + 0.3, colH / 2, cz, 0.7, colH, 1.2, mat, { surface: 'concrete' });
      this.deco(cx, colH + 0.3, cz, w + 1.6, 0.8, 1.3, mat);
    } else {
      this.box(cx, colH / 2, cz - w / 2 - 0.3, 1.2, colH, 0.7, mat, { surface: 'concrete' });
      this.box(cx, colH / 2, cz + w / 2 + 0.3, 1.2, colH, 0.7, mat, { surface: 'concrete' });
      this.deco(cx, colH + 0.3, cz, 1.3, 0.8, w + 1.6, mat);
    }
  }

  // Raised platform with steps up one side (the "goose"/A platform).
  platform(cx, cz, w, d, height, mat = null, surface = 'concrete') {
    mat = mat || this.forge.concrete(2);
    this.box(cx, height / 2, cz, w, height, d, mat, { surface });
    return height; // top y
  }

  steps(cx, cz, dir, count, stepRise, stepRun, width, mat = null) {
    // dir: +1 ascends toward +x; -1 toward -x; 2 toward +z; -2 toward -z
    mat = mat || this.forge.concrete(2);
    for (let i = 0; i < count; i++) {
      const h = (i + 1) * stepRise;
      if (Math.abs(dir) === 1) {
        const x = cx + dir * (i * stepRun);
        this.box(x, h / 2, cz, stepRun, h, width, mat, { surface: 'concrete' });
      } else {
        const z = cz + Math.sign(dir) * (i * stepRun);
        this.box(cx, h / 2, z, width, h, stepRun, mat, { surface: 'concrete' });
      }
    }
  }

  // a hanging cloth/tarp (decor)
  tarp(cx, cy, cz, w, h, color = 0xb04a32, rotY = 0) {
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.95, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h, 6, 4), mat);
    const pos = mesh.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      pos.setZ(i, Math.sin(pos.getX(i) * 1.5) * 0.12 + Math.sin(pos.getY(i) * 2) * 0.05);
    }
    pos.needsUpdate = true; mesh.geometry.computeVertexNormals();
    mesh.position.set(cx, cy, cz); mesh.rotation.y = rotY;
    mesh.castShadow = true; this.group.add(mesh);
  }

  pointLight(x, y, z, color, intensity, dist) {
    const l = new THREE.PointLight(color, intensity, dist, 2);
    l.position.set(x, y, z);
    this.group.add(l); this.lights.push(l);
    return l;
  }

  /* --------------------- architectural dressing --------------------- */

  // Cornice cap + base skirting + protruding pilasters along a wall line,
  // turning flat slabs into architecture that catches light.
  _dressWallLine(axis, fixed, a, b, h = WALL_H) {
    const plaster = this.forge.plaster(2);
    const stone = this.forge.sandstone(1);
    const len = Math.abs(b - a), mid = (a + b) / 2;
    if (axis === 'x') {
      this.deco(mid, h - 0.12, fixed, len, 0.55, 1.6, plaster, { cast: false });   // cornice
      this.deco(mid, h - 0.5, fixed, len, 0.16, 1.75, stone, { cast: false });      // shadow reveal
      this.deco(mid, 0.4, fixed, len, 0.8, 1.55, plaster, { cast: false });         // base skirt
    } else {
      this.deco(fixed, h - 0.12, mid, 1.6, 0.55, len, plaster, { cast: false });
      this.deco(fixed, h - 0.5, mid, 1.75, 0.16, len, stone, { cast: false });
      this.deco(fixed, 0.4, mid, 1.55, 0.8, len, plaster, { cast: false });
    }
    const step = 9, n = Math.floor(len / step);
    for (let i = 1; i < n; i++) {
      const t = a + (i * len) / n;
      if (axis === 'x') this.deco(t, (h - 0.7) / 2 + 0.4, fixed, 1.1, h - 1.0, 1.85, stone);
      else this.deco(fixed, (h - 0.7) / 2 + 0.4, t, 1.85, h - 1.0, 1.1, stone);
    }
  }

  // Wall sconce: bracket + glowing bulb + warm point light (bloom-lit).
  lamp(x, y, z, color = 0xffc878) {
    this.deco(x, y + 0.1, z, 0.14, 0.5, 0.14, this.forge.metalDark(), { cast: false });
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 10),
      new THREE.MeshStandardMaterial({ color: 0xfff2cf, emissive: color, emissiveIntensity: 2.6, roughness: 0.4 }));
    bulb.position.set(x, y - 0.12, z); this.group.add(bulb);
    this.pointLight(x, y - 0.05, z, color, 5.5, 13);
  }

  // Low-poly flat-shaded foliage clump.
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

  // Drooping power/comm cable between two points (catenary).
  cable(a, b, sag = 1.3) {
    const mid = a.clone().add(b).multiplyScalar(0.5); mid.y -= sag;
    const curve = new THREE.CatmullRomCurve3([a, mid, b]);
    const geo = new THREE.TubeGeometry(curve, 18, 0.03, 6, false);
    const m = new THREE.Mesh(geo, this.forge.flat(0x14130f, 0.85));
    m.castShadow = true; this.group.add(m);
  }

  // Metal military ammo crate.
  ammoCrate(x, z, rotY = null) {
    const base = this.world.groundHeight(x, z, 30);
    const r = rotY ?? (Math.random() - 0.5) * 0.5;
    const w = 1.5, h = 0.95, d = 0.85;
    const m = new THREE.Mesh(roundedBox(w, h, d, 0.06), this.forge.metalGreen());
    m.position.set(x, base + h / 2, z); m.rotation.y = r; m.castShadow = m.receiveShadow = true; this.group.add(m);
    const lid = new THREE.Mesh(roundedBox(w * 1.04, 0.14, d * 1.04, 0.04), this.forge.metalDark());
    lid.position.set(x, base + h - 0.02, z); lid.rotation.y = r; lid.castShadow = true; this.group.add(lid);
    for (const s of [-1, 1]) {
      const latch = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.18, 0.06), this.forge.metalDark());
      latch.position.set(x + Math.cos(r) * s * w * 0.42, base + h * 0.55, z + Math.sin(r) * s * w * 0.42);
      latch.rotation.y = r; this.group.add(latch);
    }
    this.world.add(Box.fromCenter(x, base + h / 2, z, w, h, d, 'metal', true, true));
  }

  // Scattered rubble / broken stones.
  rubble(x, z, n = 7) {
    const base = this.world.groundHeight(x, z, 30);
    const mat = new THREE.MeshStandardMaterial({ color: 0x8a8174, roughness: 0.95, flatShading: true });
    for (let i = 0; i < n; i++) {
      const s = 0.14 + Math.random() * 0.34;
      const r = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), mat);
      r.position.set(x + (Math.random() - 0.5) * 2.4, base + s * 0.45, z + (Math.random() - 0.5) * 2.4);
      r.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      r.castShadow = r.receiveShadow = true; this.group.add(r);
    }
  }

  // Wooden scaffold against a wall (poles + planks).
  scaffold(x, z, rotY = 0) {
    const base = this.world.groundHeight(x, z, 30);
    const wood = this.forge.wood(1);
    const g = new THREE.Group();
    for (const dx of [-1.1, 1.1]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.09, 4.2, 8), wood);
      pole.position.set(dx, 2.1, 0); pole.castShadow = true; g.add(pole);
    }
    for (const yy of [1.3, 2.7, 3.9]) {
      const plank = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.12, 0.55), wood);
      plank.position.set(0, yy, 0); plank.castShadow = true; g.add(plank);
    }
    g.position.set(x, base, z); g.rotation.y = rotY; this.group.add(g);
  }

  _scatterRocks(count = 36) {
    const mat = new THREE.MeshStandardMaterial({ color: 0x877e70, roughness: 0.96, flatShading: true });
    for (let i = 0; i < count; i++) {
      const x = this.X0 + 2 + Math.random() * (this.X1 - this.X0 - 4);
      const z = this.Z0 + 2 + Math.random() * (this.Z1 - this.Z0 - 4);
      const gy = this.world.groundHeight(x, z, 30);
      if (gy > 0.4) continue;
      if (!this.world.isFree(new THREE.Vector3(x, gy + 0.05, z), 0.3, 0.9)) continue;
      const s = 0.1 + Math.random() * 0.22;
      const r = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), mat);
      r.position.set(x, gy + s * 0.4, z);
      r.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      r.castShadow = true; this.group.add(r);
    }
  }

  _dress() {
    const { X0, X1, Z0, Z1, DIV_A, DIV_B } = this;
    // architecture on every major wall
    this._dressWallLine('x', Z0, X0, X1, WALL_H + 1.5);
    this._dressWallLine('x', Z1, X0, X1, WALL_H + 1.5);
    this._dressWallLine('z', X0, Z0, Z1, WALL_H + 1.5);
    this._dressWallLine('z', X1, Z0, Z1, WALL_H + 1.5);
    this._dressWallLine('z', DIV_A, -42, 44);
    this._dressWallLine('z', DIV_B, -42, 44);

    // lamps for atmosphere (warm pools + bloom)
    for (const [x, z] of [[X0 + 0.7, -18], [X0 + 0.7, 22], [X1 - 0.7, -18], [X1 - 0.7, 22],
                          [-3, Z0 + 0.7], [3, Z1 - 0.7], [DIV_A - 0.7, 8], [DIV_B + 0.7, 8]]) {
      this.lamp(x, 4.3, z);
    }
    this.lamp(DIV_A - 0.7, 4.3, 34); this.lamp(DIV_B + 0.7, 4.3, 34);

    // vegetation
    for (const [x, z] of [[-38, -49], [38, -49], [-40, 8], [40, 8], [13, 47], [-12, 47], [-39, 44], [39, -8]]) {
      this.bush(x, z, 0.9 + Math.random() * 0.7);
    }
    this._palm(-37, 16); this._palm(37, 14); this._palm(-7, -47); this._palm(7, 47);

    // hanging cables across the lanes
    this.cable(new THREE.Vector3(DIV_B, 5.2, -22), new THREE.Vector3(DIV_A, 5.0, -22));
    this.cable(new THREE.Vector3(DIV_B, 5.0, 12), new THREE.Vector3(DIV_A, 5.2, 12));
    this.cable(new THREE.Vector3(X0 + 1, 5.4, -30), new THREE.Vector3(DIV_B, 5.0, -30));
    this.cable(new THREE.Vector3(DIV_A, 5.0, -30), new THREE.Vector3(X1 - 1, 5.4, -30));

    // props at the sites + chokes
    this.ammoCrate(31, 33); this.ammoCrate(-24, 41); this.ammoCrate(34, -24);
    this.rubble(20, -12); this.rubble(-34, -18); this.rubble(36, 42); this.rubble(-20, 44);
    this.scaffold(40.5, -2, Math.PI / 2); this.scaffold(-40.5, 4, -Math.PI / 2);
    this._scatterRocks();
  }

  /* ===================================================================
     BUILD
     =================================================================== */
  build() {
    const sand = this.forge.sand(20);
    const sandstone = this.forge.sandstone(2);
    const plaster = this.forge.plaster(2);

    // ---- ground ----
    const W = this.X1 - this.X0, D = this.Z1 - this.Z0;
    const cx = (this.X0 + this.X1) / 2, cz = (this.Z0 + this.Z1) / 2;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(W + 20, D + 20), sand);
    ground.rotation.x = -Math.PI / 2; ground.position.set(cx, 0.001, cz);
    ground.receiveShadow = true; this.group.add(ground);
    // ground collider
    this.world.add(Box.fromCenter(cx, -1, cz, W + 40, 2, D + 40, 'sand', true, false));

    // outer skirt terrain (low dunes outside walls, decorative)
    for (let i = 0; i < 26; i++) {
      const ang = (i / 26) * Math.PI * 2;
      const rad = 70 + Math.random() * 30;
      const dx = cx + Math.cos(ang) * rad, dz = cz + Math.sin(ang) * rad;
      const dune = new THREE.Mesh(new THREE.SphereGeometry(8 + Math.random() * 10, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2),
        this.forge.sand(4));
      dune.scale.y = 0.25 + Math.random() * 0.25;
      dune.position.set(dx, -0.5, dz); dune.receiveShadow = true;
      this.group.add(dune);
    }

    // ---- perimeter walls ----
    this.wallAlongX(this.Z0, this.X0, this.X1, { mat: sandstone, h: WALL_H + 1.5, gaps: [], noLintel: true });
    this.wallAlongX(this.Z1, this.X0, this.X1, { mat: sandstone, h: WALL_H + 1.5, gaps: [], noLintel: true });
    this.wallAlongZ(this.X0, this.Z0, this.Z1, { mat: sandstone, h: WALL_H + 1.5, gaps: [], noLintel: true });
    this.wallAlongZ(this.X1, this.Z0, this.Z1, { mat: sandstone, h: WALL_H + 1.5, gaps: [], noLintel: true });
    // wall caps (decor crenellation tone)
    for (const [x0, x1, z] of [[this.X0, this.X1, this.Z0], [this.X0, this.X1, this.Z1]]) {
      this.deco((x0 + x1) / 2, WALL_H + 1.6, z, x1 - x0, 0.4, T + 0.4, plaster);
    }

    const DIV_A = 15;   // divider between mid and A lane
    const DIV_B = -13;  // divider between mid and B lane
    const DIV_Z_TOP = -42;
    const DIV_Z_BOT = 44;
    this.DIV_A = DIV_A; this.DIV_B = DIV_B;

    // ---- lane divider walls ----
    // Divider B (x=-13): gaps = mid<->lower-tunnels (z -3..1), CT<->B (z 33..39)
    this.wallAlongZ(DIV_B, DIV_Z_TOP, DIV_Z_BOT, {
      mat: sandstone, gaps: [[-3, 1], [33, 39]], surface: 'concrete',
    });
    // Divider A (x=15): gaps = mid<->long/short (z -5..-1 catwalk), CT<->A (z 33..39)
    this.wallAlongZ(DIV_A, DIV_Z_TOP, DIV_Z_BOT, {
      mat: sandstone, gaps: [[-5, -1], [33, 39]], surface: 'concrete',
    });

    // ---- mid doors (iconic double doors) ----
    this.wallAlongX(0, DIV_B, DIV_A, { mat: plaster, gaps: [[-2.2, 2.2]], h: WALL_H, surface: 'concrete' });
    // the actual double-door leaves (decorative, blue)
    const blue = this.forge.metalBlue();
    this.deco(-1.1, DOOR_H / 2, 0, 2.0, DOOR_H, 0.16, blue);
    this.deco(1.1, DOOR_H / 2, 0, 2.0, DOOR_H, 0.16, blue);

    // ---- site separators (partial, define the bombsite rooms) ----
    // small jog walls so sites read as areas; doorways already in dividers.
    // B site front wall jog
    this.wallAlongX(24, this.X0 + 1, -30, { mat: sandstone, gaps: [], h: WALL_H });
    // A site front wall jog
    this.wallAlongX(24, 30, this.X1 - 1, { mat: sandstone, gaps: [], h: WALL_H });

    // ---- T SPAWN (north strip) ----
    this._tSpawn();
    // ---- CT SPAWN (center-south) ----
    this._ctSpawn();
    // ---- MID ----
    this._mid(DIV_A, DIV_B);
    // ---- LONG A + A SITE ----
    this._aLane(DIV_A);
    // ---- TUNNELS + B SITE ----
    this._bLane(DIV_B);

    // ---- architectural dressing + atmosphere ----
    this._dress();

    // bombsite center markers + ambient site lights
    this.sites.A = { center: new THREE.Vector3(29, 0, 36), radius: 9 };
    this.sites.B = { center: new THREE.Vector3(-27, 0, 36), radius: 9 };
    this._siteMarker(this.sites.A.center, 'A');
    this._siteMarker(this.sites.B.center, 'B');

    return {
      spawnsT: this.spawnsT,
      spawnsCT: this.spawnsCT,
      sites: this.sites,
      bounds: { x0: this.X0, x1: this.X1, z0: this.Z0, z1: this.Z1 },
      group: this.group,
    };
  }

  _siteMarker(center, label) {
    // painted ground marker
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d');
    g.clearRect(0, 0, 256, 256);
    g.strokeStyle = 'rgba(230,210,140,0.85)'; g.lineWidth = 10;
    g.strokeRect(24, 24, 208, 208);
    g.fillStyle = 'rgba(230,210,140,0.9)';
    g.font = 'bold 150px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(label, 128, 138);
    const texMark = new THREE.CanvasTexture(c);
    texMark.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(7, 7),
      new THREE.MeshBasicMaterial({ map: texMark, transparent: true, depthWrite: false, opacity: 0.9 }));
    m.rotation.x = -Math.PI / 2; m.position.set(center.x, 0.03, center.z);
    this.group.add(m);
    this.pointLight(center.x, 4, center.z, 0xffe6b0, 8, 22);
  }

  _tSpawn() {
    // open courtyard at the north; spawn points spread across the three lanes
    for (const [x, z] of [[-26, -47], [-13, -48], [0, -48], [13, -48], [26, -47],
                          [-20, -45], [20, -45], [0, -45]]) {
      this.spawnsT.push(new THREE.Vector3(x, 0, z));
    }
    // some crates & cover near T
    this.crateStack(-30, -46);
    this.crate(30, -46, 2.2);
    this.crate(32, -44, 1.8);
    this.barrel(-2, -47, 'rust'); this.barrel(2, -47.6, 'red');
    this.sandbags(8, -42.5, 4, 0);
    this.tarp(-22, 4.2, -50, 6, 3, 0xb04a32);
    // big T banner wall accent
    this.deco(0, 4, this.Z0 + 0.6, 10, 3, 0.2, this.forge.flat(0x8a5a2a, 0.9));
  }

  _ctSpawn() {
    for (const [x, z] of [[0, 41], [-6, 42], [6, 42], [-9, 39], [9, 39], [0, 38]]) {
      this.spawnsCT.push(new THREE.Vector3(x, 0, z));
    }
    this.crate(-10, 40, 2);
    this.crate(10, 40, 2);
    this.sandbags(0, 44, 6, 0);
    // CT vehicle-ish crate cluster
    this.crateStack(8, 36);
    this.barrel(-9, 36, 'blue'); this.barrel(11, 35, 'blue');
    this.tarp(0, 4.4, this.Z1 - 0.6, 8, 3, 0x35506e);
  }

  _mid(DIV_A, DIV_B) {
    // T mid: the "xbox" crate + cover
    this.crate(1, -10, 2.2);                 // xbox
    this.crate(-6, -22, 2);
    this.barrel(6, -20, 'red');
    // CT mid cover
    this.crate(-3, 16, 2);
    this.crate(4, 22, 1.8);
    this.barrel(-6, 24, 'rust');
    // catwalk: a raised walkway hint near divider A door (short A)
    this.platform(12.5, -8, 5, 6, 1.0, this.forge.concrete(2));
    this.steps(10, -8, 1, 2, 0.5, 0.7, 6);
    // decorative arch over mid doors approach
    this.archway(0, -5, 4.2, true);
    this.pointLight(0, 4.5, 0, 0xffeccb, 5, 16);
    // a couple of palms-substitute: tall posts with canopy
    this._palm(-9, -30); this._palm(9, 30);
  }

  _palm(x, z) {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 5, 8), this.forge.flat(0x6b4f2c, 0.95));
    trunk.position.set(x, 2.5, z); trunk.castShadow = true; this.group.add(trunk);
    const leafMat = this.forge.flat(0x5f7a35, 0.9);
    for (let i = 0; i < 7; i++) {
      const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.5, 3.2, 4), leafMat);
      leaf.position.set(x, 5, z);
      leaf.rotation.z = Math.PI / 2.6; leaf.rotation.y = (i / 7) * Math.PI * 2;
      leaf.position.x += Math.cos((i / 7) * Math.PI * 2) * 1.3;
      leaf.position.z += Math.sin((i / 7) * Math.PI * 2) * 1.3;
      leaf.castShadow = true; this.group.add(leaf);
    }
    this.world.add(Box.fromCenter(x, 2.5, z, 0.7, 5, 0.7, 'wood', true, false));
  }

  _aLane(DIV_A) {
    // Long A corridor cover
    this.crate(33, -28, 2.2);
    this.crate(35, -25, 1.8);
    this.barrel(20, -18, 'rust'); this.barrel(21, -17, 'red');
    // "the pit" — raised cover near A
    this.platform(38, -6, 6, 8, 1.4, this.forge.concrete(2));
    this.sandbags(31, 0, 5, Math.PI / 2);
    // A SITE: the platform + crate fortress
    this.platform(33, 38, 9, 8, 1.6, this.forge.concrete(2));     // big platform (goose)
    this.steps(27, 38, 1, 3, 0.55, 0.7, 8);
    this.crate(24, 32, 2.4);
    this.crate(26, 30, 2);
    this.crateStack(20, 38, { tall: true });
    this.barrel(35, 30, 'red');
    this.archway(15, 36, 4.5, false); // doorway into A from CT (already a gap)
    this.tarp(40, 4.5, 20, 6, 3, 0xb89a55, Math.PI / 2);
    this.pointLight(29, 4.5, 36, 0xffdca0, 7, 24);
  }

  _bLane(DIV_B) {
    // tunnels cover
    this.crate(-34, -26, 2);
    this.crate(-32, -23, 1.6);
    this.barrel(-20, -20, 'rust');
    // upper/lower tunnel divider stub (makes tunnels feel enclosed)
    this.wallAlongX(-14, this.X0 + 1, -28, { mat: this.forge.sandstone(2), gaps: [[-24, -19]], h: WALL_H });
    // B SITE: the truck + crates
    this.truck(-30, 36, Math.PI / 2);
    this.crate(-20, 30, 2.2);
    this.crate(-22, 32, 1.8);
    this.crateStack(-37, 30);
    this.barrel(-19, 38, 'blue'); this.barrel(-18, 40, 'red');
    this.sandbags(-27, 28, 5, 0);
    this.archway(-13, 36, 4.5, false);
    this.tarp(-40, 4.5, 20, 6, 3, 0x35506e, Math.PI / 2);
    this.pointLight(-27, 4.5, 36, 0xffdca0, 7, 24);
  }
}
