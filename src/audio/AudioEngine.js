/**
 * AudioEngine — 100% code-synthesized sound via the Web Audio API.
 *
 * No audio files. Gunshots, reloads, footsteps, hit markers, bullet
 * whizz, explosions, UI and round stingers are all built from
 * oscillators + filtered noise. Enemy fire is spatialised relative to
 * the player camera (stereo pan + distance/occlusion attenuation).
 */
import * as THREE from 'three';

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.comp = null;
    this.noiseBuf = null;
    this.masterVolume = 0.7;
    this.listenerPos = new THREE.Vector3();
    this.listenerRight = new THREE.Vector3(1, 0, 0);
    this.listenerFwd = new THREE.Vector3(0, 0, -1);
    this._wind = null;
    this._started = false;
  }

  // Must be called from a user gesture (click).
  resume() {
    if (!this.ctx) this._init();
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  _init() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();
    this.comp = this.ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14; this.comp.knee.value = 26;
    this.comp.ratio.value = 9; this.comp.attack.value = 0.002; this.comp.release.value = 0.18;
    this.master = this.ctx.createGain();
    this.master.gain.value = this.masterVolume;
    this.comp.connect(this.master).connect(this.ctx.destination);
    // white noise buffer
    const len = this.ctx.sampleRate * 1.2;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this._started = true;
  }

  setVolume(v) { this.masterVolume = v; if (this.master) this.master.gain.value = v; }

  setListener(camera) {
    camera.getWorldPosition(this.listenerPos);
    this.listenerRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
    this.listenerFwd.set(0, 0, -1).applyQuaternion(camera.quaternion);
  }

  // Compute {gain, pan} for a world position relative to the listener.
  _spatial(pos, refDist = 8, maxDist = 130) {
    const dx = pos.x - this.listenerPos.x, dy = pos.y - this.listenerPos.y, dz = pos.z - this.listenerPos.z;
    const dist = Math.hypot(dx, dy, dz);
    const gain = refDist / Math.max(refDist, dist) * (1 - Math.min(dist / maxDist, 1)) ** 0.5;
    // pan via dot with right vector
    const inv = dist > 0.001 ? 1 / dist : 0;
    const pan = THREE.MathUtils.clamp((dx * this.listenerRight.x + dy * this.listenerRight.y + dz * this.listenerRight.z) * inv, -1, 1);
    return { gain: Math.max(gain, 0), pan, dist };
  }

  /* ----------------------------- primitives ----------------------------- */

  _now() { return this.ctx.currentTime; }

  _noise(dur, { type = 'bandpass', freq = 1200, q = 1, gain = 1, when = 0, attack = 0.001, decay = null } = {}) {
    const t = this._now() + when;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf; src.loop = true;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = this.ctx.createGain();
    const dec = decay ?? dur;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + dec);
    src.connect(f).connect(g);
    return { src, g, f, t, stop: t + attack + dec + 0.02 };
  }

  _tone(freq, dur, { type = 'sine', gain = 0.3, when = 0, attack = 0.002, slideTo = null } = {}) {
    const t = this._now() + when;
    const o = this.ctx.createOscillator(); o.type = type; o.frequency.value = freq;
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    return { o, g, t, stop: t + dur + 0.02 };
  }

  // Route a node chain to master, optionally through a stereo panner.
  _out(node, pan = 0) {
    if (pan !== 0 && this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner(); p.pan.value = pan;
      node.connect(p).connect(this.comp);
      return p;
    }
    node.connect(this.comp);
    return node;
  }

  /* ------------------------------ weapons ------------------------------ */

  // profile keyed by weapon family.
  gunshot(profile = 'rifle', pos = null) {
    if (!this._started) return;
    let spatial = { gain: 1, pan: 0, dist: 0 };
    if (pos) spatial = this._spatial(pos, 6, 140);
    if (spatial.gain <= 0.001) return;
    const v = spatial.gain;

    const P = {
      pistol:  { body: 150, crack: 2200, len: 0.10, cgain: 0.5, bgain: 0.7, q: 1.2 },
      rifle:   { body: 110, crack: 1700, len: 0.14, cgain: 0.7, bgain: 0.9, q: 1.0 },
      smg:     { body: 170, crack: 2600, len: 0.085, cgain: 0.45, bgain: 0.55, q: 1.4 },
      sniper:  { body: 80,  crack: 1200, len: 0.30, cgain: 1.0, bgain: 1.1, q: 0.7 },
      shotgun: { body: 90,  crack: 900,  len: 0.22, cgain: 0.9, bgain: 1.1, q: 0.6 },
    }[profile] || (profile && typeof profile === 'object' ? profile : { body: 110, crack: 1700, len: 0.14, cgain: 0.7, bgain: 0.9, q: 1.0 });

    // muzzle blast: bright noise crack
    const crack = this._noise(P.len, { type: 'highpass', freq: P.crack, q: P.q, gain: 0.9 * P.cgain * v, attack: 0.0008, decay: P.len });
    crack.src.start(crack.t); crack.src.stop(crack.stop);
    this._out(crack.g, spatial.pan);

    // body thump (low)
    const body = this._tone(P.body, P.len * 1.4, { type: 'triangle', gain: 0.9 * P.bgain * v, when: 0, slideTo: P.body * 0.5 });
    body.o.start(body.t); body.o.stop(body.stop);
    this._out(body.g, spatial.pan * 0.6);

    // mid mechanical pop
    const mid = this._noise(P.len * 0.7, { type: 'bandpass', freq: 800, q: 0.8, gain: 0.5 * v });
    mid.src.start(mid.t); mid.src.stop(mid.stop);
    this._out(mid.g, spatial.pan);

    // distant tail for far shots
    if (spatial.dist > 25) {
      const tail = this._noise(0.35, { type: 'lowpass', freq: 700, q: 0.5, gain: 0.3 * v, attack: 0.02, decay: 0.34, when: 0.03 });
      tail.src.start(tail.t); tail.src.stop(tail.stop);
      this._out(tail.g, spatial.pan);
    }
  }

  dryFire() {
    if (!this._started) return;
    const c = this._noise(0.04, { type: 'highpass', freq: 3000, q: 2, gain: 0.25, decay: 0.04 });
    c.src.start(c.t); c.src.stop(c.stop); this._out(c.g);
    const t = this._tone(1800, 0.03, { type: 'square', gain: 0.08 });
    t.o.start(t.t); t.o.stop(t.stop); this._out(t.g);
  }

  reload(stage) {
    if (!this._started) return;
    // stage: 'magout' | 'magin' | 'charge'
    const clickHi = () => { const c = this._noise(0.05, { type: 'bandpass', freq: 2600, q: 3, gain: 0.4, decay: 0.05 }); c.src.start(c.t); c.src.stop(c.stop); this._out(c.g, -0.1); };
    const clickLo = () => { const c = this._noise(0.07, { type: 'bandpass', freq: 900, q: 2, gain: 0.5, decay: 0.07 }); c.src.start(c.t); c.src.stop(c.stop); this._out(c.g, 0.1); const t = this._tone(220, 0.05, { type: 'square', gain: 0.12 }); t.o.start(t.t); t.o.stop(t.stop); this._out(t.g); };
    if (stage === 'magout') clickLo();
    else if (stage === 'magin') { clickLo(); }
    else if (stage === 'charge') { clickHi(); const t = this._tone(420, 0.06, { type: 'square', gain: 0.15, when: 0.03, slideTo: 260 }); t.o.start(t.t); t.o.stop(t.stop); this._out(t.g); }
  }

  /* ------------------------------ feedback ------------------------------ */

  hitMarker(headshot = false) {
    if (!this._started) return;
    const f = headshot ? 1400 : 950;
    const t = this._tone(f, 0.06, { type: 'square', gain: 0.18, slideTo: f * 1.4 });
    t.o.start(t.t); t.o.stop(t.stop); this._out(t.g);
    if (headshot) { const t2 = this._tone(2000, 0.09, { type: 'sine', gain: 0.2, when: 0.02 }); t2.o.start(t2.t); t2.o.stop(t2.stop); this._out(t2.g); }
  }

  impact(material, pos = null) {
    if (!this._started) return;
    let sp = { gain: 1, pan: 0 }; if (pos) sp = this._spatial(pos, 5, 60);
    if (sp.gain <= 0.001) return;
    const v = sp.gain;
    if (material === 'flesh') {
      const n = this._noise(0.09, { type: 'lowpass', freq: 500, q: 1, gain: 0.6 * v, decay: 0.09 }); n.src.start(n.t); n.src.stop(n.stop); this._out(n.g, sp.pan);
      const t = this._tone(120, 0.08, { type: 'sine', gain: 0.3 * v, slideTo: 70 }); t.o.start(t.t); t.o.stop(t.stop); this._out(t.g, sp.pan);
    } else if (material === 'metal') {
      const n = this._noise(0.12, { type: 'bandpass', freq: 3200, q: 5, gain: 0.5 * v, decay: 0.12 }); n.src.start(n.t); n.src.stop(n.stop); this._out(n.g, sp.pan);
      const t = this._tone(2400, 0.1, { type: 'square', gain: 0.12 * v, slideTo: 1500 }); t.o.start(t.t); t.o.stop(t.stop); this._out(t.g, sp.pan);
    } else if (material === 'wood') {
      const n = this._noise(0.07, { type: 'bandpass', freq: 1100, q: 1.5, gain: 0.45 * v, decay: 0.07 }); n.src.start(n.t); n.src.stop(n.stop); this._out(n.g, sp.pan);
    } else { // concrete / sand
      const n = this._noise(0.08, { type: 'bandpass', freq: 1700, q: 1, gain: 0.45 * v, decay: 0.08 }); n.src.start(n.t); n.src.stop(n.stop); this._out(n.g, sp.pan);
    }
  }

  whizz(pos = null, pan = 0) {
    if (!this._started) return;
    let p = pan; if (pos) p = this._spatial(pos, 5, 40).pan;
    const n = this._noise(0.12, { type: 'bandpass', freq: 1800, q: 8, gain: 0.18, attack: 0.02, decay: 0.1 });
    n.f.frequency.setValueAtTime(2600, n.t); n.f.frequency.exponentialRampToValueAtTime(900, n.t + 0.12);
    n.src.start(n.t); n.src.stop(n.stop); this._out(n.g, p);
  }

  footstep(surface = 'sand', pos = null) {
    if (!this._started) return;
    let v = 0.18, pan = 0;
    if (pos) { const sp = this._spatial(pos, 3, 35); v = 0.22 * sp.gain; pan = sp.pan; if (v < 0.004) return; }
    const cfg = { sand: [380, 0.07, 'lowpass'], wood: [700, 0.06, 'bandpass'], metal: [1800, 0.05, 'bandpass'], concrete: [900, 0.05, 'bandpass'] }[surface] || [500, 0.06, 'lowpass'];
    const n = this._noise(cfg[1], { type: cfg[2], freq: cfg[0], q: 1.2, gain: v, decay: cfg[1] });
    n.src.start(n.t); n.src.stop(n.stop); this._out(n.g, pan);
  }

  explosion(pos = null) {
    if (!this._started) return;
    let sp = { gain: 1, pan: 0 }; if (pos) sp = this._spatial(pos, 12, 160);
    const v = sp.gain;
    const boom = this._tone(70, 0.7, { type: 'sine', gain: 1.0 * v, slideTo: 30 }); boom.o.start(boom.t); boom.o.stop(boom.stop); this._out(boom.g, sp.pan);
    const blast = this._noise(0.5, { type: 'lowpass', freq: 1200, q: 0.7, gain: 0.9 * v, attack: 0.002, decay: 0.5 });
    blast.f.frequency.setValueAtTime(2500, blast.t); blast.f.frequency.exponentialRampToValueAtTime(300, blast.t + 0.5);
    blast.src.start(blast.t); blast.src.stop(blast.stop); this._out(blast.g, sp.pan);
  }

  /* ------------------------------- UI / round ------------------------------- */

  ui(kind = 'click') {
    if (!this._started) return;
    if (kind === 'click') { const t = this._tone(660, 0.07, { type: 'square', gain: 0.1, slideTo: 880 }); t.o.start(t.t); t.o.stop(t.stop); this._out(t.g); }
    else if (kind === 'hover') { const t = this._tone(440, 0.04, { type: 'sine', gain: 0.05 }); t.o.start(t.t); t.o.stop(t.stop); this._out(t.g); }
    else if (kind === 'back') { const t = this._tone(440, 0.08, { type: 'square', gain: 0.1, slideTo: 300 }); t.o.start(t.t); t.o.stop(t.stop); this._out(t.g); }
  }

  stinger(kind) {
    if (!this._started) return;
    const seq = {
      roundstart: [[392, 0], [523, 0.1], [659, 0.2]],
      win: [[523, 0], [659, 0.12], [784, 0.24], [1047, 0.4]],
      lose: [[440, 0], [392, 0.16], [330, 0.32], [262, 0.5]],
    }[kind];
    if (!seq) return;
    for (const [f, when] of seq) {
      const t = this._tone(f, 0.3, { type: 'triangle', gain: 0.22, when });
      t.o.start(t.t); t.o.stop(t.stop); this._out(t.g);
      const t2 = this._tone(f * 2, 0.3, { type: 'sine', gain: 0.08, when }); t2.o.start(t2.t); t2.o.stop(t2.stop); this._out(t2.g);
    }
  }

  /* ------------------------------ ambient wind ------------------------------ */

  startAmbient() {
    if (!this._started || this._wind) return;
    const src = this.ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 420; f.Q.value = 0.6;
    const g = this.ctx.createGain(); g.gain.value = 0.05;
    const lfo = this.ctx.createOscillator(); lfo.frequency.value = 0.08;
    const lfoG = this.ctx.createGain(); lfoG.gain.value = 220;
    lfo.connect(lfoG).connect(f.frequency);
    src.connect(f).connect(g).connect(this.master);
    src.start(); lfo.start();
    this._wind = { src, lfo, g };
  }
  stopAmbient() { if (this._wind) { try { this._wind.src.stop(); this._wind.lfo.stop(); } catch (e) {} this._wind = null; } }
}
