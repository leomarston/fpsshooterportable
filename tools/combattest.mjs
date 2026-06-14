// Deterministic combat test (two phases, fixed-step simulation):
//   A) player fires on a bot at 10m  -> bot takes damage / dies, kill scored
//   B) a fresh bot fires on a passive player -> player takes damage
// Headless rAF is throttled, so we drive game.update() directly.
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer';

const PORT = 8096;
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

  // ---- Phase A: player kills a bot ----
  const A = await page.evaluate(async () => {
    const { WEAPONS } = await import('/src/entities/WeaponData.js');
    const g = window.__game;
    const Vec3 = g.player.feet.constructor;
    g.input.locked = true; g.input.enabled = true;
    g.startGame(); g.enemyMgr.clearAll();
    const px = 0, pz = 40, gy = g.world.groundHeight(px, pz, 30);
    g.player.feet.set(px, gy, pz); g.player.vel.set(0, 0, 0);
    g.player.setLookFrom({ x: 0, y: gy + 1.6, z: 20 }); g.player._updateCamera(0.016);
    const ex = 0, ez = 30, egy = g.world.groundHeight(ex, ez, 30);
    const los = g.world.lineOfSight(new Vec3(px, gy + 1.6, pz), new Vec3(ex, egy + 1.5, ez));
    // harmless bot (never returns fire) to isolate the player->bot direction
    const cfg = { health: 80, accuracy: 0.0, reaction: 999, moveSpeed: 0, turnSpeed: 8, viewDist: 60, hearing: 30, memory: 4, strafe: 0, damageMult: 0, spread: 0.2, preferredRange: 12, weapon: WEAPONS.pistol, color: 0x553333 };
    const e = g.enemyMgr.spawn(new Vec3(ex, egy, ez), cfg);
    const startHp = e.health;
    for (let i = 0; i < 180; i++) { g.input.buttons.left = true; g.update(1 / 60); g.input.endFrame(); }
    const W = g.weapons;
    return { los, startHp, enemyDead: e.dead, enemyHp: Math.round(e.health), kills: g.totalKills,
      mag: W.curAmmo && W.curAmmo.mag, weapon: W.current, swap: +W.swapTimer.toFixed(2), cd: +W.cooldown.toFixed(3),
      reloading: W.reloading, alive: g.player.alive, state: g.state, efeet: [e.feet.x.toFixed(2), e.feet.z.toFixed(2)] };
  });
  console.log('\n  Phase A — player vs bot:');
  console.log('   LOS', A.los, '| bot', A.enemyHp + '/' + A.startHp, 'dead=' + A.enemyDead, '| kills', A.kills);
  console.log('   weapon', A.weapon, 'mag', A.mag, 'swap', A.swap, 'cd', A.cd, 'reloading', A.reloading, 'pAlive', A.alive, 'state', A.state, 'eFeet', A.efeet);
  assert(A.los, 'duel A has line of sight');
  assert(A.enemyDead, 'player killed the bot');
  assert(A.kills >= 1, 'kill was scored');

  // ---- Phase B: a bot damages a passive player ----
  const B = await page.evaluate(async () => {
    const { WEAPONS } = await import('/src/entities/WeaponData.js');
    const g = window.__game;
    const Vec3 = g.player.feet.constructor;
    // reset to a fresh round/state
    g.round = 0; g.nextRound(); g.enemyMgr.clearAll();
    const px = 0, pz = 40, gy = g.world.groundHeight(px, pz, 30);
    g.player.reset(new Vec3(px, gy, pz)); g.player.armor = 0; // test raw HP damage
    g.player.setLookFrom({ x: 0, y: gy + 1.6, z: 20 }); g.player._updateCamera(0.016);
    g.input.buttons.left = false;                       // player does NOT shoot
    const ex = 0, ez = 30, egy = g.world.groundHeight(ex, ez, 30);
    const cfg = { health: 400, accuracy: 0.97, reaction: 0.1, moveSpeed: 0.1, turnSpeed: 10, viewDist: 60, hearing: 30, memory: 4, strafe: 0, damageMult: 1.2, spread: 0.01, preferredRange: 12, weapon: WEAPONS.ar47, color: 0x335533 };
    const e = g.enemyMgr.spawn(new Vec3(ex, egy, ez), cfg);
    e.aimYaw = Math.atan2(-(px - ex), -(pz - ez));      // face the player up front
    const startHp = g.player.health;
    let everSaw = false;
    for (let i = 0; i < 240; i++) { g.update(1 / 60); g.input.endFrame(); if (e.canSee) everSaw = true; if (!g.player.alive) break; }
    return { startHp, playerHp: Math.round(g.player.health), alive: g.player.alive, everSaw, eState: e.state, eMag: e.mag };
  });
  console.log('\n  Phase B — bot vs player:');
  console.log('   player HP', B.playerHp + '/' + B.startHp, 'alive=' + B.alive, '| bot saw player=' + B.everSaw, 'state=' + B.eState, 'mag=' + B.eMag);
  assert(B.everSaw, 'bot perceived the player');
  assert(B.playerHp < B.startHp, 'bot damaged the player');

  assert(errors.length === 0, 'no runtime errors');
  if (errors.length) errors.forEach(e => console.log('   ERR:', e));
  console.log('\n  combat test: ' + (ok ? 'PASSED ✅' : 'FAILED ❌'));
} catch (e) {
  ok = false; console.error('  crashed:', e.message); errors.forEach(x => console.log('   -', x));
} finally {
  await browser.close(); server.kill();
  process.exit(ok ? 0 : 1);
}
