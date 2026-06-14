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
