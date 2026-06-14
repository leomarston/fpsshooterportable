/**
 * Geo — geometry helpers for non-blocky, light-catching shapes.
 *
 * roundedBox() chamfers all 12 edges of a box by displacing a
 * subdivided box's vertices onto a rounded SDF surface, so edges catch
 * highlights instead of reading as hard Lego cubes. Used for crates,
 * gear and prop detailing.
 */
import * as THREE from 'three';

export function roundedBox(w, h, d, radius = 0.08, seg = 4) {
  const r = Math.min(radius, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001);
  const geo = new THREE.BoxGeometry(w, h, d, seg, seg, seg);
  const pos = geo.attributes.position;
  const hx = w / 2 - r, hy = h / 2 - r, hz = d / 2 - r;
  const v = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    c.set(
      THREE.MathUtils.clamp(v.x, -hx, hx),
      THREE.MathUtils.clamp(v.y, -hy, hy),
      THREE.MathUtils.clamp(v.z, -hz, hz));
    const dir = v.clone().sub(c);
    const len = dir.length();
    if (len > 1e-6) { dir.multiplyScalar(r / len); v.copy(c).add(dir); }
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

// A capsule pointed along Y by default (for limbs/torso).
export function capsule(radius, length, caps = 8, radial = 12) {
  return new THREE.CapsuleGeometry(radius, length, caps, radial);
}

// Convenience mesh builder.
export function mesh(geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
