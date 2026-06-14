// Capture the freeze-time visuals: buy menu over the live map, and the
// freeze banner while looking around (player locked in place).
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer';
const PORT = 8092, QUALITY = process.env.QUALITY || 'high';
const server = spawn('node', ['serve.js'], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 800));
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1280,720'] });
try {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument((q) => localStorage.setItem('desertstorm.settings.v1', JSON.stringify({ quality: q, bloom: true, volume: 0, fov: 90 })), QUALITY);
  await page.setViewport({ width: 1280, height: 720 });
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load', timeout: 30000 });
  await page.waitForFunction('window.__game && window.__game.built === true', { timeout: 40000 });

  // round start -> buy menu over the map. Hold the clock far in the future
  // so slow software renders don't drain the (real 10s) buy timer mid-capture.
  await page.evaluate(() => {
    const g = window.__game; g.input.locked = true; g.input.enabled = true;
    g.startGame();
    g._freezeEnd = performance.now() + 30000; g._buyEnd = g._freezeEnd; g.frozen = true;
    g.buyMenu.update();
  });
  for (let i = 0; i < 4; i++) { await new Promise(r => setTimeout(r, 50)); await page.evaluate(() => { const g = window.__game; g._buyEnd = performance.now() + 30000; g.buyMenu.update(); window.__engine.render(); }); }
  await page.screenshot({ path: 'tools/freeze_buymenu.png' });
  console.log('  freeze_buymenu captured');

  // close the buy menu -> frozen, looking around -> freeze banner
  await page.evaluate(() => { const g = window.__game; g.closeBuy(); g._freezeEnd = performance.now() + 30000; g.frozen = true; g.update(1 / 60); });
  for (let i = 0; i < 4; i++) { await new Promise(r => setTimeout(r, 50)); await page.evaluate(() => { const g = window.__game; g._freezeEnd = performance.now() + 30000; g.frozen = true; g.update(1 / 60); window.__engine.render(); }); }
  await page.screenshot({ path: 'tools/freeze_banner.png' });
  console.log('  freeze_banner captured');
} finally { await browser.close(); server.kill(); }
