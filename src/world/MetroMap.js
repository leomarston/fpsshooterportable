/**
 * MetroMap — loads the imported "Metro" glTF station, drops it into the
 * scene, lights it as an interior, builds a triangle collider (MeshWorld)
 * from its geometry, and derives spawns / objective sites so the existing
 * match logic works on it unchanged.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshWorld } from './MeshWorld.js';

const ASSET = 'assets/maps/Metro.glb';

export class MetroMap {
  constructor(scene, engine) {
    this.scene = scene;
    this.engine = engine;
    this.group = new THREE.Group();
    this.group.name = 'MetroMap';
  }

  build(onProgress) {
    onProgress?.(0.15, 'Loading metro station…');
    return new Promise((resolve, reject) => {
      new GLTFLoader().load(ASSET, (gltf) => {
        try { resolve(this._assemble(gltf, onProgress)); }
        catch (e) { reject(e); }
      }, (ev) => {
        if (ev && ev.total) onProgress?.(0.15 + 0.5 * (ev.loaded / ev.total), 'Loading metro station…');
      }, (err) => reject(err instanceof Error ? err : new Error('GLB load failed')));
    });
  }

  _assemble(gltf, onProgress) {
    onProgress?.(0.7, 'Building station collision…');
    const model = gltf.scene;
    // PSX-ish, but light it for our PBR pipeline; let it cast/receive shadows.
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true; o.receiveShadow = true;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (!m) continue;
        m.side = THREE.DoubleSide;           // imported floors have inverted normals — show both faces
        m.shadowSide = THREE.DoubleSide;
        if ('envMapIntensity' in m) m.envMapIntensity = 0.35;
        if (m.map) m.map.anisotropy = 4;
      }
    });
    this.group.add(model);

    // collider from world-space triangles
    const world = new MeshWorld().buildFromObject(model);
    const b = world.bounds;
    const bounds = { x0: b.min.x, x1: b.max.x, z0: b.min.z, z1: b.max.z };

    // pin play to the platform level (the area-dominant floor), ignoring the
    // open roof/concourse slab above it
    world.searchTop = world.mainFloorY + 2.8;

    // furnished extent: the part of the platform that's actually dressed (train,
    // seats, turnstiles…). The bare roofed section beyond it isn't real play
    // space, so keep spawns + objectives inside the props' Z span.
    const cz = this._contentZ(model, b);

    // sample the floor to derive spawns + objective sites
    const floor = this._floorPoints(world, b, cz);
    const { spawnsCT, spawnsT, sites, center, mainY } = this._layout(floor, b, cz);

    // light the platform from above (now that we know its level)
    this._lights(cz, center, mainY);
    this.scene.add(this.group);

    onProgress?.(1.0, 'Ready');
    return { world, group: this.group, bounds, spawnsCT, spawnsT, sites, center, navMaxFloor: world.mainFloorY + 2.6 };
  }

  // Z span of the furnished platform. Anchored on the train + core furniture
  // (which mark the platform); a long bare roofed extension is excluded.
  _contentZ(model, b) {
    // anchor on the train + seats (the lit platform); ignore far/entrance props
    const coreRe = /subway|seat/i;
    let z0 = Infinity, z1 = -Infinity;
    const tmp = new THREE.Box3();
    model.traverse((o) => {
      if (!o.isMesh || !o.geometry || !coreRe.test(o.name || '')) return;
      o.geometry.computeBoundingBox();
      tmp.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
      z0 = Math.min(z0, tmp.min.z); z1 = Math.max(z1, tmp.max.z);
    });
    if (!isFinite(z0) || z1 - z0 < 12) return [b.min.z + 2, b.max.z - 2];
    const pad = 5;                                  // breathing room beyond the train
    return [Math.max(b.min.z + 1, z0 - pad), Math.min(b.max.z - 1, z1 + pad)];
  }

  _lights(cz, center, mainY) {
    const cx = center.x;                          // along the platform centre line
    const z0 = cz[0] + 0.5, z1 = cz[1] - 0.5;     // cover right out to the spawns
    const y = mainY + 2.9;                         // just above the platform
    const n = Math.max(5, Math.round((z1 - z0) / 7));
    for (let i = 0; i <= n; i++) {
      const z = z0 + (z1 - z0) * (i / n);
      const L = new THREE.PointLight(0xffe9c4, 55, 30, 2.0);
      L.position.set(cx, y, z);
      this.group.add(L);
    }
    // a couple of broad fills so the whole platform reads
    for (const t of [0.3, 0.7]) {
      const f = new THREE.PointLight(0xbcd0ff, 22, 70, 1.4);
      f.position.set(cx, mainY + 1.8, z0 + (z1 - z0) * t);
      this.group.add(f);
    }
  }

  // Walkable floor sample points (the platform level, within the furnished Z span).
  _floorPoints(world, b, cz) {
    const z0 = cz ? cz[0] : b.min.z + 1, z1 = cz ? cz[1] : b.max.z - 1;
    const pts = [];
    for (let x = b.min.x + 1; x <= b.max.x - 1; x += 1.2) {
      for (let z = z0; z <= z1; z += 1.2) {
        const gy = world.groundHeight(x, z, b.max.y + 5);
        if (gy >= world._noFloor) continue;
        if (!world.isFree(new THREE.Vector3(x, gy + 0.1, z), 0.42, 1.7)) continue;
        pts.push(new THREE.Vector3(x, gy, z));
      }
    }
    return pts;
  }

  _layout(allFloor, b, cz) {
    if (!allFloor.length) {
      // fallback: a couple of points near the centre so the game still runs
      const c = new THREE.Vector3((b.min.x + b.max.x) / 2, 0, (b.min.z + b.max.z) / 2);
      return { spawnsCT: [c.clone()], spawnsT: [c.clone().setZ(b.min.z + 4)], sites: { A: { center: c.clone(), radius: 8 }, B: { center: c.clone(), radius: 8 } }, center: c, mainY: 0 };
    }
    // the map can be multi-level (concourse over a track pit): keep the most
    // common floor height as the playable level so both teams spawn on it
    const bins = new Map();
    for (const p of allFloor) { const k = Math.round(p.y); bins.set(k, (bins.get(k) || 0) + 1); }
    let mainY = 0, bestN = -1;
    for (const [k, n] of bins) if (n > bestN) { bestN = n; mainY = k; }
    const floor = allFloor.filter(p => Math.abs(p.y - mainY) < 2);

    // platform runs along Z; one team at each end
    const xs = floor.map(p => p.x).sort((a, c) => a - c);
    const medX = xs[xs.length >> 1];
    const byZ = floor.slice().sort((a, c) => a.z - c.z);
    const lowZ = byZ.slice(0, Math.max(8, byZ.length * 0.12 | 0));
    const highZ = byZ.slice(-Math.max(8, byZ.length * 0.12 | 0));
    const spread = (arr) => {
      // pick up to 8 points nearest the platform centre line, spaced out
      const sorted = arr.slice().sort((p, q) => Math.abs(p.x - medX) - Math.abs(q.x - medX)).slice(0, 16);
      const out = [];
      for (const p of sorted) { if (out.every(o => o.distanceTo(p) > 1.6)) out.push(p.clone()); if (out.length >= 8) break; }
      return out.length ? out : [arr[0].clone()];
    };
    const spawnsT = spread(lowZ);     // low-Z end
    const spawnsCT = spread(highZ);   // high-Z end
    // objective sites span the actual furnished floor, not the whole shell
    let fz0 = Infinity, fz1 = -Infinity; for (const p of floor) { fz0 = Math.min(fz0, p.z); fz1 = Math.max(fz1, p.z); }
    const zc = (fz0 + fz1) / 2, zr = (fz1 - fz0);
    const near = (z) => floor.reduce((best, p) => (Math.abs(p.x - medX) + Math.abs(p.z - z) < Math.abs(best.x - medX) + Math.abs(best.z - z) ? p : best), floor[0]);
    const sites = {
      A: { center: near(zc - zr * 0.22).clone(), radius: 8 },
      B: { center: near(zc + zr * 0.22).clone(), radius: 8 },
    };
    return { spawnsCT, spawnsT, sites, center: new THREE.Vector3(medX, mainY, zc), mainY };
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
