/**
 * Door — a hinged door panel that swings open/closed around a vertical axis at
 * one of its edges. The hinge edge is taken from the panel's LOCAL geometry
 * (so it's correct even though trailers are rotated in world space), converted
 * to world, and the panel is reparented under a pivot there via `attach` (which
 * preserves its world transform). Its closed-position collision lives in
 * MeshWorld, tagged with this door's id, and is toggled passable when open.
 */
import * as THREE from 'three';

export class Door {
  constructor(parent, mesh, id) {
    this.id = id;
    this.open = false;
    this.t = 0;                       // 0 closed .. 1 open (animated)
    mesh.castShadow = true; mesh.receiveShadow = true;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) { if (m) { m.side = THREE.DoubleSide; m.shadowSide = THREE.DoubleSide; } }

    mesh.updateWorldMatrix(true, false);
    const geo = mesh.geometry;
    geo.computeBoundingBox();
    const bb = geo.boundingBox;                       // LOCAL bounds (true panel shape)
    const size = bb.getSize(new THREE.Vector3());
    const center = bb.getCenter(new THREE.Vector3());
    const widthX = size.x >= size.z;                  // wider local axis = door width
    // hinge edge in local space (one end of the width axis, full height)
    const hingeLocal = new THREE.Vector3(widthX ? bb.min.x : center.x, bb.min.y, widthX ? center.z : bb.min.z);
    const hingeWorld = hingeLocal.applyMatrix4(mesh.matrixWorld);
    // panel centre in world (for proximity checks)
    this.center = center.clone().applyMatrix4(mesh.matrixWorld);

    this.pivot = new THREE.Group();
    this.pivot.position.copy(hingeWorld);
    parent.add(this.pivot);
    this.pivot.updateMatrixWorld(true);
    this.pivot.attach(mesh);                           // reparent, keeping world transform

    this.openAngle = (widthX ? -1 : 1) * Math.PI * 0.5;
  }

  toggle() { this.open = !this.open; return this.open; }

  update(dt) {
    const target = this.open ? 1 : 0;
    if (this.t === target) return;
    this.t += (target - this.t) * Math.min(1, dt * 7);
    if (Math.abs(this.t - target) < 0.01) this.t = target;
    this.pivot.rotation.y = this.t * this.openAngle;
  }
}
