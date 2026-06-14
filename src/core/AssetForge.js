/**
 * AssetForge — procedural texture & material generation.
 *
 * The whole game ships with ZERO image files. Every surface texture
 * (sandstone, sand, wood, metal, concrete, …) is painted into a
 * <canvas> at load time, and a matching tangent-space normal map is
 * derived from a height field via a Sobel filter. This gives us a
 * cohesive, "baked-in-Unity" look without any external assets.
 */
import * as THREE from 'three';
import { ImprovedNoise } from 'three/addons/math/ImprovedNoise.js';

const noise = new ImprovedNoise();

/* ----------------------------- noise helpers ----------------------------- */

// Fractal Brownian motion sampled at (x,y); periodic-ish via large domain.
function fbm(x, y, octaves = 5, lac = 2.0, gain = 0.5, z = 0) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise.noise(x * freq, y * freq, z);
    norm += amp;
    amp *= gain;
    freq *= lac;
  }
  return sum / norm; // ~[-1,1]
}

// Tileable fbm: blends 4 copies so the canvas wraps seamlessly.
function tileFbm(u, v, scale, octaves, z = 0) {
  const x = u * scale, y = v * scale, s = scale;
  const a = fbm(x, y, octaves, 2, 0.5, z);
  const b = fbm(x - s, y, octaves, 2, 0.5, z);
  const c = fbm(x, y - s, octaves, 2, 0.5, z);
  const d = fbm(x - s, y - s, octaves, 2, 0.5, z);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
function lerp(a, b, t) { return a + (b - a) * t; }
function mixHex(c1, c2, t) {
  const r = Math.round(lerp((c1 >> 16) & 255, (c2 >> 16) & 255, t));
  const g = Math.round(lerp((c1 >> 8) & 255, (c2 >> 8) & 255, t));
  const b = Math.round(lerp(c1 & 255, c2 & 255, t));
  return `rgb(${r},${g},${b})`;
}

function newCanvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

/* ------------------ normal map from a height canvas (Sobel) ------------------ */

function heightToNormal(heightCanvas, strength = 2.0) {
  const s = heightCanvas.width;
  const hctx = heightCanvas.getContext('2d');
  const hd = hctx.getImageData(0, 0, s, s).data;
  const out = document.createElement('canvas');
  out.width = out.height = s;
  const octx = out.getContext('2d');
  const img = octx.createImageData(s, s);
  const d = img.data;
  const at = (x, y) => {
    const xx = (x + s) % s, yy = (y + s) % s;
    return hd[(yy * s + xx) * 4] / 255;
  };
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      // Sobel gradient
      const tl = at(x - 1, y - 1), t = at(x, y - 1), tr = at(x + 1, y - 1);
      const l = at(x - 1, y), r = at(x + 1, y);
      const bl = at(x - 1, y + 1), b = at(x, y + 1), br = at(x + 1, y + 1);
      const dx = (tr + 2 * r + br) - (tl + 2 * l + bl);
      const dy = (bl + 2 * b + br) - (tl + 2 * t + tr);
      let nx = -dx * strength, ny = -dy * strength, nz = 1;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;
      const i = (y * s + x) * 4;
      d[i] = (nx * 0.5 + 0.5) * 255;
      d[i + 1] = (ny * 0.5 + 0.5) * 255;
      d[i + 2] = (nz * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  return out;
}

function tex(canvas, repeat = 1, aniso = 8) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = aniso;
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}
function dataTex(canvas, repeat = 1) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 8;
  t.needsUpdate = true; // linear space (normal/rough)
  return t;
}

/* ============================ texture painters ============================ */

// Sandstone block wall — the signature desert surface.
function paintSandstone(size = 512) {
  const c = newCanvas(size), ctx = c.getContext('2d');
  const h = newCanvas(size), hctx = h.getContext('2d');
  const base = 0xc7a866, dark = 0x8f7440, light = 0xe2c585;
  // grain background
  const img = ctx.createImageData(size, size);
  const himg = hctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const n = tileFbm(u, v, 7, 5) * 0.5 + 0.5;
      const fine = tileFbm(u, v, 34, 3, 5.5) * 0.5 + 0.5;
      const t = clamp01(n * 0.7 + fine * 0.3);
      const col = t < 0.5 ? mixHex(dark, base, t * 2) : mixHex(base, light, (t - 0.5) * 2);
      const i = (y * size + x) * 4;
      const m = col.match(/\d+/g);
      img.data[i] = +m[0]; img.data[i + 1] = +m[1]; img.data[i + 2] = +m[2]; img.data[i + 3] = 255;
      const hv = (t * 0.6 + fine * 0.4) * 255;
      himg.data[i] = himg.data[i + 1] = himg.data[i + 2] = hv; himg.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  hctx.putImageData(himg, 0, 0);
  // mortar lines: brick courses
  const rows = 6, rowH = size / rows;
  ctx.strokeStyle = 'rgba(60,45,25,0.55)'; ctx.lineWidth = 3;
  hctx.strokeStyle = 'rgba(0,0,0,0.9)'; hctx.lineWidth = 4;
  for (let r = 0; r <= rows; r++) {
    const y = r * rowH;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(size, y); ctx.stroke();
    hctx.beginPath(); hctx.moveTo(0, y); hctx.lineTo(size, y); hctx.stroke();
    // vertical joints, offset every other row
    const off = (r % 2) * (size / 8);
    for (let xj = 0; xj <= 4; xj++) {
      const x = (xj * size / 4 + off) % size;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + rowH); ctx.stroke();
      hctx.beginPath(); hctx.moveTo(x, y); hctx.lineTo(x, y + rowH); hctx.stroke();
    }
  }
  // subtle highlight on top edge of courses (bevel)
  ctx.strokeStyle = 'rgba(255,235,190,0.18)'; ctx.lineWidth = 2;
  for (let r = 0; r <= rows; r++) {
    const y = r * rowH + 2; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(size, y); ctx.stroke();
  }
  // weathering blotches
  for (let i = 0; i < 40; i++) {
    const x = Math.random() * size, y = Math.random() * size, rad = 8 + Math.random() * 40;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, `rgba(90,70,40,${0.04 + Math.random() * 0.07})`);
    g.addColorStop(1, 'rgba(90,70,40,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, rad, 0, 7); ctx.fill();
  }
  return { map: c, height: h };
}

// Desert sand / dirt ground.
function paintSand(size = 512) {
  const c = newCanvas(size), ctx = c.getContext('2d');
  const h = newCanvas(size), hctx = h.getContext('2d');
  const img = ctx.createImageData(size, size), himg = hctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const dunes = tileFbm(u, v, 5, 4) * 0.5 + 0.5;
      const grain = tileFbm(u, v, 90, 2, 3.1) * 0.5 + 0.5;
      const t = clamp01(dunes * 0.75 + grain * 0.25);
      const col = mixHex(0xb39055, 0xe3c481, t);
      const i = (y * size + x) * 4; const m = col.match(/\d+/g);
      img.data[i] = +m[0]; img.data[i + 1] = +m[1]; img.data[i + 2] = +m[2]; img.data[i + 3] = 255;
      const hv = (dunes * 0.7 + grain * 0.3) * 255;
      himg.data[i] = himg.data[i + 1] = himg.data[i + 2] = hv; himg.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0); hctx.putImageData(himg, 0, 0);
  // scattered pebbles + footprints
  for (let i = 0; i < 90; i++) {
    const x = Math.random() * size, y = Math.random() * size, r = 1 + Math.random() * 3;
    ctx.fillStyle = `rgba(${110 + Math.random() * 40 | 0},${90 + Math.random() * 30 | 0},50,0.6)`;
    ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
  }
  return { map: c, height: h };
}

// Wooden supply crate plank texture.
function paintWood(size = 512) {
  const c = newCanvas(size), ctx = c.getContext('2d');
  const h = newCanvas(size), hctx = h.getContext('2d');
  const planks = 5, pw = size / planks;
  for (let p = 0; p < planks; p++) {
    const x0 = p * pw;
    const baseTone = 0.5 + Math.random() * 0.2;
    const base = mixHex(0x6e4a26, 0xa9763d, baseTone);
    ctx.fillStyle = base; ctx.fillRect(x0, 0, pw, size);
    hctx.fillStyle = `rgb(${(baseTone * 180) | 0},${(baseTone * 180) | 0},${(baseTone * 180) | 0})`;
    hctx.fillRect(x0, 0, pw, size);
    // wood grain streaks
    for (let g = 0; g < 30; g++) {
      const gy = Math.random() * size;
      ctx.strokeStyle = `rgba(${60 + Math.random() * 40 | 0},${40 + Math.random() * 25 | 0},20,${0.1 + Math.random() * 0.18})`;
      ctx.lineWidth = 0.6 + Math.random() * 1.6;
      ctx.beginPath(); ctx.moveTo(x0, gy);
      ctx.bezierCurveTo(x0 + pw * 0.33, gy + (Math.random() - 0.5) * 20, x0 + pw * 0.66, gy + (Math.random() - 0.5) * 20, x0 + pw, gy + (Math.random() - 0.5) * 16);
      ctx.stroke();
    }
    // plank gap shadow
    ctx.fillStyle = 'rgba(20,12,5,0.65)'; ctx.fillRect(x0, 0, 3, size);
    hctx.fillStyle = 'rgba(0,0,0,1)'; hctx.fillRect(x0, 0, 4, size);
    ctx.fillStyle = 'rgba(255,225,180,0.12)'; ctx.fillRect(x0 + 3, 0, 2, size);
  }
  // metal banding + bolts (crate frame)
  ctx.fillStyle = '#3a3a3e';
  const band = size * 0.13;
  for (const by of [size * 0.08, size * 0.78]) { ctx.fillRect(0, by, size, band * 0.6); }
  hctx.fillStyle = '#cfcfcf';
  for (const by of [size * 0.08, size * 0.78]) { hctx.fillRect(0, by, size, band * 0.6); }
  ctx.fillStyle = '#1a1a1c';
  for (let i = 0; i < 10; i++) {
    const x = (i + 0.5) * size / 10;
    for (const by of [size * 0.08 + band * 0.3, size * 0.78 + band * 0.3]) {
      ctx.beginPath(); ctx.arc(x, by, 3, 0, 7); ctx.fill();
    }
  }
  // stencil mark
  ctx.fillStyle = 'rgba(40,30,15,0.5)';
  ctx.font = `bold ${size * 0.12}px monospace`; ctx.textAlign = 'center';
  ctx.fillText('SUPPLY', size / 2, size * 0.52);
  return { map: c, height: h };
}

// Painted/rusted metal (barrels, truck, doors).
function paintMetal(size = 512, baseColor = 0x6a6f63, rust = 0.4) {
  const c = newCanvas(size), ctx = c.getContext('2d');
  const h = newCanvas(size), hctx = h.getContext('2d');
  const img = ctx.createImageData(size, size), himg = hctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const n = tileFbm(u, v, 12, 4) * 0.5 + 0.5;
      const r = clamp01(tileFbm(u, v, 6, 4, 9.2) * 0.5 + 0.5 - (1 - rust));
      const metal = mixHex(baseColor, 0x33352f, (1 - n) * 0.4);
      const final = r > 0.34 ? blend(metal, '#7a3a1c', clamp01((r - 0.34) * 1.5)) : metal;
      const i = (y * size + x) * 4; const m = final.match(/\d+/g);
      img.data[i] = +m[0]; img.data[i + 1] = +m[1]; img.data[i + 2] = +m[2]; img.data[i + 3] = 255;
      const hv = (n * 0.7 + r * 0.3) * 255;
      himg.data[i] = himg.data[i + 1] = himg.data[i + 2] = hv; himg.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0); hctx.putImageData(himg, 0, 0);
  // horizontal ribs (barrel feel)
  ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 3;
  hctx.strokeStyle = 'rgba(255,255,255,0.5)'; hctx.lineWidth = 3;
  for (const ry of [size * 0.25, size * 0.5, size * 0.75]) {
    ctx.beginPath(); ctx.moveTo(0, ry); ctx.lineTo(size, ry); ctx.stroke();
    hctx.beginPath(); hctx.moveTo(0, ry - 2); hctx.lineTo(size, ry - 2); hctx.stroke();
  }
  return { map: c, height: h };
}
function blend(rgbStr, hex2, t) {
  const m = rgbStr.match(/\d+/g);
  const c1 = (+m[0] << 16) | (+m[1] << 8) | +m[2];
  const h2 = parseInt(hex2.slice(1), 16);
  return mixHex(c1, h2, t);
}

// Concrete / plaster (platforms, steps).
function paintConcrete(size = 512, tint = 0x9a9488) {
  const c = newCanvas(size), ctx = c.getContext('2d');
  const h = newCanvas(size), hctx = h.getContext('2d');
  const img = ctx.createImageData(size, size), himg = hctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const n = tileFbm(u, v, 8, 5) * 0.5 + 0.5;
      const spec = tileFbm(u, v, 60, 2, 2.2) * 0.5 + 0.5;
      const t = clamp01(n * 0.8 + spec * 0.2);
      const col = mixHex(0x5f5a50, tint, t);
      const i = (y * size + x) * 4; const m = col.match(/\d+/g);
      img.data[i] = +m[0]; img.data[i + 1] = +m[1]; img.data[i + 2] = +m[2]; img.data[i + 3] = 255;
      const hv = t * 255; himg.data[i] = himg.data[i + 1] = himg.data[i + 2] = hv; himg.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0); hctx.putImageData(himg, 0, 0);
  // cracks
  ctx.strokeStyle = 'rgba(30,28,24,0.5)'; ctx.lineWidth = 1.2;
  for (let i = 0; i < 6; i++) {
    let x = Math.random() * size, y = Math.random() * size;
    ctx.beginPath(); ctx.moveTo(x, y);
    for (let s = 0; s < 8; s++) { x += (Math.random() - 0.5) * 60; y += (Math.random() - 0.5) * 60; ctx.lineTo(x, y); }
    ctx.stroke();
  }
  return { map: c, height: h };
}

/* ============================ public API ============================ */

export class AssetForge {
  constructor() { this.cache = new Map(); this.materials = new Map(); }

  // Build a standard PBR material from a painter result.
  _material(key, painter, opts = {}) {
    if (this.materials.has(key)) return this.materials.get(key);
    const { map, height } = painter();
    const repeat = opts.repeat || 1;
    const colorTex = tex(map, repeat, opts.aniso || 8);
    const normalTex = dataTex(heightToNormal(height, opts.normalStrength ?? 2.0), repeat);
    const mat = new THREE.MeshStandardMaterial({
      map: colorTex,
      normalMap: normalTex,
      roughness: opts.roughness ?? 0.92,
      metalness: opts.metalness ?? 0.0,
      color: opts.color ?? 0xffffff,
    });
    if (opts.normalScale) mat.normalScale.set(opts.normalScale, opts.normalScale);
    this.materials.set(key, mat);
    return mat;
  }

  sandstone(repeat = 2) { return this._material('sandstone' + repeat, () => paintSandstone(512), { repeat, roughness: 0.95, normalStrength: 2.4 }); }
  plaster(repeat = 2) { return this._material('plaster' + repeat, () => paintConcrete(512, 0xcdb98e), { repeat, roughness: 0.9, normalStrength: 1.4 }); }
  sand(repeat = 18) { return this._material('sand' + repeat, () => paintSand(512), { repeat, roughness: 1.0, normalStrength: 1.6, aniso: 16 }); }
  wood(repeat = 1) { return this._material('wood' + repeat, () => paintWood(512), { repeat, roughness: 0.8, normalStrength: 2.2 }); }
  concrete(repeat = 2) { return this._material('concrete' + repeat, () => paintConcrete(512), { repeat, roughness: 0.88, normalStrength: 1.6 }); }
  metalRed(repeat = 1) { return this._material('metalRed', () => paintMetal(512, 0x9a2f24, 0.45), { repeat, roughness: 0.55, metalness: 0.6, normalStrength: 1.6 }); }
  metalBlue(repeat = 1) { return this._material('metalBlue', () => paintMetal(512, 0x35506e, 0.35), { repeat, roughness: 0.5, metalness: 0.6, normalStrength: 1.6 }); }
  metalGreen(repeat = 1) { return this._material('metalGreen', () => paintMetal(512, 0x55603f, 0.5), { repeat, roughness: 0.6, metalness: 0.55, normalStrength: 1.6 }); }
  metalRust(repeat = 1) { return this._material('metalRust', () => paintMetal(512, 0x6b5240, 0.75), { repeat, roughness: 0.75, metalness: 0.4, normalStrength: 1.8 }); }
  metalDark(repeat = 1) { return this._material('metalDark', () => paintMetal(512, 0x3c3e3a, 0.2), { repeat, roughness: 0.45, metalness: 0.75, normalStrength: 1.2 }); }

  // A flat tinted material (no texture) for accents.
  flat(color, roughness = 0.85, metalness = 0.0) {
    const key = `flat${color}_${roughness}_${metalness}`;
    if (this.materials.has(key)) return this.materials.get(key);
    const m = new THREE.MeshStandardMaterial({ color, roughness, metalness });
    this.materials.set(key, m);
    return m;
  }

  dispose() {
    for (const m of this.materials.values()) {
      m.map?.dispose(); m.normalMap?.dispose(); m.dispose();
    }
    this.materials.clear();
  }
}

export const Forge = new AssetForge();
