/**
 * FX — impact particles, blood, sparks, smoke, bullet-hole decals,
 * tracers and muzzle/impact lights. Everything is pooled (fixed-size
 * buffers, recycled oldest-first) so combat stays smooth.
 */
import * as THREE from 'three';

/* -------------------- GPU point particle pool -------------------- */
class ParticlePool {
  constructor(scene, max, blending) {
    this.max = max;
    this.head = 0;
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    // velocity/life kept CPU-side
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);

    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    geo.setDrawRange(0, max);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending,
      uniforms: { uScale: { value: window.innerHeight * 0.5 } },
      vertexShader: /* glsl */`
        attribute vec3 aColor; attribute float aSize; attribute float aAlpha;
        varying vec3 vColor; varying float vAlpha; uniform float uScale;
        void main(){
          vColor=aColor; vAlpha=aAlpha;
          vec4 mv = modelViewMatrix * vec4(position,1.0);
          gl_PointSize = max(1.0, aSize * uScale / max(-mv.z, 0.1));
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        varying vec3 vColor; varying float vAlpha;
        void main(){
          vec2 d = gl_PointCoord - 0.5;
          float r = dot(d,d);
          if(r>0.25) discard;
          float a = vAlpha * smoothstep(0.25,0.05,r);
          gl_FragColor = vec4(vColor, a);
        }`,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.geo = geo;
  }

  spawn(x, y, z, vx, vy, vz, r, g, b, size, life, grav = 9, drag = 1.5) {
    const i = this.head; this.head = (this.head + 1) % this.max;
    const i3 = i * 3;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
    this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
    this.col[i3] = r; this.col[i3 + 1] = g; this.col[i3 + 2] = b;
    this.size[i] = size; this.alpha[i] = 1;
    this.life[i] = life; this.maxLife[i] = life;
    this.grav[i] = grav; this.drag[i] = drag;
  }

  update(dt) {
    let anyAlive = false;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { if (this.alpha[i] !== 0) this.alpha[i] = 0; continue; }
      anyAlive = true;
      this.life[i] -= dt;
      const i3 = i * 3;
      const dragF = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i3] *= dragF; this.vel[i3 + 2] *= dragF;
      this.vel[i3 + 1] = this.vel[i3 + 1] * dragF - this.grav[i] * dt;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      const t = Math.max(0, this.life[i] / this.maxLife[i]);
      this.alpha[i] = t;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aColor.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
    return anyAlive;
  }
  resize() { this.points.material.uniforms.uScale.value = window.innerHeight * 0.5; }
}

/* -------------------------- decals -------------------------- */
function makeBulletHoleTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 64, 64);
  const grd = g.createRadialGradient(32, 32, 1, 32, 32, 18);
  grd.addColorStop(0, 'rgba(8,7,6,0.95)');
  grd.addColorStop(0.5, 'rgba(20,16,12,0.7)');
  grd.addColorStop(1, 'rgba(20,16,12,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  // cracks
  g.strokeStyle = 'rgba(10,8,6,0.5)'; g.lineWidth = 1;
  for (let i = 0; i < 7; i++) {
    const a = Math.random() * Math.PI * 2, len = 10 + Math.random() * 14;
    g.beginPath(); g.moveTo(32, 32);
    g.lineTo(32 + Math.cos(a) * len, 32 + Math.sin(a) * len); g.stroke();
  }
  g.fillStyle = 'rgba(0,0,0,0.95)'; g.beginPath(); g.arc(32, 32, 4, 0, 7); g.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

class DecalManager {
  constructor(scene, max = 80) {
    this.scene = scene; this.max = max; this.head = 0; this.items = [];
    const tex = makeBulletHoleTexture();
    this.mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, opacity: 0.95 });
    this.geo = new THREE.PlaneGeometry(1, 1);
  }
  add(point, normal, size = 0.28) {
    let mesh = this.items[this.head];
    if (!mesh) { mesh = new THREE.Mesh(this.geo, this.mat); this.scene.add(mesh); this.items[this.head] = mesh; }
    mesh.position.copy(point).addScaledVector(normal, 0.012);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    mesh.quaternion.copy(q);
    mesh.rotateZ(Math.random() * Math.PI);
    mesh.scale.set(size * (0.8 + Math.random() * 0.5), size * (0.8 + Math.random() * 0.5), 1);
    mesh.visible = true;
    this.head = (this.head + 1) % this.max;
  }
}

/* -------------------------- tracers -------------------------- */
class TracerPool {
  constructor(scene, max = 24) {
    this.scene = scene; this.items = []; this.max = max; this.head = 0;
    this.mat = new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    this.geo = new THREE.CylinderGeometry(0.015, 0.015, 1, 6);
    this.geo.translate(0, 0.5, 0); // pivot at base
  }
  add(from, to) {
    let t = this.items[this.head];
    if (!t) { t = new THREE.Mesh(this.geo, this.mat.clone()); this.scene.add(t); this.items[this.head] = t; }
    const dir = new THREE.Vector3().subVectors(to, from);
    const len = dir.length();
    t.position.copy(from);
    t.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    t.scale.set(1, len, 1);
    t.visible = true; t.material.opacity = 0.9; t.userData.life = 0.06;
    this.head = (this.head + 1) % this.max;
  }
  update(dt) {
    for (const t of this.items) {
      if (!t || !t.visible) continue;
      t.userData.life -= dt;
      t.material.opacity = Math.max(0, t.userData.life / 0.06) * 0.9;
      if (t.userData.life <= 0) t.visible = false;
    }
  }
}

/* -------------------------- flash lights -------------------------- */
class LightPool {
  constructor(scene, max = 6) {
    this.scene = scene; this.items = []; this.head = 0;
    for (let i = 0; i < max; i++) {
      const l = new THREE.PointLight(0xffd070, 0, 14, 2); l.visible = false;
      scene.add(l); this.items.push(l);
    }
  }
  flash(pos, color = 0xffd070, intensity = 6, life = 0.06) {
    const l = this.items[this.head]; this.head = (this.head + 1) % this.items.length;
    l.position.copy(pos); l.color.setHex(color); l.intensity = intensity;
    l.visible = true; l.userData.life = life; l.userData.max = intensity;
  }
  update(dt) {
    for (const l of this.items) {
      if (!l.visible) continue;
      l.userData.life -= dt;
      l.intensity = Math.max(0, l.userData.life) / 0.06 * l.userData.max;
      if (l.userData.life <= 0) { l.visible = false; l.intensity = 0; }
    }
  }
}

/* ============================= FX facade ============================= */
export class FX {
  constructor(scene) {
    this.scene = scene;
    this.sparks = new ParticlePool(scene, 600, THREE.AdditiveBlending);
    this.dust = new ParticlePool(scene, 600, THREE.NormalBlending);
    this.decals = new DecalManager(scene, 90);
    this.tracers = new TracerPool(scene, 28);
    this.lights = new LightPool(scene, 6);
  }

  tracer(from, to) { this.tracers.add(from, to); }

  muzzleFlashWorld(pos) { this.lights.flash(pos, 0xffcf80, 7, 0.05); }

  impact(point, normal, material) {
    const n = normal || new THREE.Vector3(0, 1, 0);
    const px = point.x + n.x * 0.02, py = point.y + n.y * 0.02, pz = point.z + n.z * 0.02;
    // reflect-ish spray basis
    const t1 = new THREE.Vector3(n.y, n.z, -n.x).normalize();
    const t2 = new THREE.Vector3().crossVectors(n, t1).normalize();
    const burst = (count, pool, colFn, speed, size, life, grav, drag) => {
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2, r = Math.random();
        const dir = new THREE.Vector3()
          .addScaledVector(n, 0.5 + Math.random())
          .addScaledVector(t1, Math.cos(a) * r)
          .addScaledVector(t2, Math.sin(a) * r).normalize();
        const sp = speed * (0.4 + Math.random());
        const c = colFn();
        pool.spawn(px, py, pz, dir.x * sp, dir.y * sp, dir.z * sp, c[0], c[1], c[2],
          size * (0.6 + Math.random() * 0.8), life * (0.6 + Math.random() * 0.7), grav, drag);
      }
    };
    if (material === 'metal') {
      burst(14, this.sparks, () => [1, 0.8 + Math.random() * 0.2, 0.4], 7, 0.05, 0.4, 14, 2);
      burst(6, this.dust, () => [0.4, 0.4, 0.42], 2, 0.12, 0.5, 3, 2);
      this.lights.flash(new THREE.Vector3(px, py, pz), 0xffcf80, 3, 0.05);
      this.decals.add(point, n, 0.18);
    } else if (material === 'wood') {
      burst(10, this.dust, () => [0.45 + Math.random() * 0.2, 0.3, 0.15], 3, 0.1, 0.6, 7, 2);
      this.decals.add(point, n, 0.24);
    } else if (material === 'sand') {
      burst(14, this.dust, () => [0.78, 0.66, 0.42], 2.5, 0.16, 0.7, 5, 1.6);
    } else { // concrete / default
      burst(12, this.dust, () => [0.6, 0.58, 0.54], 2.6, 0.13, 0.6, 5, 1.8);
      burst(4, this.sparks, () => [1, 0.9, 0.7], 3, 0.04, 0.25, 8, 2);
      this.decals.add(point, n, 0.26);
    }
  }

  blood(point, dir) {
    const d = dir ? dir.clone().normalize() : new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < 16; i++) {
      const spread = new THREE.Vector3((Math.random() - 0.5), (Math.random() - 0.3), (Math.random() - 0.5));
      const v = d.clone().multiplyScalar(2 + Math.random() * 3).add(spread.multiplyScalar(3));
      this.dust.spawn(point.x, point.y, point.z, v.x, v.y, v.z,
        0.45 + Math.random() * 0.2, 0.03, 0.02, 0.07 + Math.random() * 0.05, 0.5 + Math.random() * 0.3, 16, 1.2);
    }
    // a couple bright droplets
    for (let i = 0; i < 5; i++) {
      const v = d.clone().multiplyScalar(3 + Math.random() * 2).add(new THREE.Vector3((Math.random() - 0.5) * 2, Math.random() * 2, (Math.random() - 0.5) * 2));
      this.dust.spawn(point.x, point.y, point.z, v.x, v.y, v.z, 0.6, 0.05, 0.05, 0.05, 0.4, 18, 1);
    }
  }

  explosion(pos) {
    for (let i = 0; i < 60; i++) {
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).normalize();
      const sp = 4 + Math.random() * 9;
      this.sparks.spawn(pos.x, pos.y + 0.3, pos.z, dir.x * sp, dir.y * sp, dir.z * sp,
        1, 0.6 + Math.random() * 0.3, 0.2, 0.12, 0.4 + Math.random() * 0.4, 8, 1.5);
    }
    for (let i = 0; i < 40; i++) {
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.6, Math.random() - 0.5).normalize();
      const sp = 1 + Math.random() * 4;
      this.dust.spawn(pos.x, pos.y + 0.4, pos.z, dir.x * sp, dir.y * sp + 1, dir.z * sp,
        0.25, 0.22, 0.2, 0.4, 1.0 + Math.random(), 1.5, 1.2);
    }
    this.lights.flash(pos.clone().setY(pos.y + 0.5), 0xffa040, 20, 0.18);
  }

  smoke(pos) {
    for (let i = 0; i < 4; i++) {
      this.dust.spawn(pos.x, pos.y, pos.z, (Math.random() - 0.5), 0.5 + Math.random(), (Math.random() - 0.5),
        0.3, 0.3, 0.3, 0.2, 0.5, -0.5, 1.5);
    }
  }

  update(dt) {
    this.sparks.update(dt);
    this.dust.update(dt);
    this.tracers.update(dt);
    this.lights.update(dt);
  }
  resize() { this.sparks.resize(); this.dust.resize(); }
}
