// Showcase screenshots from several vantage points at a chosen quality.
//   QUALITY=high node tools/shoot.mjs
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer';

const PORT = 8097;
const QUALITY = process.env.QUALITY || 'high';
const server = spawn('node', ['serve.js'], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 800));

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader',
         '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1600,900'],
});
try {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument((q) => {
    localStorage.setItem('desertstorm.settings.v1', JSON.stringify({ quality: q, bloom: true, volume: 0, fov: 95 }));
  }, QUALITY);
  await page.setViewport({ width: 1600, height: 900 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load', timeout: 30000 });
  await page.waitForFunction('window.__game && window.__game.built === true', { timeout: 40000 });

  await page.evaluate(() => { const g = window.__game; g.input.locked = true; g.input.enabled = true; g.startGame(); g.closeBuy(); g.input.buttons.left = false; });
  await new Promise(r => setTimeout(r, 400));

  const spots = [
    { name: 'topdown', topdown: true },
    { name: 'mid',    x: 0,   z: 26, tx: 0,  tz: -10, pitch: 0.02 },
    { name: 'asite',  x: 22,  z: 28, tx: 33, tz: 40,  pitch: -0.05 },
    { name: 'bsite',  x: -20, z: 30, tx: -30, tz: 36, pitch: -0.05 },
    { name: 'longA',  x: 33,  z: -6, tx: 33, tz: -30, pitch: 0.0 },
    { name: 'tspawn', x: 0,   z: -44, tx: 0, tz: -10, pitch: -0.02 },
  ];

  for (const s of spots) {
    await page.evaluate((s) => {
      const g = window.__game;
      g.state = 'paused';   // stop the rAF loop from overwriting our camera
      if (g._fog === undefined) g._fog = g.engine.scene.fog;
      if (s.topdown) {
        const cam = g.engine.camera;
        cam.position.set(-4, 125, -4);
        cam.rotation.set(-Math.PI / 2, 0, 0, 'YXZ');
        cam.updateMatrixWorld(true);
        g.engine.scene.fog = null;            // no haze for the overview
        if (g.weapons.currentModel) g.weapons.currentModel.group.visible = false;
        g.hud.hide();
        return;
      }
      g.engine.scene.fog = g._fog;
      if (g.weapons.currentModel) g.weapons.currentModel.group.visible = true;
      const gy = g.world.groundHeight(s.x, s.z, 30);
      g.player.feet.set(s.x, gy, s.z);
      g.player.vel.set(0, 0, 0);
      g.player.setLookFrom({ x: s.tx, y: gy + 1.6, z: s.tz });
      g.player.pitch = s.pitch;
      g.player._updateCamera(0.016);
      g.audio.setListener(g.engine.camera);
      g.hud.show();
      // drive the HUD so the screenshot reflects a live layout
      g.hud.setHealth(g.player.health); g.hud.setArmor(g.player.armor);
      g.hud.setKills(7); g.hud.setEnemies(g.enemyMgr.aliveCount); g.hud.setScore(2150); g.hud.setStreak(3);
      g.hud.setTimer(48); g.hud.setRound(g.round);
      g.hud.updateRadar(g.player, g.enemyMgr.enemies, g.mapInfo.sites);
      g.hud.setLocation(g._zoneName(g.player.feet));
    }, s);
    // let GTAO/temporal settle
    for (let i = 0; i < 4; i++) { await new Promise(r => setTimeout(r, 50)); await page.evaluate(() => window.__engine.render()); }
    await page.screenshot({ path: `tools/shot_${s.name}.png` });
    console.log('  shot:', s.name);
  }
  if (errors.length) { console.log('  ERRORS:'); errors.forEach(e => console.log('   -', e)); }
  console.log('  quality:', QUALITY, '| done');
} finally {
  await browser.close();
  server.kill();
}
