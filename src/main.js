/**
 * main — bootstrap. Creates the engine/input/audio/HUD/menus/game,
 * wires the pointer-lock flow and menu actions, applies settings, and
 * runs the fixed-clamped render loop.
 */
import { Engine } from './core/Engine.js';
import { Input } from './core/Input.js';
import { AudioEngine } from './audio/AudioEngine.js';
import { HUD } from './ui/HUD.js';
import { Menus } from './ui/Menus.js';
import { Game } from './game/Game.js';

const canvas = document.getElementById('viewport');
const audio = new AudioEngine();
const menus = new Menus(audio);
const engine = new Engine(canvas, menus.settings.quality);
const input = new Input(canvas);
const hud = new HUD();
const game = new Game(engine, input, audio, hud, menus);

input.sensitivity = menus.settings.sensitivity;
input.invertY = menus.settings.invertY;
audio.masterVolume = menus.settings.volume / 100;
engine.setFov(menus.settings.fov);

function applySettings(s, key) {
  input.sensitivity = s.sensitivity;
  input.invertY = s.invertY;
  audio.setVolume(s.volume / 100);
  if (game.weapons) game.weapons.setBaseFov(s.fov); else engine.setFov(s.fov);
  if (key === 'bloom' || key === undefined) engine.setBloom(s.bloom);
  if (key === 'quality') {
    // live-apply what we cheaply can; full quality applies on reload
    const q = { high: 1.5, medium: 1.25, low: 1.0 }[s.quality] || 1.25;
    engine.renderer.setPixelRatio(Math.min(window.devicePixelRatio, q));
    engine.composer.setPixelRatio(Math.min(window.devicePixelRatio, q));
    engine.setSSAO(s.quality !== 'low');
    engine.resize();
  }
}

/* ----------------------------- pointer lock ----------------------------- */
input.onLockChange = (locked) => {
  if (locked) { menus.hideLock(); }
  else if (game.state === 'playing') { game.pause(); }
};

function tryLock() {
  if (game.state === 'playing' && !input.locked) input.requestLock();
}
canvas.addEventListener('click', tryLock);
document.getElementById('lock-prompt').addEventListener('click', tryLock);

addEventListener('keydown', (e) => {
  if (e.code === 'Escape') {
    if (game.state === 'playing') game.pause();
    else if (game.state === 'paused') resumeGame();
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

menus.on('play', async () => {
  audio.resume();
  if (!game.built) { await ensureBuilt(); }
  applySettings(menus.settings);
  menus.hideAll();
  game.startGame();
  input.requestLock();
});

function resumeGame() { game.resume(); input.requestLock(); }
menus.on('resume', resumeGame);
menus.on('quit', () => game.quitToMenu());
menus.on('retry', () => { audio.resume(); applySettings(menus.settings); game.startGame(); input.requestLock(); });
menus.on('mainmenu', () => game.quitToMenu());
menus.on('nextround', () => { game.nextRound(); input.requestLock(); });
menus.on('settings', (s, key) => applySettings(s, key));
menus.on('closeOverlay', (id) => {
  // returning from settings while paused -> keep pause menu visible
  if (game.state === 'paused' && id === 'settings') menus.show('pause');
});

/* ------------------------------- main loop ------------------------------- */
let last = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.05) dt = 0.05;        // clamp to avoid tunneling on stalls
  if (dt < 0) dt = 0;

  let shouldUpdate = false;
  if (game.state === 'playing') {
    if (input.locked) { input.enabled = true; menus.hideLock(); shouldUpdate = true; }
    else { input.enabled = false; menus.showLock(); }
  } else if (game.state === 'roundend' || game.state === 'dead') {
    input.enabled = false; shouldUpdate = true;
  } else {
    input.enabled = false;
  }

  if (shouldUpdate) game.update(dt);
  engine.render();
  input.endFrame();
}
requestAnimationFrame(loop);

// Pre-build in the background so DEPLOY is instant and locks within the gesture.
(async () => {
  // small delay so the menu paints first
  await new Promise(r => setTimeout(r, 60));
  try { await ensureBuilt(); } catch (e) { console.error('Build failed:', e); }
})();

// expose for debugging
window.__game = game; window.__engine = engine;
