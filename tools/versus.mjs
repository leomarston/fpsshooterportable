// Versus-mode test: two humans on OPPOSING teams. Verifies team assignment,
// per-side spawns, bot fill per team, friendly-fire-off within a team but
// cross-team human-vs-human damage, and a round resolving to the right team.
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer';

const PORT = 8098, QUALITY = process.env.QUALITY || 'low';
const server = spawn('node', ['serve.js'], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 800));
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let ok = true; const errors = [];
const A = (c, m) => { if (!c) { ok = false; console.log('  FAIL:', m); } else console.log('  ok  :', m); };
try {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument((q) => localStorage.setItem('desertstorm.settings.v1', JSON.stringify({ quality: q, bloom: false, volume: 0 })), QUALITY);
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load', timeout: 30000 });
  await page.waitForFunction('window.__game && window.__game.built === true', { timeout: 40000 });
  const r = await page.evaluate(() => {
    const g = window.__game;
    g.startMatch(2, 2, { versus: true });
    const t0 = g.players[0].ent.team, t1 = g.players[1].ent.team;
    const p0z = g.players[0].ent.feet.z, p1z = g.players[1].ent.feet.z;
    const bots0 = g.enemyMgr.enemies.filter(e => e.team === 0).length;
    const bots1 = g.enemyMgr.enemies.filter(e => e.team === 1).length;
    g.closeBuy(g.players[0]); g.closeBuy(g.players[1]); g.frozen = false; g._freezeEnd = 0;
    const A0 = g.players[0].ent, B = g.players[1].ent;
    const ally = g.enemyMgr.enemies.find(e => e.team === 0);
    A0.feet.set(0, g.world.groundHeight(0, -57, 30), -57); A0.yaw = Math.PI; A0._updateCamera(0.016);
    ally.feet.set(0, g.world.groundHeight(0, -55, 30), -55);
    const origin = A0.eyePos.clone(), dir = A0.vel.clone().set(0, 0, 1);
    const wpn = { name: 'T', damage: 10, range: 120, headshotMult: 1 };
    const allyBefore = ally.health; g.combat.resolveShot(origin, dir, wpn, true, false, A0);
    const allySafe = ally.health === allyBefore;
    ally.feet.set(0, 0, 40); B.feet.set(0, g.world.groundHeight(0, -55, 30), -55); B._updateCamera(0.016);
    const bBefore = B.health; g.combat.resolveShot(origin, dir, wpn, true, false, A0);
    const oppHurt = B.health < bBefore;
    for (const e of g.enemyMgr.enemies) if (e.team === 1) { e.health = 0; e.dead = true; }
    B.health = 0; B.alive = false;
    for (let i = 0; i < 90; i++) g.update(1 / 60);
    return { versus: g.versus, t0, t1, p0z: +p0z.toFixed(0), p1z: +p1z.toFixed(0), bots0, bots1, allySafe, oppHurt, state: g.state, wins: g.wins.slice() };
  });
  console.log('  ' + JSON.stringify(r));
  A(r.versus === true, 'versus flag set');
  A(r.t0 === 0 && r.t1 === 1, 'players placed on opposing teams');
  A(r.p0z > 30 && r.p1z < -30, 'P1 spawns CT side, P2 spawns T side');
  A(r.bots0 === 1 && r.bots1 === 1, '2v2 versus = 1 bot per team');
  A(r.allySafe, 'friendly fire off within a team');
  A(r.oppHurt, 'cross-team human-vs-human damage works');
  A(r.state === 'roundend' && r.wins[0] === 1, 'team0 wins the round after wiping team1');
  A(errors.length === 0, 'no runtime errors');
  errors.slice(0, 5).forEach(e => console.log('   ERR:', e));
  console.log('\n  versus test: ' + (ok && !errors.length ? 'PASSED ✅' : 'FAILED ❌'));
  process.exit(ok && !errors.length ? 0 : 1);
} catch (e) { console.error('  crashed:', e.message); process.exit(1); }
finally { await browser.close(); server.kill(); }
