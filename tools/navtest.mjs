// Connectivity test: builds the map headless and A*-pathfinds between every
// key dust2 area, ensuring nothing is sealed off and routes make sense.
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer';

const PORT = 8095;
const server = spawn('node', ['serve.js'], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 800));

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
let ok = true;
try {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => localStorage.setItem('desertstorm.settings.v1', JSON.stringify({ quality: 'low', bloom: false, volume: 0 })));
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load', timeout: 30000 });
  await page.waitForFunction('window.__game && window.__game.built === true', { timeout: 40000 });

  const res = await page.evaluate(() => {
    const g = window.__game; const Vec3 = g.player.feet.constructor;
    // open-ground points (kept clear of props) representing each area
    const pts = {
      tSpawn: [0, -58], tMid: [0, -30], ctMid: [0, 6], long: [36, -25],
      longLow: [38, 4], pit: [49, 11], tunnels: [-35, -22], bSite: [-34, 30],
      aSite: [40, 28], ctSpawn: [10, 46],
    };
    const v = (p) => { const gy = g.world.groundHeight(p[0], p[1], 30); return new Vec3(p[0], gy, p[1]); };
    // every area must be on a walkable nav node
    const walkable = {};
    for (const k in pts) { const n = g.nav.nearest(v(pts[k])); walkable[k] = !!(n && n.walkable); }
    // routes that must exist
    const routes = [
      ['tSpawn', 'aSite'], ['tSpawn', 'bSite'], ['tSpawn', 'ctSpawn'],
      ['tSpawn', 'long'], ['tSpawn', 'tunnels'], ['ctSpawn', 'aSite'],
      ['ctSpawn', 'bSite'], ['long', 'pit'], ['tMid', 'ctMid'], ['aSite', 'bSite'],
      ['long', 'aSite'], ['longLow', 'aSite'], ['tunnels', 'bSite'], ['ctMid', 'ctSpawn'],
    ];
    const conn = {};
    for (const [a, b] of routes) {
      const path = g.nav.findPath(v(pts[a]), v(pts[b]));
      conn[a + '->' + b] = path ? path.length : 0;
    }
    let walkableCount = 0; for (const n of g.nav.nodes) if (n.walkable) walkableCount++;
    return { walkable, conn, walkableCount, spawnsT: g.mapInfo.spawnsT.length, spawnsCT: g.mapInfo.spawnsCT.length };
  });

  const assert = (c, m) => { if (!c) { ok = false; console.log('  FAIL:', m); } else console.log('  ok  :', m); };
  console.log('  walkable nav cells:', res.walkableCount);
  for (const k in res.walkable) assert(res.walkable[k], `area "${k}" is on walkable ground`);
  for (const r in res.conn) assert(res.conn[r] > 0, `route ${r} connected (${res.conn[r]} wp)`);

  console.log('\n  nav/connectivity test: ' + (ok ? 'PASSED ✅' : 'FAILED ❌'));
} catch (e) { ok = false; console.error('  crashed:', e.message); }
finally { await browser.close(); server.kill(); process.exit(ok ? 0 : 1); }
