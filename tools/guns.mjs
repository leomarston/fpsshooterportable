// Weapon + buy-menu showcase: poses each gun model for inspection and
// captures the buy menu. Verifies the guns read as sculpted, not blocky.
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer';

const PORT = 8094;
const QUALITY = process.env.QUALITY || 'high';
const server = spawn('node', ['serve.js'], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 800));

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1280,720'],
});
try {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument((q) => localStorage.setItem('desertstorm.settings.v1', JSON.stringify({ quality: q, bloom: true, volume: 0, fov: 90 })), QUALITY);
  await page.setViewport({ width: 1280, height: 720 });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load', timeout: 30000 });
  await page.waitForFunction('window.__game && window.__game.built === true', { timeout: 40000 });

  await page.evaluate(() => {
    const g = window.__game;
    g.input.locked = true; g.input.enabled = true;
    g.startGame(); g.closeBuy();
    g.state = 'paused';                          // freeze so our poses stick
    // stand somewhere lit, look at a wall for a clean-ish backdrop
    const gy = g.world.groundHeight(0, 36, 30);
    g.player.feet.set(0, gy, 36); g.player.setLookFrom({ x: 0, y: gy + 1.6, z: 50 });
    g.player._updateCamera(0.016);
    g.hud.hide();
  });

  const guns = ['glock', 'deagle', 'autopistol', 'fiveseven', 'p250', 'ak47', 'm4', 'awp', 'shotgun', 'mp5', 'knife'];
  for (const key of guns) {
    await page.evaluate((key) => {
      const g = window.__game;
      g.weapons.give([key, 'glock', 'knife'], true);
      g.weapons.equip(key);
      const grp = g.weapons.currentModel.group;
      grp.position.set(0.02, -0.03, -0.5);       // centred inspect pose
      grp.rotation.set(0.12, 0.7, 0.04);
      grp.scale.set(1.5, 1.5, 1.5);
      grp.visible = true;
    }, key);
    for (let i = 0; i < 4; i++) { await new Promise(r => setTimeout(r, 50)); await page.evaluate(() => window.__engine.render()); }
    await page.screenshot({ path: `tools/gun_${key}.png` });
    console.log('  gun:', key);
  }

  // buy menu
  await page.evaluate(() => { const g = window.__game; g.hud.show(); g.buyMenu.open(g); });
  await new Promise(r => setTimeout(r, 120));
  await page.evaluate(() => window.__engine.render());
  await page.screenshot({ path: 'tools/buymenu.png' });
  console.log('  buymenu captured');
  if (errors.length) { console.log('  ERRORS:'); errors.forEach(e => console.log('   -', e)); }
} finally {
  await browser.close(); server.kill();
}
