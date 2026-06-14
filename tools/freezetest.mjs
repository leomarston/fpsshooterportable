// Freeze-time test: at round start the player is locked in place (look only),
// can't fire, and enemies are frozen for the full duration; then it goes live.
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer';

const PORT = 8093;
const server = spawn('node', ['serve.js'], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 800));
const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
let ok = true; const errors = [];
const assert = (c, m) => { if (!c) { ok = false; console.log('  FAIL:', m); } else console.log('  ok  :', m); };
try {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => localStorage.setItem('desertstorm.settings.v1', JSON.stringify({ quality: 'low', bloom: false, volume: 0 })));
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load', timeout: 30000 });
  await page.waitForFunction('window.__game && window.__game.built === true', { timeout: 40000 });

  const r = await page.evaluate(() => {
    const g = window.__game;
    g.input.locked = true; g.input.enabled = true;
    g.startGame();
    const stateAtStart = g.state, frozenAtStart = g.frozen, dur = g.freezeDuration;
    g.owned.primary = 'ak47'; g._applyOwned(true); g.weapons.equip('ak47');
    g.closeBuy();                                   // close menu, but still frozen
    const frozenAfterClose = g.frozen, stateAfterClose = g.state;
    // hold forward + fire during freeze
    const before = g.player.feet.clone();
    const magBefore = g.weapons.curAmmo.mag;
    // a bot near the player; record its position to confirm it doesn't move
    const Vec3 = g.player.feet.constructor;
    const e = g.enemyMgr.enemies[0];
    const enemyBefore = e ? e.feet.clone() : null;
    g.input.keys.add('KeyW'); g.input.buttons.left = true;
    for (let i = 0; i < 90; i++) { g.update(1 / 60); g.input.endFrame(); g.input.keys.add('KeyW'); g.input.buttons.left = true; }
    const frozenMoved = g.player.feet.distanceTo(before);
    const firedDuringFreeze = magBefore - g.weapons.curAmmo.mag;
    const enemyMovedFreeze = (e && enemyBefore) ? e.feet.distanceTo(enemyBefore) : 0;

    // force freeze to end -> go live
    g._freezeEnd = performance.now() - 1;
    g.update(1 / 60);
    const frozenAfterEnd = g.frozen;
    // now movement should work
    const before2 = g.player.feet.clone();
    g.input.keys.add('KeyW');
    for (let i = 0; i < 90; i++) { g.update(1 / 60); g.input.endFrame(); g.input.keys.add('KeyW'); }
    const liveMoved = g.player.feet.distanceTo(before2);
    return { stateAtStart, frozenAtStart, dur, frozenAfterClose, stateAfterClose,
      frozenMoved, firedDuringFreeze, enemyMovedFreeze, frozenAfterEnd, liveMoved };
  });

  console.log('  freeze duration:', r.dur + 's');
  console.log('  at round start: state=' + r.stateAtStart, 'frozen=' + r.frozenAtStart);
  console.log('  after close:    state=' + r.stateAfterClose, 'frozen=' + r.frozenAfterClose);
  console.log('  during freeze:  playerMoved=' + r.frozenMoved.toFixed(3), 'shotsFired=' + r.firedDuringFreeze, 'enemyMoved=' + r.enemyMovedFreeze.toFixed(3));
  console.log('  after freeze:   frozen=' + r.frozenAfterEnd, 'playerMoved=' + r.liveMoved.toFixed(2));

  assert(r.dur === 10, 'freeze/buy time is 10 seconds');
  assert(r.stateAtStart === 'buy' && r.frozenAtStart, 'round starts in buy/freeze');
  assert(r.frozenAfterClose && r.stateAfterClose === 'playing', 'still frozen after closing the buy menu');
  assert(r.frozenMoved < 0.05, 'player cannot move during freeze');
  assert(r.firedDuringFreeze === 0, 'player cannot fire during freeze');
  assert(r.enemyMovedFreeze < 0.05, 'enemies are frozen during freeze');
  assert(!r.frozenAfterEnd, 'freeze ends after the timer');
  assert(r.liveMoved > 1.0, 'player can move once live');
  assert(errors.length === 0, 'no runtime errors');
  if (errors.length) errors.forEach(e => console.log('   ERR:', e));
  console.log('\n  freeze test: ' + (ok ? 'PASSED ✅' : 'FAILED ❌'));
} catch (e) { ok = false; console.error('  crashed:', e.message); }
finally { await browser.close(); server.kill(); process.exit(ok ? 0 : 1); }
