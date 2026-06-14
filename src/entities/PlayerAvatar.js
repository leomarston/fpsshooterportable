/**
 * PlayerAvatar — a third-person body for a human player so the OTHER
 * player(s) can see them in split-screen co-op. Built from the same
 * primitive-soldier vocabulary as the bots, tinted with the player's HUD
 * colour. Each avatar lives on its own render layer so the owning player's
 * camera doesn't render their own body (only everyone else's).
 */
import * as THREE from 'three';
import { roundedBox, capsule } from '../core/Geo.js';

const EYE = 1.62;

export class PlayerAvatar {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.color = opts.color || 0x39ff8e;
    this._walkPhase = 0;
    this._build();
    scene.add(this.group);
  }

  _build() {
    const g = new THREE.Group(); this.group = g;
    const accentCol = this.color;
    const skin = new THREE.MeshStandardMaterial({ color: 0x9c7a55, roughness: 0.62 });
    const cloth = new THREE.MeshStandardMaterial({ color: 0x3f4a3a, roughness: 0.85, metalness: 0.05 });
    const clothDark = new THREE.MeshStandardMaterial({ color: 0x2c342a, roughness: 0.8 });
    const vest = new THREE.MeshStandardMaterial({ color: 0x232a24, roughness: 0.55, metalness: 0.3 });
    const rubber = new THREE.MeshStandardMaterial({ color: 0x14140f, roughness: 0.8, metalness: 0.1 });
    const accent = new THREE.MeshStandardMaterial({ color: accentCol, roughness: 0.45, metalness: 0.2, emissive: accentCol, emissiveIntensity: 0.35 });
    this.accentMat = accent;
    const gunMat = new THREE.MeshStandardMaterial({ color: 0x17191d, roughness: 0.45, metalness: 0.65 });
    const glove = new THREE.MeshStandardMaterial({ color: 0x242a22, roughness: 0.7 });

    const add = (mesh, parent = g) => { mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh; };
    const M = (geo, mat) => new THREE.Mesh(geo, mat);

    const buildLeg = (side) => {
      const leg = new THREE.Group(); leg.position.set(0.13 * side, 0.92, 0);
      add(M(capsule(0.13, 0.34, 6, 12), cloth), leg).position.y = -0.28;
      add(M(new THREE.SphereGeometry(0.12, 12, 10), clothDark), leg).position.y = -0.5;
      add(M(capsule(0.11, 0.32, 6, 12), clothDark), leg).position.y = -0.7;
      add(M(roundedBox(0.18, 0.18, 0.34, 0.06), rubber), leg).position.set(0, -0.9, 0.05);
      g.add(leg); return leg;
    };
    this.legL = buildLeg(-1); this.legR = buildLeg(1);

    add(M(roundedBox(0.42, 0.26, 0.3, 0.1), clothDark)).position.set(0, 0.98, 0);
    this.torso = add(M(capsule(0.22, 0.34, 8, 16), cloth)); this.torso.position.y = 1.2; this.torso.scale.set(1.05, 1, 0.72);
    add(M(roundedBox(0.5, 0.5, 0.34, 0.1), vest)).position.set(0, 1.22, 0.01);
    add(M(roundedBox(0.52, 0.07, 0.36, 0.03), accent)).position.set(0, 1.38, 0);   // team stripe
    add(M(new THREE.CylinderGeometry(0.1, 0.12, 0.12, 12), skin)).position.set(0, 1.5, 0);
    add(M(roundedBox(0.32, 0.34, 0.16, 0.06), clothDark)).position.set(0, 1.2, -0.22); // pack

    const buildArm = (side) => {
      const arm = new THREE.Group(); arm.position.set(0.3 * side, 1.42, 0);
      add(M(new THREE.SphereGeometry(0.14, 12, 10), cloth), arm).position.y = 0.02;
      add(M(capsule(0.1, 0.22, 6, 12), cloth), arm).position.y = -0.18;
      add(M(new THREE.SphereGeometry(0.095, 10, 8), clothDark), arm).position.y = -0.36;
      add(M(capsule(0.085, 0.2, 6, 12), clothDark), arm).position.y = -0.5;
      add(M(new THREE.SphereGeometry(0.085, 10, 8), glove), arm).position.y = -0.66;
      add(M(roundedBox(0.18, 0.12, 0.2, 0.05), vest), arm).position.set(0.02 * side, 0.04, 0);
      g.add(arm); return arm;
    };
    this.armL = buildArm(-1); this.armR = buildArm(1);

    this.head = add(M(new THREE.SphereGeometry(0.135, 16, 14), skin)); this.head.position.y = 1.63; this.head.scale.set(0.92, 1.05, 1.0);
    add(M(new THREE.SphereGeometry(0.155, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.62), vest)).position.y = 1.66; // helmet
    add(M(roundedBox(0.2, 0.05, 0.04, 0.02), accent)).position.set(0, 1.62, 0.13);  // team visor

    this.gun = new THREE.Group();
    add(M(roundedBox(0.08, 0.11, 0.46, 0.03), gunMat), this.gun);
    add(M(new THREE.CylinderGeometry(0.016, 0.016, 0.16, 10), gunMat), this.gun).rotation.x = Math.PI / 2;
    const mag = add(M(roundedBox(0.05, 0.2, 0.09, 0.02), gunMat), this.gun); mag.position.set(0, -0.13, 0.02); mag.rotation.x = 0.4;
    this.gun.position.set(0.26, 1.2, -0.18);
    g.add(this.gun);
  }

  setLayer(layer) { this.group.traverse(o => o.layers.set(layer)); }
  setAccent(hex) { if (this.accentMat) { this.accentMat.color.setHex(hex); this.accentMat.emissive.setHex(hex); } }
  show(v) { this.group.visible = v; }

  update(dt, feet, yaw, pitch, alive, speed) {
    const g = this.group;
    g.visible = true;
    g.position.copy(feet);
    g.rotation.y = yaw;
    if (!alive) {                       // collapsed pose when down
      g.rotation.x = -Math.PI / 2 * 0.9; g.position.y = feet.y + 0.1; return;
    }
    g.rotation.x = 0;
    if (speed > 0.4) {
      this._walkPhase += dt * (4 + speed);
      const sw = Math.sin(this._walkPhase) * 0.5;
      this.legL.rotation.x = sw; this.legR.rotation.x = -sw;
      this.armL.rotation.x = -sw * 0.5;
    } else {
      this.legL.rotation.x *= 0.8; this.legR.rotation.x *= 0.8;
    }
    this.gun.rotation.x = -pitch;
    this.armR.rotation.x = -pitch - 0.2;
    this.head.rotation.x = THREE.MathUtils.clamp(-pitch * 0.5, -0.5, 0.5);
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse(o => { if (o.isMesh) o.geometry.dispose(); });
  }
}
