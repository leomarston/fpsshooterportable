// Full-match flow test: drive a whole competitive match to its conclusion by
// resolving one round at a time, checking halftime side-swap + economy reset,
// the running CT/T scoreboard, and a clean match-over terminal state.
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer';

const PORT = 8092, QUALITY = process.env.QUALITY || 'low';
const server = spawn('node', ['serve.js'], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 800));
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let ok = true; const errors = [];
const assert = (c, m) => { if (!c) { ok = false; console.log('  FAIL:', m); } else console.log('  ok  :', m); };
try {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument((q) => localStorage.setItem('desertstorm.settings.v1', JSON.stringify({ quality: q, bloom: false, volume: 0 })), QUALITY);
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load', timeout: 30000 });
  await page.waitForFunction('window.__game && window.__game.built === true', { timeout: 40000 });

  const res = await page.evaluate(() => {
    const g = window.__game;
    const log = [];
    g.startMatch(1, 2);                         // 1 human + 1 ally vs 2 foes
    const startMoney = g.players[0].money;

    // The human always wins their rounds (wipe enemy team) until the match ends.
    let halftimeMoney = null, swappedSide = null, guard = 0;
    while (g.state !== 'matchover' && guard++ < 40) {
      // ensure we are live
      if (g.state === 'buy') { g.closeBuy(g.players[0]); }
      g.frozen = false; g._freezeEnd = 0;
      const sideThisRound = g._humanSide();
      // human team wins: wipe team 1
      for (const e of g.enemyMgr.enemies) if (e.team === 1) { e.health = 0; e.dead = true; }
      for (let i = 0; i < 80 && g.state === 'playing'; i++) g.update(1 / 60);
      log.push({ round: g.round, side: sideThisRound, state: g.state, wins: g.wins.slice() });
      if (g.state === 'roundend') {
        // jump the countdown to start the next round
        g._roundCountdown = 0; g.update(1 / 60);
        if (g.round === 6 && swappedSide === null) { swappedSide = g._humanSide(); halftimeMoney = g.players[0].money; }
      }
    }
    return {
      finalState: g.state, wins: g.wins.slice(), round: g.round,
      startMoney, halftimeMoney, swappedSide, log,
    };
  });

  console.log('  rounds:');
  for (const r of res.log) console.log(`   R${r.round} (${r.side}) -> ${r.state}  wins ${JSON.stringify(r.wins)}`);
  console.log('  final:', res.finalState, '| wins', JSON.stringify(res.wins), '| reached round', res.round);
  console.log('  startMoney', res.startMoney, '| halftime side', res.swappedSide, '| halftime money', res.halftimeMoney);

  assert(res.finalState === 'matchover', 'match reaches a terminal matchover state');
  assert(res.wins[0] === 6, 'human team clinched at 6 round-wins');
  assert(res.round <= 10, 'match ended within 10 rounds');
  assert(res.swappedSide === 'T', 'human side swapped to T at halftime (round 6)');
  assert(res.halftimeMoney === res.startMoney, 'economy reset to starting money at halftime');

  assert(errors.length === 0, 'no runtime errors');
  if (errors.length) errors.slice(0, 8).forEach(e => console.log('   ERR:', e));
  console.log('\n  matchflow test: ' + (ok && !errors.length ? 'PASSED ✅' : 'FAILED ❌'));
} catch (e) { ok = false; console.error('  crashed:', e.message); }
finally { await browser.close(); server.kill(); process.exit(ok && errors.length === 0 ? 0 : 1); }
