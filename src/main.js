/**
 * main — bootstrap. Creates engine/audio/menus, builds per-player input,
 * HUD and buy-menu slots (P1 = keyboard+mouse, P2 = second keyboard), wires
 * the match-setup/menus + pointer-lock, and runs the render loop (1 or 2
 * split views).
 */
import { Engine } from './core/Engine.js';
import { Input } from './core/Input.js';
import { KeyboardInput2 } from './core/KeyboardInput2.js';
import { AudioEngine } from './audio/AudioEngine.js';
import { HUD } from './ui/HUD.js';
import { Menus } from './ui/Menus.js';
import { BuyMenu } from './ui/BuyMenu.js';
import { Game } from './game/Game.js';

const canvas = document.getElementById('viewport');
const audio = new AudioEngine();
const menus = new Menus(audio);
const engine = new Engine(canvas, menus.settings.quality);
const game = new Game(engine, audio);
game.menus = menus;

// Both players share one keyboard. P1 = WASD + mouse, P2 = IJKL + arrows.
const input1 = new Input(canvas);
const input2 = new KeyboardInput2();
const $ = (id) => document.getElementById(id);
const hud1 = new HUD($('hudv-1'), { accent: '#39ff8e', label: 'P1' });
const hud2 = new HUD($('hudv-2'), { accent: '#4ad6ff', label: 'P2' });
const buy1 = new BuyMenu(audio, $('buyv-1'));
const buy2 = new BuyMenu(audio, $('buyv-2'));
game.configureSlots([
  { input: input1, camera: engine.camera, hud: hud1, buyMenu: buy1, name: 'PLAYER 1', color: 0x39ff8e },
  { input: input2, camera: engine.camera2, hud: hud2, buyMenu: buy2, name: 'PLAYER 2', color: 0x4ad6ff },
]);

input1.sensitivity = menus.settings.sensitivity;
input1.invertY = menus.settings.invertY;
input2.sensitivity = menus.settings.sensitivity;
input2.invertY = menus.settings.invertY;
audio.masterVolume = menus.settings.volume / 100;
engine.setFov(menus.settings.fov);

function applyLayout(n) {
  const cls = (el, c) => { el.classList.remove('full', 'split-top', 'split-bottom', 'hidden'); el.classList.add(c); };
  if (n >= 2) {
    cls($('hudv-1'), 'split-top'); cls($('hudv-2'), 'split-bottom');
    cls($('buyv-1'), 'split-top'); cls($('buyv-2'), 'split-bottom');
    $('buyv-1').classList.add('hidden'); $('buyv-2').classList.add('hidden');
  } else {
    cls($('hudv-1'), 'full'); $('hudv-2').classList.add('hidden');
    cls($('buyv-1'), 'full'); $('buyv-2').classList.add('hidden');
  }
}

function applySettings(s, key) {
  input1.sensitivity = s.sensitivity; input1.invertY = s.invertY;
  input2.sensitivity = s.sensitivity; input2.invertY = s.invertY;
  audio.setVolume(s.volume / 100);
  for (const P of game.players) P.weapons.setBaseFov(s.fov);
  if (!game.players.length) engine.setFov(s.fov);
  if (key === 'bloom' || key === undefined) engine.setBloom(s.bloom);
  if (key === 'quality') {
    const q = { high: 1.5, medium: 1.25, low: 1.0 }[s.quality] || 1.25;
    engine.renderer.setPixelRatio(Math.min(window.devicePixelRatio, q));
    engine.composer.setPixelRatio(Math.min(window.devicePixelRatio, q));
    engine.setSSAO(s.quality !== 'low');
    engine.resize();
  }
}

/* ----------------------------- pointer lock (P1) ----------------------------- */
input1.onLockChange = (locked) => { if (locked) menus.hideLock(); };
function tryLock() { if (game.state === 'playing' && !input1.locked) input1.requestLock(); }
canvas.addEventListener('click', tryLock);
$('lock-prompt').addEventListener('click', tryLock);

addEventListener('keydown', (e) => {
  const P1 = game.players[0];
  if (e.code === 'Escape') {
    if (game.state === 'buy' && P1 && P1.buyOpen) game.closeBuy(P1);
    else if (game.state === 'playing') game.pause();
    else if (game.state === 'paused') resumeGame();
  } else if (e.code === 'KeyB' && P1) {
    if (game.state === 'playing') game.openBuy(P1);
    else if (game.state === 'buy' && P1.buyOpen) game.closeBuy(P1);
    else if (game.state === 'buy') game.openBuy(P1);
  }
});
addEventListener('blur', () => { if (game.state === 'playing') game.pause(); });
addEventListener('resize', () => { game.fx?.resize(); });

/* ----------------------------- menu actions ----------------------------- */
async function ensureBuilt(map) {
  map = map || game.mapChoice || 'dust2';
  if (game.built && game._builtMap === map) return;
  menus.loadProgress(0, map === 'metro' ? 'Loading metro station…' : 'Forging assets…');
  await game.build((p, t) => menus.loadProgress(p, t), map);
  menus.hideLoadProgress();
}
async function start(n, teamSize, opts = {}) {
  audio.resume();
  const map = opts.map || 'dust2';
  game.mapChoice = map;
  if (!game.built || game._builtMap !== map) await ensureBuilt(map);
  applyLayout(n);
  applySettings(menus.settings);
  menus.hideAll();
  game.startMatch(n, teamSize, opts);
}

// Match setup: pick map, co-op/versus (2P) and the team size (1v1 … 5v5).
let pendingHumans = 1, pendingVersus = false, pendingMap = 'dust2';
menus.on('play', () => { pendingHumans = 1; pendingVersus = false; pendingMap = 'dust2'; menus.showSetup(1, false); });
menus.on('coop', () => {
  pendingHumans = 2; pendingVersus = false; pendingMap = 'dust2';
  menus.flashHint('P2 controls: move I J K L · look ← ↑ → ↓ · fire RShift · reload P · buy U');
  menus.showSetup(2, true);
});
document.querySelectorAll('.map-btn').forEach((b) => {
  b.addEventListener('click', () => {
    pendingMap = b.dataset.map;
    document.querySelectorAll('.map-btn').forEach((x) => x.classList.toggle('active', x === b));
    audio.ui?.('click');
  });
});
document.querySelectorAll('.mode-btn').forEach((b) => {
  b.addEventListener('click', () => {
    pendingVersus = b.dataset.mode === 'versus';
    document.querySelectorAll('.mode-btn').forEach((x) => x.classList.toggle('active', x === b));
    audio.ui?.('click');
    menus.updateSetupSizes(pendingHumans, pendingVersus);
  });
});
document.querySelectorAll('.size-btn').forEach((b) => {
  b.addEventListener('click', () => {
    if (b.disabled) return;
    audio.ui?.('click');
    start(pendingHumans, parseInt(b.dataset.size, 10), { versus: pendingVersus, map: pendingMap });
  });
});

function resumeGame() { game.resume(); if (game.players[0]) input1.requestLock(); }
menus.on('resume', resumeGame);
menus.on('quit', () => game.quitToMenu());
menus.on('retry', () => start(game.numHumans || 1, game.teamSize || game.numHumans || 1, { versus: game.versus, map: game._builtMap }));
menus.on('mainmenu', () => game.quitToMenu());
menus.on('nextround', () => game.nextRound());
menus.on('settings', (s, key) => applySettings(s, key));
menus.on('closeOverlay', (id) => { if (game.state === 'paused' && id === 'settings') menus.show('pause'); });

/* ------------------------------- main loop ------------------------------- */
let last = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  let dt = (now - last) / 1000; last = now;
  if (dt > 0.05) dt = 0.05; if (dt < 0) dt = 0;

  const s = game.state;
  const active = (s === 'playing' || s === 'buy');
  input1.enabled = active; input2.enabled = active;
  if (s === 'playing') {
    if (game.numHumans < 2 && !input1.locked) menus.showLock(); else menus.hideLock();
    game.update(dt);
  } else if (s === 'buy') {
    menus.hideLock(); game.update(dt);
  } else if (s === 'roundend' || s === 'matchover') {
    game.update(dt);
  }

  engine.render(game.players.length ? game.views() : null);
  input1.endFrame();
}
requestAnimationFrame(loop);

// Pre-build in the background so DEPLOY is instant.
(async () => { await new Promise(r => setTimeout(r, 60)); try { await ensureBuilt(); } catch (e) { console.error('Build failed:', e); } })();

window.__game = game; window.__engine = engine;
