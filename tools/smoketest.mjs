// Headless browser smoke test: boots the game, runs live AI + combat for
// a few seconds with software WebGL, and fails on any console/page error.
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer';

const PORT = 8099;
const server = spawn('node', ['serve.js'], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 800));

const errors = [];
let browser;
try {
  browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader',
           '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1280,720'],
  });
  const page = await browser.newPage();
  // Low quality (no GTAO/bloom) keeps the software-GL test fast & reliable;
  // mute audio. The showcase tool exercises the high-quality path.
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('desertstorm.settings.v1', JSON.stringify({ quality: 'low', bloom: false, volume: 0 }));
  });
  await page.setViewport({ width: 1280, height: 720 });
  page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('requestfailed', r => errors.push('requestfailed: ' + r.url() + ' ' + r.failure()?.errorText));

  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load', timeout: 30000 });

  // Wait for the async build to finish.
  await page.waitForFunction('window.__game && window.__game.built === true', { timeout: 40000 });

  // Force a "locked" session (no real pointer lock in headless), start a
  // round, and auto-fire so the full combat path runs.
  const start = await page.evaluate(() => {
    const g = window.__game;
    g.input.locked = true; g.input.enabled = true;
    g.startGame();
    g.input.buttons.left = true;          // hold fire
    // nudge the view so shots sweep around
    return { round: g.round, enemies: g.enemyMgr.enemies.length, weapon: g.weapons.current };
  });

  // Let it run ~3.5s of real frames (rAF drives the loop).
  for (let i = 0; i < 14; i++) {
    await new Promise(r => setTimeout(r, 250));
    await page.evaluate(() => { window.__game.player.yaw += 0.25; }); // sweep aim
  }

  const result = await page.evaluate(() => {
    const g = window.__game;
    // Render the WORLD scene directly to measure its real draw calls
    // (renderer.info otherwise reflects only the last (viewmodel) pass).
    g.engine.renderer.render(g.engine.scene, g.engine.camera);
    const worldCalls = g.engine.renderer.info.render.calls;
    const worldTris = g.engine.renderer.info.render.triangles;
    let meshCount = 0; g.engine.scene.traverse(o => { if (o.isMesh) meshCount++; });
    // Sample the canvas to confirm it isn't a flat/blank frame.
    let variance = 0;
    try {
      const c = document.createElement('canvas'); c.width = 64; c.height = 36;
      const ctx = c.getContext('2d');
      ctx.drawImage(document.getElementById('viewport'), 0, 0, 64, 36);
      const d = ctx.getImageData(0, 0, 64, 36).data;
      let sum = 0, sum2 = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) { const lum = (d[i] + d[i + 1] + d[i + 2]) / 3; sum += lum; sum2 += lum * lum; n++; }
      const mean = sum / n; variance = Math.round(sum2 / n - mean * mean);
    } catch (e) { variance = -1; }
    return {
      built: g.built, state: g.state, round: g.round,
      spawned: g.enemyMgr.enemies.length, alive: g.enemyMgr.aliveCount,
      playerHealth: Math.round(g.player.health),
      fired: g.weapons.curAmmo ? g.weapons.curAmmo.mag : null,
      kills: g.kills, worldCalls, worldTris, variance, meshCount,
      sceneChildren: g.engine.scene.children.length,
    };
  });

  // Re-enter the round (manual world render above left the canvas mid-frame)
  // then grab a screenshot for visual proof.
  await new Promise(r => setTimeout(r, 200));
  await page.screenshot({ path: 'tools/shot.png' });

  console.log('  build:        ', result.built);
  console.log('  state:        ', result.state);
  console.log('  round:        ', result.round);
  console.log('  enemies:      ', result.alive + '/' + result.spawned, 'alive');
  console.log('  player HP:    ', result.playerHealth);
  console.log('  mag after fire:', result.fired);
  console.log('  kills:        ', result.kills);
  console.log('  scene children:', result.sceneChildren);
  console.log('  total meshes: ', result.meshCount);
  console.log('  visible draws:', result.worldCalls, '(' + result.worldTris + ' tris in view)');
  console.log('  frame variance:', result.variance);

  let ok = true;
  const assert = (c, m) => { if (!c) { ok = false; console.log('  FAIL:', m); } };
  assert(result.built, 'game built');
  assert(result.spawned >= 4, 'wave spawned (>=4)');
  assert(result.state === 'playing' || result.state === 'roundend', 'in active state');
  assert(result.meshCount > 150, 'world geometry built (' + result.meshCount + ' meshes)');
  assert(result.variance > 30, 'frame has visual detail (variance ' + result.variance + ')');
  assert(errors.length === 0, 'no runtime errors');

  if (errors.length) { console.log('\n  ERRORS:'); errors.slice(0, 20).forEach(e => console.log('   -', e)); }
  console.log('\n  smoke test: ' + (ok && !errors.length ? 'PASSED ✅' : 'FAILED ❌'));
  await browser.close();
  server.kill();
  process.exit(ok && errors.length === 0 ? 0 : 1);
} catch (e) {
  console.error('  smoke test crashed:', e.message);
  errors.forEach(x => console.log('   -', x));
  try { await browser?.close(); } catch {}
  server.kill();
  process.exit(1);
}
