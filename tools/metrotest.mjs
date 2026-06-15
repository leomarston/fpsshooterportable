// Metro map test: builds the imported glTF station, verifies the triangle
// collider (floor/ground, walls, spawns), runs the match loop with bots, and
// captures a first-person screenshot of the playable interior.
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer';

const PORT = 8130, QUALITY = process.env.QUALITY || 'medium';
const server = spawn('node', ['serve.js'], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 800));
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1280,720'] });
let ok = true; const errors = [];
const A = (c, m) => { if (!c) { ok = false; console.log('  FAIL:', m); } else console.log('  ok  :', m); };
try {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument((q) => localStorage.setItem('desertstorm.settings.v1', JSON.stringify({ quality: q, bloom: true, volume: 0 })), QUALITY);
  await page.setViewport({ width: 1280, height: 720 });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load', timeout: 30000 });
  await page.waitForFunction('window.__game && window.__game.built === true', { timeout: 40000 });

  // build the metro map
  const built = await page.evaluate(async () => {
    const g = window.__game;
    await g.build(null, 'metro');
    const w = g.world, b = g.mapInfo.bounds;
    return {
      builtMap: g._builtMap,
      isMesh: !!(w && w.tri && w.count),
      tris: w.count,
      bounds: { x: +(b.x1 - b.x0).toFixed(1), z: +(b.z1 - b.z0).toFixed(1) },
      spawnsCT: g.mapInfo.spawnsCT.length, spawnsT: g.mapInfo.spawnsT.length,
      sites: Object.keys(g.mapInfo.sites || {}),
    };
  });
  console.log('  built:', JSON.stringify(built));
  A(built.builtMap === 'metro', 'metro map is the active build');
  A(built.isMesh && built.tris > 10000, 'mesh collider built (' + built.tris + ' tris)');
  A(built.bounds.z > 70 && built.bounds.x > 25, 'station bounds look right (' + JSON.stringify(built.bounds) + ')');
  A(built.spawnsCT > 0 && built.spawnsT > 0, 'spawns found on both ends');

  // collider sanity: ground at a spawn is the FLOOR (~0), not the ceiling
  const phys = await page.evaluate(() => {
    const g = window.__game, w = g.world;
    const sp = g.mapInfo.spawnsCT[0];
    const gy = w.groundHeight(sp.x, sp.z, 30);
    // start a 1v1 match and drop the player onto the spawn
    g.startMatch(1, 1, { map: 'metro' });
    g.closeBuy(g.players[0]); g.frozen = false; g._freezeEnd = 0;
    const P = g.players[0].ent;
    P.feet.set(sp.x, gy + 1.0, sp.z); P.vel.set(0, 0, 0); P.yaw = 0;
    // let gravity settle for 1s
    for (let i = 0; i < 60; i++) g.update(1 / 60);
    const settledY = P.feet.y, onG = P.onGround;
    // walk forward (down the platform) for 1s and confirm we move + stay grounded
    const startZ = P.feet.z, startX = P.feet.x;
    P.input.keys.add('KeyW');
    let minY = 99, maxY = -99;
    for (let i = 0; i < 60; i++) { g.update(1 / 60); minY = Math.min(minY, P.feet.y); maxY = Math.max(maxY, P.feet.y); }
    P.input.keys.delete('KeyW');
    const moved = Math.hypot(P.feet.x - startX, P.feet.z - startZ);
    return { gy: +gy.toFixed(2), settledY: +settledY.toFixed(2), onG, moved: +moved.toFixed(2), minY: +minY.toFixed(2), maxY: +maxY.toFixed(2),
             bots: g.enemyMgr.enemies.length, state: g.state };
  });
  console.log('  phys:', JSON.stringify(phys));
  A(phys.gy < 9000, 'groundHeight finds a real standable floor (gy=' + phys.gy + ')');
  A(Math.abs(phys.settledY - phys.gy) < 0.4 && phys.onG, 'player settles on the floor under gravity');
  A(phys.moved > 1.5, 'player can walk along the platform (moved ' + phys.moved + 'm)');
  A(phys.maxY <= phys.gy + 0.6, 'player never pops up through a level while walking');
  A(phys.minY > -3, 'player lands on a real surface — platform or track — never the void (minY=' + phys.minY + ')');
  A(phys.bots >= 1, 'bots spawned on the metro');

  // run the match loop a bit with AI active — should not error
  await page.evaluate(() => { const g = window.__game; for (let i = 0; i < 120; i++) g.update(1 / 60); });

  // first-person screenshot
  await page.evaluate(() => {
    const g = window.__game, e = window.__engine;
    const P = g.players[0].ent; P.pitch = 0; P._updateCamera(0.016);
    document.getElementById('hudv-1').classList.add('full');
    for (let i = 0; i < 4; i++) e.render(g.views());
  });
  await page.screenshot({ path: 'tools/metro_play.png' });
  console.log('  metro_play.png captured');

  A(errors.length === 0, 'no runtime errors');
  errors.slice(0, 8).forEach(e => console.log('   ERR:', e));
  console.log('\n  metro test: ' + (ok && !errors.length ? 'PASSED ✅' : 'FAILED ❌'));
} catch (e) { ok = false; console.error('  crashed:', e.message); }
finally { await browser.close(); server.kill(); process.exit(ok && errors.length === 0 ? 0 : 1); }
