/**
 * TrailerParkMap — loads the imported "Trailer Park" glTF (converted from FBX,
 * millimetre scale), merges its 2000+ meshes by material for performance,
 * builds a triangle collider (MeshWorld), and confines play to the trailer lot
 * (found by vertical-geometry density) rather than the long tree-lined road.
 * Outdoor map: lit by the engine sun, with a little fill for trailer interiors.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MeshWorld } from './MeshWorld.js';

const ASSET = 'assets/maps/trailer/Trailer_Park.glb';
const SCALE = 0.001;          // mm -> m

export class TrailerParkMap {
  constructor(scene, engine) {
    this.scene = scene;
    this.engine = engine;
    this.group = new THREE.Group();
    this.group.name = 'TrailerParkMap';
  }

  build(onProgress) {
    onProgress?.(0.15, 'Loading trailer park…');
    return new Promise((resolve, reject) => {
      new GLTFLoader().load(ASSET, (gltf) => {
        try { resolve(this._assemble(gltf, onProgress)); }
        catch (e) { reject(e); }
      }, (ev) => { if (ev && ev.total) onProgress?.(0.15 + 0.45 * (ev.loaded / ev.total), 'Loading trailer park…'); },
        (err) => reject(err instanceof Error ? err : new Error('GLB load failed')));
    });
  }

  _assemble(gltf, onProgress) {
    onProgress?.(0.62, 'Merging geometry…');
    gltf.scene.scale.setScalar(SCALE);
    gltf.scene.updateMatrixWorld(true);
    // find the lot from the ORIGINAL named meshes (merging discards object names)
    const lot = this._densityLot(gltf.scene);
    const merged = this._mergeByMaterial(gltf.scene);
    this.group.add(merged);
    this.scene.add(this.group);

    onProgress?.(0.75, 'Building collision…');
    const world = new MeshWorld().buildFromObject(merged);
    const b = world.bounds;
    const bounds = { x0: b.min.x, x1: b.max.x, z0: b.min.z, z1: b.max.z };
    world.searchTop = world.mainFloorY + 3.0;        // ground + trailer-interior floors, not roofs
    const floor = this._floorPoints(world, lot);
    const layout = this._layout(floor, world.mainFloorY);
    this._lights(lot, world.mainFloorY);

    onProgress?.(1.0, 'Ready');
    return { world, group: this.group, bounds, lot, ...layout, navMaxFloor: world.mainFloorY + 2.8 };
  }

  // Collapse the many small meshes into one mesh per material (fewer draw calls).
  _mergeByMaterial(root) {
    const groups = new Map();   // material -> [geometry baked to world]
    root.traverse((o) => {
      if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
      const mat = Array.isArray(o.material) ? o.material[0] : o.material;
      let g = o.geometry.clone();
      g.applyMatrix4(o.matrixWorld);
      // normalise attributes to a common set so they can be merged
      for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
      if (g.morphAttributes) g.morphAttributes = {};
      if (!g.attributes.normal) g.computeVertexNormals();
      if (!g.attributes.uv) { const c = g.attributes.position.count; g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(c * 2), 2)); }
      if (!g.index) g = g.toNonIndexed();   // keep indexing consistent within a group
      let arr = groups.get(mat); if (!arr) groups.set(mat, arr = []); arr.push(g);
    });
    const out = new THREE.Group();
    for (const [mat, geos] of groups) {
      let merged = null;
      try {
        const idx = geos.map(g => g.index ? g : g.toNonIndexed());
        const nonIdx = idx.map(g => g.index ? g.toNonIndexed() : g);   // all non-indexed → always mergeable
        merged = mergeGeometries(nonIdx, false);
      } catch { merged = null; }
      if (merged) {
        const m = new THREE.Mesh(merged, mat); m.castShadow = true; m.receiveShadow = true; out.add(m);
      } else {
        for (const g of geos) { const m = new THREE.Mesh(g, mat); m.castShadow = true; m.receiveShadow = true; out.add(m); }
      }
      if (mat) { mat.side = THREE.DoubleSide; mat.shadowSide = THREE.DoubleSide; if ('envMapIntensity' in mat) mat.envMapIntensity = 0.4; }
    }
    return out;
  }

  // The trailer cluster (play area), found robustly: take the median centroid
  // of all built (non-scenery) meshes, then bound the meshes within RADIUS of
  // it. This ignores the long tree-lined road and the odd far outlier.
  _densityLot(root) {
    const RADIUS = 26;
    const skipRe = /tree|grass|soil|background|fence|lamp|antenna|plant|flower|road|dirt|sand|sky|terrain/i;
    const c = new THREE.Vector3(), box = new THREE.Box3();
    const cents = [];
    root.traverse((o) => {
      if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
      const mn = (Array.isArray(o.material) ? o.material[0] : o.material)?.name || '';
      if (skipRe.test(o.name || '') || skipRe.test(mn)) return;
      o.geometry.computeBoundingBox();
      box.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
      box.getCenter(c); cents.push({ x: c.x, z: c.z, box: box.clone() });
    });
    if (!cents.length) { const fb = new THREE.Box3().setFromObject(root); return { x0: fb.min.x + 2, x1: fb.max.x - 2, z0: fb.min.z + 2, z1: fb.max.z - 2 }; }
    const med = (arr) => { const s = arr.slice().sort((a, b) => a - b); return s[s.length >> 1]; };
    const mx = med(cents.map(p => p.x)), mz = med(cents.map(p => p.z));
    // bound by the CENTROID POINTS near the median (not their bboxes — a few
    // huge meshes would otherwise stretch the box across the whole map)
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, any = false;
    for (const p of cents) {
      if (Math.hypot(p.x - mx, p.z - mz) > RADIUS) continue;
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); any = true;
    }
    if (!any) { x0 = mx - 10; x1 = mx + 10; z0 = mz - 10; z1 = mz + 10; }
    const PAD = 8;                                  // structures extend past their centres + open ground
    return { x0: x0 - PAD, x1: x1 + PAD, z0: z0 - PAD, z1: z1 + PAD };
  }

  _floorPoints(world, lot) {
    const pts = [];
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (let x = lot.x0; x <= lot.x1; x += 1.4) {
      for (let z = lot.z0; z <= lot.z1; z += 1.4) {
        const gy = world.groundHeight(x, z, 60);
        if (gy >= world._noFloor) continue;
        const eye = new THREE.Vector3(x, gy + 1.0, z);
        if (!world.isFree(new THREE.Vector3(x, gy + 0.1, z), 0.42, 1.7)) continue;
        // open enough to stand (not wedged in a wall): need ≥3 of 4 sides clear
        let clear = 0;
        for (const [dx, dz] of dirs) if (!world.raycast(eye, new THREE.Vector3(dx, 0, dz), 0.9, true)) clear++;
        if (clear < 3) continue;
        pts.push(new THREE.Vector3(x, gy, z));
      }
    }
    return pts;
  }

  // Spawns at the two ends of the lot's longer axis; sites a third of the way in.
  _layout(allFloor, mainY) {
    if (!allFloor.length) {
      const c = new THREE.Vector3(0, mainY, 0);
      return { spawnsCT: [c.clone()], spawnsT: [c.clone()], sites: { A: { center: c.clone(), radius: 8 }, B: { center: c.clone(), radius: 8 } }, center: c };
    }
    const floor = allFloor.filter(p => Math.abs(p.y - mainY) < 2.5);
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const p of floor) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
    const alongX = (x1 - x0) >= (z1 - z0);          // longer axis
    const lo = alongX ? x0 : z0, hi = alongX ? x1 : z1;
    const key = (p) => alongX ? p.x : p.z;
    const cross = (p) => alongX ? p.z : p.x;
    const crossMid = alongX ? (z0 + z1) / 2 : (x0 + x1) / 2;
    const sorted = floor.slice().sort((a, c) => key(a) - key(c));
    const band = Math.max(8, floor.length * 0.12 | 0);
    const spread = (arr) => {
      const s = arr.slice().sort((a, c) => Math.abs(cross(a) - crossMid) - Math.abs(cross(c) - crossMid)).slice(0, 18);
      const out = [];
      for (const p of s) { if (out.every(o => o.distanceTo(p) > 1.8)) out.push(p.clone()); if (out.length >= 8) break; }
      return out.length ? out : [arr[0].clone()];
    };
    const spawnsT = spread(sorted.slice(0, band));
    const spawnsCT = spread(sorted.slice(-band));
    const near = (t) => floor.reduce((best, p) => (Math.abs(key(p) - t) + Math.abs(cross(p) - crossMid) < Math.abs(key(best) - t) + Math.abs(cross(best) - crossMid) ? p : best), floor[0]);
    const span = hi - lo;
    const sites = {
      A: { center: near(lo + span * 0.32).clone(), radius: 9 },
      B: { center: near(lo + span * 0.68).clone(), radius: 9 },
    };
    const center = new THREE.Vector3(alongX ? (lo + hi) / 2 : crossMid, mainY, alongX ? crossMid : (lo + hi) / 2);
    return { spawnsCT, spawnsT, sites, center };
  }

  // Outdoor map: a few soft fills so trailer interiors and shaded spots read.
  _lights(lot, mainY) {
    const cx = (lot.x0 + lot.x1) / 2, cz = (lot.z0 + lot.z1) / 2;
    const span = Math.max(lot.x1 - lot.x0, lot.z1 - lot.z0);
    const alongX = (lot.x1 - lot.x0) >= (lot.z1 - lot.z0);
    const n = Math.max(2, Math.round(span / 16));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = alongX ? lot.x0 + (lot.x1 - lot.x0) * t : cx;
      const z = alongX ? cz : lot.z0 + (lot.z1 - lot.z0) * t;
      const L = new THREE.PointLight(0xfff2dc, 14, 22, 1.6);
      L.position.set(x, mainY + 2.4, z);
      this.group.add(L);
    }
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      if (o.isMesh) {
        o.geometry?.dispose();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) { if (!m) continue; for (const k in m) { const v = m[k]; if (v && v.isTexture) v.dispose(); } m.dispose?.(); }
      }
    });
    this.group.clear();
  }
}
