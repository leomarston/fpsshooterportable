// Competitive-match / split-screen test. Verifies the team-based round logic:
//  - 1v1 starts in buy, with one enemy bot on the opposing team
//  - friendly fire is OFF (an ally is never the victim; the foe is)
//  - a round is won by wiping the other team (not by a single human dying)
//  - two-player split renders two viewports (captures a screenshot)
//  - half/side helper swaps sides at halftime
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

  // ---- 1v1: structure + a round won by wiping the enemy team ----
  const duel = await page.evaluate(() => {
    const g = window.__game;
    g.startMatch(1, 1);
    const st0 = g.state, n0 = g.players.length;
    const allies = g.enemyMgr.enemies.filter(e => e.team === 0).length;
    const foes = g.enemyMgr.enemies.filter(e => e.team === 1).length;
    g.closeBuy(g.players[0]); g.frozen = false; g._freezeEnd = 0;
    // wipe the enemy team
    for (const e of g.enemyMgr.enemies) if (e.team === 1) { e.health = 0; e.dead = true; }
    for (let i = 0; i < 90; i++) g.update(1 / 60);
    return { st0, n0, teamSize: g.teamSize, allies, foes, state: g.state, wins: g.wins.slice(), round: g.round };
  });
  console.log('\n  1v1 duel:');
  console.log('   startup', duel.st0, '| players', duel.n0, '| allies', duel.allies, '| foes', duel.foes, '| after wipe:', duel.state, '| wins', JSON.stringify(duel.wins));
  assert(duel.n0 === 1, '1 human created');
  assert(duel.teamSize === 1, 'team size = 1');
  assert(duel.st0 === 'buy', 'match opens in buy/freeze');
  assert(duel.allies === 0 && duel.foes === 1, '1v1 has 0 allies + 1 enemy bot');
  assert(duel.state === 'roundend', 'round ends when enemy team is wiped');
  assert(duel.wins[0] === 1, 'human team scored the round (wins[0]=1)');

  // ---- friendly fire OFF: ally never the victim, foe is ----
  const ff = await page.evaluate(() => {
    const g = window.__game;
    g.startMatch(1, 5);                       // 4 allies + 5 enemies
    g.closeBuy(g.players[0]); g.frozen = false; g._freezeEnd = 0;
    const ent = g.players[0].ent;
    const ally = g.enemyMgr.enemies.find(e => e.team === 0);
    const foe = g.enemyMgr.enemies.find(e => e.team === 1);
    // open ground near T spawn, facing +z; ally closer, foe farther
    ent.feet.set(0, g.world.groundHeight(0, -57, 30), -57); ent.yaw = Math.PI; ent._updateCamera(0.016);
    ally.feet.set(0, g.world.groundHeight(0, -55.5, 30), -55.5);
    foe.feet.set(0, g.world.groundHeight(0, -55, 30), -55);
    const origin = ent.eyePos.clone();
    const dir = ent.vel.clone().set(0, 0, 1);  // +z forward
    const wpn = { name: 'TEST', damage: 10, range: 120, headshotMult: 1 };
    const aBefore = ally.health, fBefore = foe.health;
    const res = g.combat.resolveShot(origin, dir, wpn, true, false, ent);
    return {
      counts: { allies: g.enemyMgr.enemies.filter(e => e.team === 0).length, foes: g.enemyMgr.enemies.filter(e => e.team === 1).length },
      allyUnhurt: ally.health === aBefore, foeHurt: foe.health < fBefore,
      victimTeam: res && res.victim ? res.victim.team : null,
    };
  });
  console.log('\n  friendly fire:');
  console.log('   allies', ff.counts.allies, '| foes', ff.counts.foes, '| allyUnhurt', ff.allyUnhurt, '| foeHurt', ff.foeHurt, '| victimTeam', ff.victimTeam);
  assert(ff.counts.allies === 4 && ff.counts.foes === 5, '5v5 from 1 human = 4 allies + 5 foes');
  assert(ff.allyUnhurt, 'shooting through a teammate does not hurt them');
  assert(ff.foeHurt && ff.victimTeam === 1, 'the opposing-team bot takes the hit');

  // ---- a single human dying does NOT lose the round while allies live ----
  const teamRound = await page.evaluate(() => {
    const g = window.__game;
    g.startMatch(1, 2);                        // 1 human + 1 ally vs 2 foes
    g.closeBuy(g.players[0]); g.frozen = false; g._freezeEnd = 0;
    const ent = g.players[0].ent; ent.health = 0; ent.alive = false;
    for (let i = 0; i < 30; i++) g.update(1 / 60);
    const afterHuman = g.state;
    const ally = g.enemyMgr.enemies.find(e => e.team === 0);
    ally.health = 0; ally.dead = true;        // now team 0 is wiped
    for (let i = 0; i < 90; i++) g.update(1 / 60);
    return { afterHuman, afterTeam: g.state, wins: g.wins.slice() };
  });
  console.log('\n  team rounds:');
  console.log('   after human down:', teamRound.afterHuman, '| after team wiped:', teamRound.afterTeam, '| wins', JSON.stringify(teamRound.wins));
  assert(teamRound.afterHuman === 'playing', 'round continues while an ally bot is alive');
  assert(teamRound.afterTeam === 'roundend', 'round ends once the whole team is wiped');
  assert(teamRound.wins[1] === 1, 'enemy team scored that round (wins[1]=1)');

  // ---- half / side swap helper ----
  const sides = await page.evaluate(() => {
    const g = window.__game; g.startMatch(1, 1);
    const r1 = g.round, firstHalfSide = g._humanSide();
    g.round = 6; const secondHalfSide = g._humanSide(); g.round = r1;
    return { firstHalfSide, secondHalfSide };
  });
  console.log('\n  sides:', JSON.stringify(sides));
  assert(sides.firstHalfSide === 'CT', 'human team starts CT in the first half');
  assert(sides.secondHalfSide === 'T', 'human team plays T after halftime');

  // ---- two-player split renders two viewports ----
  const split = await page.evaluate(() => {
    const g = window.__game; g.quitToMenu();
    const set = (id, c) => { const el = document.getElementById(id); el.classList.remove('full', 'split-top', 'split-bottom', 'hidden'); el.classList.add(c); };
    set('hudv-1', 'split-top'); set('hudv-2', 'split-bottom');
    g.startMatch(2, 2);
    g.closeBuy(g.players[0]); g.closeBuy(g.players[1]); g.frozen = false; g._freezeEnd = 0;
    g.players[0].ent.feet.set(0, g.world.groundHeight(0, 30, 30), 30); g.players[0].ent.yaw = 0; g.players[0].ent._updateCamera(0.016);
    g.players[1].ent.feet.set(-30, g.world.groundHeight(-30, 20, 30), 20); g.players[1].ent.yaw = 1.2; g.players[1].ent._updateCamera(0.016);
    for (let i = 0; i < 4; i++) window.__engine.render(g.views());
    return { players: g.players.length, split: g.engine.split, viewCount: g.views().length, foes: g.enemyMgr.enemies.filter(e => e.team === 1).length };
  });
  console.log('\n  two-player split:');
  console.log('   players', split.players, '| engine.split', split.split, '| views', split.viewCount, '| foes', split.foes);
  assert(split.players === 2, '2 humans created');
  assert(split.split === true, 'engine in split mode');
  assert(split.viewCount === 2, 'two render views');
  assert(split.foes === 2, '2v2 has 2 enemy bots');
  for (let i = 0; i < 3; i++) { await new Promise(r => setTimeout(r, 60)); await page.evaluate(() => window.__engine.render(window.__game.views())); }
  await page.screenshot({ path: 'tools/coop_split.png' });
  console.log('   coop_split.png captured');

  assert(errors.length === 0, 'no runtime errors');
  if (errors.length) errors.slice(0, 10).forEach(e => console.log('   ERR:', e));
  console.log('\n  coop test: ' + (ok && !errors.length ? 'PASSED ✅' : 'FAILED ❌'));
} catch (e) { ok = false; console.error('  crashed:', e.message); errors.forEach(x => console.log('   -', x)); }
finally { await browser.close(); server.kill(); process.exit(ok && errors.length === 0 ? 0 : 1); }
