/**
 * WeaponModels — detailed first-person weapon models built procedurally
 * from extruded/beveled silhouettes, lathed barrels and detail parts, with
 * reflective PBR materials. Designed to read like sculpted "Blender" assets
 * rather than primitive boxes. No external models.
 *
 * Design space: the gun is built pointing +X (muzzle), up = +Y, width = Z.
 * An inner group is rotated so the muzzle points -Z (viewmodel forward).
 * Animatable parts (slide / bolt / pump) reciprocate along the gun's
 * length (local X); see WeaponManager._animateParts.
 */
import * as THREE from 'three';
import { roundedBox } from '../core/Geo.js';

let MATS = null;
function mats() {
  if (MATS) return MATS;
  const M = (o) => new THREE.MeshStandardMaterial(o);
  MATS = {
    gunmetal: M({ color: 0x202227, metalness: 0.92, roughness: 0.34, envMapIntensity: 1.1 }),
    black:    M({ color: 0x17181c, metalness: 0.55, roughness: 0.5, envMapIntensity: 0.9 }),
    poly:     M({ color: 0x1b1d22, metalness: 0.2, roughness: 0.62, envMapIntensity: 0.7 }),
    steel:    M({ color: 0xb7bcc4, metalness: 0.96, roughness: 0.22, envMapIntensity: 1.3 }),
    chrome:   M({ color: 0xd8dde4, metalness: 1.0, roughness: 0.12, envMapIntensity: 1.5 }),
    wood:     M({ color: 0x6e4a24, metalness: 0.08, roughness: 0.72, envMapIntensity: 0.5 }),
    woodDark: M({ color: 0x4f3517, metalness: 0.08, roughness: 0.75 }),
    fde:      M({ color: 0x9a8158, metalness: 0.2, roughness: 0.6 }),
    brass:    M({ color: 0xcaa24a, metalness: 0.9, roughness: 0.35 }),
    rubber:   M({ color: 0x121316, metalness: 0.1, roughness: 0.85 }),
    glass:    M({ color: 0x16242e, metalness: 0.4, roughness: 0.1, envMapIntensity: 1.4 }),
    blade:    M({ color: 0xc7ccd4, metalness: 0.95, roughness: 0.18, envMapIntensity: 1.4 }),
  };
  return MATS;
}

/* ------------------------------ helpers ------------------------------ */
// Extruded silhouette: points are [x=length, y=height]; width along Z.
function extrude(points, width, mat, bevel = 0.004) {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) shape.lineTo(points[i][0], points[i][1]);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: width, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel,
    bevelSegments: 2, curveSegments: 6, steps: 1,
  });
  geo.translate(0, 0, -width / 2);
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, mat);
}
// Cylinder along the gun length (X).
function tubeX(r1, r2, len, mat, segs = 18) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, len, segs), mat);
  m.rotation.z = Math.PI / 2;
  return m;
}
// Lathed profile (points [radius,y]) revolved, lying along X.
function latheX(profile, mat, segs = 20) {
  const pts = profile.map(p => new THREE.Vector2(p[0], p[1]));
  const m = new THREE.Mesh(new THREE.LatheGeometry(pts, segs), mat);
  m.rotation.z = -Math.PI / 2;   // lay the lathe axis along +X
  return m;
}
function rbox(w, h, d, r, mat) { return new THREE.Mesh(roundedBox(w, h, d, r, 3), mat); }
function box(w, h, d, mat) { return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); }
function torus(r, t, mat, seg = 20) { return new THREE.Mesh(new THREE.TorusGeometry(r, t, 10, seg), mat); }
function pos(m, x, y, z) { m.position.set(x, y, z); return m; }

/* ============================ builders ============================ */

function buildKnife(v) {
  const m = mats(); const g = new THREE.Group();
  // handle
  const handle = pos(rbox(0.04, 0.05, 0.16, 0.018, m.rubber), 0.06, 0, 0); g.add(handle);
  pos(box(0.012, 0.09, 0.04, m.gunmetal), 0.0, 0, 0).name = 'guard'; // crossguard
  g.add(pos(box(0.012, 0.09, 0.045, m.gunmetal), 0.0, 0, 0));
  // blade (tapered, beveled) — profile in [x,y]
  const blade = extrude([[0, -0.015], [0.26, -0.005], [0.30, 0.01], [0.26, 0.028], [0, 0.022]], 0.01, m.blade, 0.002);
  pos(blade, -0.0, 0.01, 0); g.add(blade);
  const muzzle = new THREE.Object3D(); muzzle.position.set(-0.30, 0.01, 0); g.add(muzzle);
  return { inner: g, muzzle, parts: {}, eject: new THREE.Vector3(0, 0, 0) };
}

function buildPistol(variant) {
  const m = mats(); const g = new THREE.Group();
  const cfg = {
    glock:     { L: 0.30, sh: 0.075, slideMat: m.gunmetal, frameMat: m.poly, barrel: 0.013, mag: 0.16, ported: false, comp: false },
    p250:      { L: 0.26, sh: 0.078, slideMat: m.gunmetal, frameMat: m.poly, barrel: 0.013, mag: 0.13, ported: false, comp: true },
    fiveseven: { L: 0.30, sh: 0.072, slideMat: m.black, frameMat: m.poly, barrel: 0.012, mag: 0.16, ported: false, comp: false },
    auto:      { L: 0.30, sh: 0.075, slideMat: m.gunmetal, frameMat: m.poly, barrel: 0.013, mag: 0.22, ported: false, comp: false, sw: true },
    deagle:    { L: 0.40, sh: 0.095, slideMat: m.steel, frameMat: m.gunmetal, barrel: 0.018, mag: 0.18, ported: true, comp: false, big: true },
  }[variant] || {};
  const L = cfg.L, sh = cfg.sh, w = cfg.big ? 0.06 : 0.05, yTop = 0.16;

  // --- slide (animatable) ---
  const slide = new THREE.Group();
  const slideBody = extrude([
    [-0.06, yTop - sh], [L - 0.03, yTop - sh], [L, yTop - sh + 0.012],
    [L, yTop - 0.004], [L - 0.02, yTop], [-0.06, yTop],
  ], w, cfg.slideMat, 0.004);
  slide.add(slideBody);
  // ejection port notch (dark inset)
  slide.add(pos(box(0.06, 0.03, w + 0.005, m.black), L * 0.45, yTop - 0.02, 0.005));
  // rear serrations
  for (let i = 0; i < 6; i++) slide.add(pos(box(0.008, sh * 0.7, w + 0.004, m.black), -0.05 + i * 0.012, yTop - sh / 2, 0));
  // sights
  slide.add(pos(box(0.012, 0.016, 0.012, m.black), L - 0.02, yTop + 0.006, 0));   // front
  slide.add(pos(box(0.02, 0.018, w * 0.7, m.black), -0.045, yTop + 0.006, 0));     // rear
  slide.position.set(0, 0, 0); g.add(slide);

  // --- barrel tip + (deagle) ported rib ---
  g.add(pos(tubeX(cfg.barrel, cfg.barrel, 0.04, m.steel), L + 0.005, yTop - sh + 0.02, 0));
  if (cfg.ported) {
    g.add(pos(box(L * 0.6, 0.012, 0.02, m.gunmetal), L * 0.45, yTop + 0.004, 0)); // top rib
    for (let i = 0; i < 5; i++) g.add(pos(box(0.006, 0.02, 0.012, m.black), 0.12 + i * 0.03, yTop - sh + 0.02, 0));
  }

  // --- frame + trigger guard ---
  const frame = extrude([
    [-0.06, yTop - sh], [L - 0.05, yTop - sh], [L - 0.05, yTop - sh - 0.018],
    [0.02, yTop - sh - 0.018], [-0.06, yTop - sh],
  ], w - 0.004, cfg.frameMat, 0.003);
  g.add(frame);
  // grip (angled down/back)
  const gripH = cfg.big ? 0.18 : 0.16;
  const grip = extrude([
    [-0.05, yTop - sh - 0.018], [0.0, yTop - sh - 0.018],
    [-0.01, yTop - sh - gripH], [-0.06, yTop - sh - gripH], [-0.07, yTop - sh - 0.02],
  ], w - 0.006, cfg.frameMat, 0.004);
  g.add(grip);
  // grip texture ridges
  for (let i = 0; i < 5; i++) g.add(pos(box(0.03, 0.006, w, m.black), -0.035, yTop - sh - 0.05 - i * 0.02, 0));
  // trigger guard
  const tg = torus(0.026, 0.007, cfg.frameMat, 16); pos(tg, 0.0, yTop - sh - 0.03, 0); g.add(tg);
  g.add(pos(box(0.008, 0.022, 0.01, m.steel), 0.0, yTop - sh - 0.028, 0)); // trigger
  // select-fire switch (auto)
  if (cfg.sw) g.add(pos(box(0.02, 0.012, 0.006, m.brass), -0.04, yTop - sh - 0.008, w / 2));

  // --- magazine base ---
  g.add(pos(rbox(0.03, 0.04, w - 0.01, 0.008, m.gunmetal), -0.04, yTop - sh - gripH + 0.01, 0));
  if (variant === 'auto') g.add(pos(rbox(0.028, 0.08, w - 0.012, 0.008, m.black), -0.035, yTop - sh - gripH - 0.03, 0)); // extended mag

  const muzzle = new THREE.Object3D(); muzzle.position.set(L + 0.04, yTop - sh + 0.02, 0); g.add(muzzle);
  return { inner: g, muzzle, parts: { slide, slideAxis: 'x', slideBase: 0 }, eject: new THREE.Vector3(L * 0.45, yTop - 0.01, w) };
}

function buildSMG() { // MP5-style
  const m = mats(); const g = new THREE.Group(); const w = 0.05;
  // receiver (rounded tube look) — extrude with rounded top
  const recv = extrude([
    [-0.18, 0.0], [0.3, 0.0], [0.34, 0.01], [0.34, 0.06], [0.3, 0.07], [-0.18, 0.07], [-0.2, 0.05], [-0.2, 0.02],
  ], w, m.black, 0.005);
  g.add(recv);
  g.add(pos(tubeX(0.032, 0.032, 0.5, m.black), 0.07, 0.035, 0));       // receiver cylinder feel
  g.add(pos(tubeX(0.018, 0.016, 0.18, m.gunmetal), 0.42, 0.035, 0));   // barrel/shroud
  // front sight hood (MP5 ring)
  const fs = torus(0.022, 0.005, m.black, 14); pos(fs, 0.46, 0.035, 0); fs.rotation.y = Math.PI / 2; g.add(fs);
  // handguard
  g.add(pos(rbox(0.16, 0.05, 0.055, 0.02, m.poly), 0.28, 0.0, 0));
  // curved magazine
  const mag = extrude([[0, 0], [0.05, 0], [0.07, -0.22], [0.02, -0.24], [-0.01, -0.02]], w - 0.008, m.gunmetal, 0.004);
  pos(mag, 0.02, -0.0, 0); mag.rotation.z = 0.18; g.add(mag);
  // pistol grip
  g.add(pos(extrude([[-0.02, 0], [0.03, 0], [0.0, -0.13], [-0.05, -0.13]], w - 0.01, m.poly, 0.004), -0.08, 0.0, 0));
  // retractable stock
  g.add(pos(tubeX(0.01, 0.01, 0.16, m.gunmetal), -0.26, 0.03, 0.018));
  g.add(pos(tubeX(0.01, 0.01, 0.16, m.gunmetal), -0.26, 0.03, -0.018));
  g.add(pos(rbox(0.04, 0.06, 0.05, 0.015, m.poly), -0.34, 0.03, 0));
  // cocking handle (animatable bolt)
  const bolt = pos(rbox(0.03, 0.018, 0.018, 0.006, m.steel), 0.2, 0.07, w / 2 + 0.01);
  g.add(bolt);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0.52, 0.035, 0); g.add(muzzle);
  return { inner: g, muzzle, parts: { bolt, boltAxis: 'x', boltBase: 0.2 }, eject: new THREE.Vector3(0.18, 0.06, w) };
}

function buildShotgun() { // pump (Nova-style)
  const m = mats(); const g = new THREE.Group(); const w = 0.055;
  // receiver
  g.add(extrude([[-0.1, 0], [0.22, 0], [0.24, 0.06], [-0.1, 0.06]], w, m.gunmetal, 0.005));
  // barrel
  g.add(pos(tubeX(0.02, 0.02, 0.5, m.gunmetal), 0.42, 0.045, 0));
  g.add(pos(tubeX(0.014, 0.014, 0.48, m.gunmetal), 0.42, 0.012, 0)); // mag tube under barrel
  g.add(pos(box(0.012, 0.014, 0.012, m.steel), 0.66, 0.06, 0));      // bead sight
  // pump fore-end (animatable)
  const pump = pos(rbox(0.12, 0.04, 0.06, 0.018, m.woodDark), 0.34, 0.012, 0);
  for (let i = 0; i < 5; i++) pump.add(pos(box(0.012, 0.005, 0.062, m.black), -0.04 + i * 0.02, 0.022, 0));
  g.add(pump);
  // wood stock (extruded)
  g.add(pos(extrude([[0, 0.06], [0.0, 0.0], [-0.24, -0.06], [-0.26, -0.04], [-0.26, 0.02], [-0.04, 0.07]], w - 0.006, m.wood, 0.005), -0.06, 0, 0));
  // grip area + trigger guard
  g.add(pos(torus(0.024, 0.006, m.gunmetal, 14), -0.02, -0.0, 0));
  const muzzle = new THREE.Object3D(); muzzle.position.set(0.67, 0.045, 0); g.add(muzzle);
  return { inner: g, muzzle, parts: { pump, pumpAxis: 'x', pumpBase: 0.34 }, eject: new THREE.Vector3(0.16, 0.05, w) };
}

function buildAK() {
  const m = mats(); const g = new THREE.Group(); const w = 0.05;
  // receiver (steel, slight slope)
  g.add(extrude([[-0.16, 0], [0.26, 0], [0.27, 0.055], [-0.15, 0.06], [-0.17, 0.03]], w, m.gunmetal, 0.005));
  // dust cover top with rib
  g.add(pos(box(0.42, 0.012, w, m.gunmetal), 0.05, 0.062, 0));
  // wood handguard (upper + lower)
  g.add(pos(rbox(0.18, 0.04, 0.052, 0.02, m.wood), 0.32, 0.052, 0));
  g.add(pos(rbox(0.18, 0.045, 0.058, 0.02, m.wood), 0.33, 0.005, 0));
  // gas tube
  g.add(pos(tubeX(0.014, 0.014, 0.18, m.gunmetal), 0.34, 0.055, 0));
  // barrel + front sight + muzzle
  g.add(pos(tubeX(0.012, 0.012, 0.2, m.steel), 0.5, 0.028, 0));
  g.add(pos(box(0.02, 0.04, 0.018, m.gunmetal), 0.58, 0.045, 0));     // front sight block
  g.add(pos(tubeX(0.016, 0.016, 0.05, m.gunmetal), 0.64, 0.028, 0));  // muzzle nut
  // curved magazine (the AK signature)
  const mag = extrude([[0, 0], [0.07, 0.0], [0.12, -0.2], [0.04, -0.24], [-0.02, -0.02]], w - 0.008, m.gunmetal, 0.004);
  pos(mag, 0.06, 0.0, 0); mag.rotation.z = 0.12; g.add(mag);
  // pistol grip (wood)
  g.add(pos(extrude([[-0.02, 0], [0.04, 0], [0.0, -0.13], [-0.06, -0.13]], w - 0.01, m.wood, 0.004), -0.04, 0, 0));
  // wood stock
  g.add(pos(extrude([[0, 0.055], [0.0, 0.0], [-0.22, -0.02], [-0.22, 0.05]], w - 0.006, m.wood, 0.005), -0.14, 0.005, 0));
  // charging handle (animatable bolt)
  const bolt = pos(rbox(0.03, 0.016, 0.016, 0.005, m.steel), 0.16, 0.045, w / 2 + 0.008);
  g.add(bolt);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0.69, 0.028, 0); g.add(muzzle);
  return { inner: g, muzzle, parts: { bolt, boltAxis: 'x', boltBase: 0.16 }, eject: new THREE.Vector3(0.12, 0.05, w) };
}

function buildM4() {
  const m = mats(); const g = new THREE.Group(); const w = 0.048;
  // flat-top receiver
  g.add(extrude([[-0.14, 0], [0.24, 0], [0.24, 0.055], [-0.14, 0.055]], w, m.black, 0.004));
  g.add(pos(box(0.46, 0.012, w * 0.6, m.black), 0.05, 0.062, 0));      // top rail
  // round handguard (RIS)
  g.add(pos(tubeX(0.026, 0.026, 0.22, m.black), 0.36, 0.028, 0));
  for (let i = 0; i < 6; i++) g.add(pos(box(0.18, 0.006, 0.01, m.gunmetal), 0.36, 0.028 + 0.026 * Math.cos(i / 6 * 6.28), 0.026 * Math.sin(i / 6 * 6.28)));
  // barrel + flash hider
  g.add(pos(tubeX(0.012, 0.012, 0.16, m.steel), 0.54, 0.028, 0));
  g.add(pos(latheX([[0, 0], [0.018, 0], [0.018, 0.01], [0.012, 0.012], [0.018, 0.02], [0.012, 0.022], [0.018, 0.032], [0, 0.034]], m.gunmetal), 0.62, 0.028, 0)); // birdcage
  // straight magazine
  g.add(pos(rbox(0.05, 0.2, w - 0.01, 0.012, m.poly), 0.04, -0.1, 0));
  // grip + stock
  g.add(pos(extrude([[-0.02, 0], [0.04, 0], [0.0, -0.12], [-0.06, -0.12]], w - 0.01, m.poly, 0.004), -0.04, 0, 0));
  g.add(pos(rbox(0.05, 0.02, 0.022, 0.008, m.black), -0.18, 0.03, 0));     // buffer tube
  g.add(pos(tubeX(0.016, 0.016, 0.1, m.black), -0.18, 0.03, 0));
  g.add(pos(extrude([[0, 0.05], [0, -0.02], [-0.1, -0.04], [-0.12, 0.04]], w, m.poly, 0.005), -0.22, 0.01, 0)); // stock
  // carry/rear sight + charging handle (bolt)
  g.add(pos(box(0.03, 0.02, w * 0.7, m.black), -0.1, 0.07, 0));
  const bolt = pos(rbox(0.02, 0.014, w * 0.5, 0.005, m.gunmetal), -0.12, 0.06, 0);
  g.add(bolt);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0.66, 0.028, 0); g.add(muzzle);
  return { inner: g, muzzle, parts: { bolt, boltAxis: 'x', boltBase: -0.12 }, eject: new THREE.Vector3(0.16, 0.05, w) };
}

function buildSniper() { // AWP-style
  const m = mats(); const g = new THREE.Group(); const w = 0.05;
  // long action body (green)
  const body = mats().gunmetal;
  g.add(extrude([[-0.2, 0], [0.34, 0], [0.34, 0.05], [-0.2, 0.05]], w, m.poly, 0.005));
  // heavy fluted barrel
  g.add(pos(tubeX(0.018, 0.016, 0.5, m.gunmetal), 0.58, 0.028, 0));
  g.add(pos(latheX([[0, 0], [0.026, 0], [0.026, 0.02], [0.018, 0.022], [0.026, 0.04], [0, 0.042]], m.gunmetal), 0.82, 0.028, 0)); // muzzle brake
  // big scope (tube + bells + glass + rings)
  const scope = new THREE.Group();
  scope.add(pos(tubeX(0.03, 0.03, 0.26, m.black), 0, 0, 0));
  scope.add(pos(tubeX(0.042, 0.034, 0.05, m.black), -0.13, 0, 0));   // ocular bell
  scope.add(pos(tubeX(0.04, 0.034, 0.05, m.black), 0.13, 0, 0));     // objective bell
  scope.add(pos(tubeX(0.038, 0.038, 0.006, m.glass), 0.155, 0, 0));  // lens
  scope.add(pos(box(0.018, 0.04, 0.018, m.gunmetal), -0.04, -0.03, 0)); // turret
  for (const rx of [-0.06, 0.06]) { const r = pos(torus(0.032, 0.008, m.gunmetal, 14), rx, -0.02, 0); r.rotation.y = Math.PI / 2; scope.add(r); }
  pos(scope, 0.12, 0.085, 0); g.add(scope);
  // thumbhole skeleton stock (extruded with a hole-ish shape)
  g.add(pos(extrude([[0, 0.05], [0.0, -0.01], [-0.26, -0.03], [-0.3, 0.0], [-0.3, 0.05], [-0.06, 0.06]], w - 0.006, m.poly, 0.005), -0.12, 0.0, 0));
  g.add(pos(extrude([[-0.02, 0], [0.04, 0], [0.0, -0.12], [-0.06, -0.12]], w - 0.01, m.poly, 0.004), -0.02, 0, 0)); // grip
  // magazine + bolt handle (animatable)
  g.add(pos(rbox(0.05, 0.1, w - 0.012, 0.01, m.gunmetal), 0.06, -0.05, 0));
  const bolt = new THREE.Group();
  bolt.add(pos(tubeX(0.008, 0.008, 0.05, m.steel), 0, 0, 0.03));
  bolt.add(pos(new THREE.Mesh(new THREE.SphereGeometry(0.012, 10, 8), m.steel), 0, 0, 0.055));
  pos(bolt, 0.18, 0.04, w / 2 - 0.01); g.add(bolt);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0.86, 0.028, 0); g.add(muzzle);
  return { inner: g, muzzle, parts: { bolt, boltAxis: 'x', boltBase: 0.18 }, eject: new THREE.Vector3(0.12, 0.05, w) };
}

/* ----------------------------- dispatch ----------------------------- */
export function buildWeaponModel(weapon) {
  const v = weapon.view || {}; let r;
  switch (v.kind) {
    case 'knife': r = buildKnife(v); break;
    case 'pistol': r = buildPistol(v.variant || 'glock'); break;
    case 'smg': r = buildSMG(); break;
    case 'shotgun': r = buildShotgun(); break;
    case 'rifle_ak': r = buildAK(); break;
    case 'rifle_m4': r = buildM4(); break;
    case 'sniper': r = buildSniper(); break;
    default: r = buildPistol('glock');
  }
  // orient: design +X (muzzle) -> world -Z (viewmodel forward)
  const outer = new THREE.Group();
  r.inner.rotation.y = Math.PI / 2;
  outer.add(r.inner);
  outer.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; o.frustumCulled = false; } });
  return { group: outer, muzzle: r.muzzle, parts: r.parts, eject: r.eject };
}
