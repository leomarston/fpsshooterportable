// Trailer Park map test: builds the imported (FBX→glTF) map, verifies the
// merged collider, single-level ground, spawns on open lot ground, walking
// physics and bots, with no missing textures or runtime errors. Captures a
// first-person screenshot of the lot.
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer';

const PORT = 8190, QUALITY = process.env.QUALITY || 'medium';
const server = spawn('node', ['serve.js'], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 900));
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1280,720'] });
let ok = true; const errors = [], texFails = [];
const A = (c, m) => { if (!c) { ok = false; console.log('  FAIL:', m); } else console.log('  ok  :', m); };
try {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument((q) => localStorage.setItem('desertstorm.settings.v1', JSON.stringify({ quality: q, bloom: true, volume: 0 })), QUALITY);
  await page.setViewport({ width: 1280, height: 720 });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('requestfailed', r => { if (/\/Textures\//.test(r.url())) texFails.push(r.url()); });
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load', timeout: 30000 });
  await page.waitForFunction('window.__game && window.__game.built === true', { timeout: 40000 });

  const r = await page.evaluate(async () => {
    const g = window.__game;
    await g.build(null, 'trailer');
    const w = g.world;
    g.startMatch(1, 4, { map: 'trailer' });
    g.closeBuy(g.players[0]); g.frozen = false; g._freezeEnd = 0;
    const P = g.players[0].ent, ct = g.mapInfo.spawnsCT[0], tt = g.mapInfo.spawnsT[0];
    // settle + walk in the best of 4 directions (spawn must not be boxed in)
    const walk = (yaw) => { P.feet.set(ct.x, ct.y + 0.6, ct.z); P.vel.set(0, 0, 0); P.yaw = yaw; for (let i = 0; i < 30; i++) g.update(1 / 60); const sx = P.feet.x, sz = P.feet.z, sy = P.feet.y; P.input.keys.add('KeyW'); let lo = sy, hi = sy; for (let i = 0; i < 50; i++) { g.update(1 / 60); lo = Math.min(lo, P.feet.y); hi = Math.max(hi, P.feet.y); } P.input.keys.delete('KeyW'); return { d: Math.hypot(P.feet.x - sx, P.feet.z - sz), lo, hi }; };
    const w0 = walk(0), w1 = walk(Math.PI), w2 = walk(Math.PI / 2), w3 = walk(-Math.PI / 2);
    const maxMove = Math.max(w0.d, w1.d, w2.d, w3.d);
    const lo = Math.min(w0.lo, w1.lo, w2.lo, w3.lo), hi = Math.max(w0.hi, w1.hi, w2.hi, w3.hi);
    return {
      builtMap: g._builtMap, isMesh: !!(w && w.tri && w.count), tris: w.count, mainFloorY: +w.mainFloorY.toFixed(2),
      spawnsCT: g.mapInfo.spawnsCT.length, spawnsT: g.mapInfo.spawnsT.length,
      spawnDist: +Math.hypot(ct.x - tt.x, ct.z - tt.z).toFixed(1),
      maxMove: +maxMove.toFixed(2), lo: +lo.toFixed(2), hi: +hi.toFixed(2),
      bots: g.enemyMgr.enemies.length, state: g.state,
    };
  });
  console.log('  ' + JSON.stringify(r));
  A(r.builtMap === 'trailer', 'trailer map is the active build');
  A(r.isMesh && r.tris > 50000, 'mesh collider built (' + r.tris + ' tris)');
  A(r.spawnsCT > 0 && r.spawnsT > 0, 'spawns found for both teams');
  A(r.maxMove > 3, 'player can run from spawn (open ground, not boxed in: ' + r.maxMove + 'm)');
  A(r.lo > r.mainFloorY - 3, 'player never falls into the void (lo=' + r.lo + ')');
  A(r.bots >= 1, 'bots spawned on the trailer park');

  // first-person screenshot facing the enemy spawn
  await page.evaluate(() => {
    const g = window.__game, P = g.players[0].ent, ct = g.mapInfo.spawnsCT[0], tt = g.mapInfo.spawnsT[0];
    P.feet.set(ct.x, ct.y, ct.z); P.yaw = Math.atan2(-(tt.x - ct.x), -(tt.z - ct.z)); P.pitch = -0.03; P._updateCamera(0.016);
    document.getElementById('hudv-1').classList.add('full');
    for (let i = 0; i < 150; i++) g.update(1 / 60);
    for (let i = 0; i < 4; i++) window.__engine.render(g.views());
  });
  await page.screenshot({ path: 'tools/trailer_play.png' });
  console.log('  trailer_play.png captured');

  A(texFails.length === 0, 'no missing textures (' + texFails.length + ')');
  A(errors.length === 0, 'no runtime errors');
  errors.slice(0, 8).forEach(e => console.log('   ERR:', e));
  console.log('\n  trailer test: ' + (ok && !errors.length ? 'PASSED ✅' : 'FAILED ❌'));
} catch (e) { ok = false; console.error('  crashed:', e.message); }
finally { await browser.close(); server.kill(); process.exit(ok && errors.length === 0 ? 0 : 1); }
