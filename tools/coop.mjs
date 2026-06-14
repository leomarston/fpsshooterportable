// Co-op / split-screen test: verifies single-player still runs, two-player
// split renders two viewports, and the run ends only when BOTH players die.
// Captures a split-screen screenshot.
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer';

const PORT = 8091, QUALITY = process.env.QUALITY || 'medium';
const server = spawn('node', ['serve.js'], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 800));
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1280,720'] });
let ok = true; const errors = [];
const assert = (c, m) => { if (!c) { ok = false; console.log('  FAIL:', m); } else console.log('  ok  :', m); };
try {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument((q) => localStorage.setItem('desertstorm.settings.v1', JSON.stringify({ quality: q, bloom: true, volume: 0 })), QUALITY);
  await page.setViewport({ width: 1280, height: 720 });
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load', timeout: 30000 });
  await page.waitForFunction('window.__game && window.__game.built === true', { timeout: 40000 });

  // ---- single player runs ----
  const single = await page.evaluate(() => {
    const g = window.__game;
    g.startGame(1);
    const st0 = g.state, n0 = g.players.length;
    g.closeBuy(g.players[0]); g.frozen = false; g._freezeEnd = 0;
    const P = g.players[0];
    P.owned.primary = 'ak47'; g._applyOwned(P, true); P.weapons.equip('ak47');
    P.input.enabled = true; P.input.locked = true;
    for (let i = 0; i < 150; i++) { P.input.keys.add('KeyW'); P.input.buttons.left = (i % 20) < 12; g.update(1 / 60); }
    P.input.keys.clear(); P.input.buttons.left = false;
    return { st0, n0, state: g.state, hp: Math.round(P.ent.health), enemies: g.enemyMgr.enemies.length, weapon: P.weapons.current };
  });
  console.log('\n  single player:');
  console.log('   startup state', single.st0, '| players', single.n0, '| after sim:', single.state, 'hp', single.hp, 'enemies', single.enemies);
  assert(single.n0 === 1, '1 player created');
  assert(single.st0 === 'buy', 'starts in buy/freeze');
  assert(single.enemies >= 4, 'wave spawned');
  assert(['playing', 'roundend', 'dead'].includes(single.state), 'valid single-player state');

  // ---- two-player split ----
  const split = await page.evaluate(() => {
    const g = window.__game;
    g.quitToMenu();
    // lay out the two halves like main.js does
    const set = (id, c) => { const el = document.getElementById(id); el.classList.remove('full', 'split-top', 'split-bottom', 'hidden'); el.classList.add(c); };
    set('hudv-1', 'split-top'); set('hudv-2', 'split-bottom');
    g.startGame(2);
    g.closeBuy(g.players[0]); g.closeBuy(g.players[1]); g.frozen = false; g._freezeEnd = 0;
    for (const P of g.players) { P.owned.primary = 'ak47'; g._applyOwned(P, true); P.weapons.equip('ak47'); }
    // place players apart and step a little so the two cameras differ
    g.players[0].ent.feet.set(0, g.world.groundHeight(0, 30, 30), 30); g.players[0].ent.yaw = 0; g.players[0].ent._updateCamera(0.016);
    g.players[1].ent.feet.set(-30, g.world.groundHeight(-30, 20, 30), 20); g.players[1].ent.yaw = 1.2; g.players[1].ent._updateCamera(0.016);
    for (let i = 0; i < 4; i++) window.__engine.render(g.views());
    return { players: g.players.length, split: g.engine.split, viewCount: g.views().length };
  });
  console.log('\n  two-player split:');
  console.log('   players', split.players, '| engine.split', split.split, '| views', split.viewCount);
  assert(split.players === 2, '2 players created');
  assert(split.split === true, 'engine in split mode');
  assert(split.viewCount === 2, 'two render views');
  for (let i = 0; i < 3; i++) { await new Promise(r => setTimeout(r, 60)); await page.evaluate(() => window.__engine.render(window.__game.views())); }
  await page.screenshot({ path: 'tools/coop_split.png' });
  console.log('   coop_split.png captured');

  // ---- co-op death: game over only when BOTH down ----
  const death = await page.evaluate(() => {
    const g = window.__game; g.frozen = false; g._freezeEnd = 0;
    g.players[0].ent.health = 0; g.players[0].ent.alive = false;
    g.update(1 / 60); g.update(1 / 60);
    const afterOne = g.state;
    g.players[1].ent.health = 0; g.players[1].ent.alive = false;
    for (let i = 0; i < 200; i++) g.update(1 / 60);
    return { afterOne, afterBoth: g.state };
  });
  console.log('\n  co-op death:');
  console.log('   after P1 down:', death.afterOne, '| after both down:', death.afterBoth);
  assert(death.afterOne === 'playing', 'run continues while one player is alive');
  assert(death.afterBoth === 'dead', 'run ends when both players are down');

  assert(errors.length === 0, 'no runtime errors');
  if (errors.length) errors.slice(0, 10).forEach(e => console.log('   ERR:', e));
  console.log('\n  coop test: ' + (ok && !errors.length ? 'PASSED ✅' : 'FAILED ❌'));
} catch (e) { ok = false; console.error('  crashed:', e.message); errors.forEach(x => console.log('   -', x)); }
finally { await browser.close(); server.kill(); process.exit(ok && errors.length === 0 ? 0 : 1); }
