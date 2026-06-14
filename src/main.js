/**
 * main — bootstrap. Creates engine/audio/menus, builds per-player input,
 * HUD and buy-menu slots (P1 = keyboard+mouse, P2 = gamepad), wires the
 * menus + pointer-lock, and runs the render loop (1 or 2 split views).
 */
import { Engine } from './core/Engine.js';
import { Input } from './core/Input.js';
import { GamepadInput } from './core/GamepadInput.js';
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

// Player 1 = keyboard + mouse, Player 2 = gamepad.
const input1 = new Input(canvas);
const gamepad2 = new GamepadInput(0);
const $ = (id) => document.getElementById(id);
const hud1 = new HUD($('hudv-1'), { accent: '#39ff8e', label: 'P1' });
const hud2 = new HUD($('hudv-2'), { accent: '#4ad6ff', label: 'P2' });
const buy1 = new BuyMenu(audio, $('buyv-1'));
const buy2 = new BuyMenu(audio, $('buyv-2'));
game.configureSlots([
  { input: input1, camera: engine.camera, hud: hud1, buyMenu: buy1, name: 'PLAYER 1', color: 0x39ff8e },
  { input: gamepad2, camera: engine.camera2, hud: hud2, buyMenu: buy2, name: 'PLAYER 2', color: 0x4ad6ff },
]);

input1.sensitivity = menus.settings.sensitivity;
input1.invertY = menus.settings.invertY;
gamepad2.sensitivity = menus.settings.sensitivity;
gamepad2.invertY = menus.settings.invertY;
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
  gamepad2.sensitivity = s.sensitivity; gamepad2.invertY = s.invertY;
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
async function ensureBuilt() {
  if (game.built) return;
  menus.loadProgress(0, 'Forging assets…');
  await game.build((p, t) => menus.loadProgress(p, t));
  menus.hideLoadProgress();
}
async function start(n) {
  audio.resume();
  if (!game.built) await ensureBuilt();
  applyLayout(n);
  applySettings(menus.settings);
  menus.hideAll();
  game.startGame(n);
}
menus.on('play', () => start(1));
menus.on('coop', () => {
  if (!gamepad2.connected) menus.flashHint('Connect a gamepad for Player 2 (you can still start).');
  start(2);
});
function resumeGame() { game.resume(); if (game.players[0]) input1.requestLock(); }
menus.on('resume', resumeGame);
menus.on('quit', () => game.quitToMenu());
menus.on('retry', () => start(game.numPlayers || 1));
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
  if (s === 'playing') {
    input1.enabled = true;
    if (input1.locked) menus.hideLock(); else menus.showLock();
    game.update(dt);
  } else if (s === 'buy') {
    input1.enabled = true; menus.hideLock();
    game.update(dt);
  } else if (s === 'roundend' || s === 'dead') {
    input1.enabled = false; game.update(dt);
  } else {
    input1.enabled = false;
  }

  engine.render(game.players.length ? game.views() : null);
  input1.endFrame();
}
requestAnimationFrame(loop);

// Pre-build in the background so DEPLOY is instant.
(async () => { await new Promise(r => setTimeout(r, 60)); try { await ensureBuilt(); } catch (e) { console.error('Build failed:', e); } })();

window.__game = game; window.__engine = engine;
