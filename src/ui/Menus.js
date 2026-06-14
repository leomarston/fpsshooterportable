/**
 * Menus — overlay & settings controller (main menu, briefing, settings,
 * pause, round transition, game over, click-to-lock prompt). Persists
 * settings to localStorage and emits changes to the game.
 */
const STORE_KEY = 'desertstorm.settings.v1';

const DEFAULTS = {
  sensitivity: 1.0, fov: 90, volume: 70, quality: 'medium',
  bloom: true, invertY: false,
};

export class Menus {
  constructor(audio) {
    this.audio = audio;
    this.settings = Object.assign({}, DEFAULTS, this._load());
    this.callbacks = {};
    this.ov = {
      menu: document.getElementById('menu'),
      setup: document.getElementById('setup'),
      briefing: document.getElementById('briefing'),
      settings: document.getElementById('settings'),
      pause: document.getElementById('pause'),
      round: document.getElementById('round-screen'),
      gameover: document.getElementById('gameover'),
      lock: document.getElementById('lock-prompt'),
    };
    this._wire();
    this._applyInputsFromSettings();
  }

  on(name, fn) { this.callbacks[name] = fn; }
  _emit(name, ...args) { this.callbacks[name]?.(...args); }

  _load() { try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; } }
  _save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(this.settings)); } catch {} }

  _click() { this.audio?.ui('click'); }

  _wire() {
    const byId = (id) => document.getElementById(id);
    const click = (id, fn) => byId(id)?.addEventListener('click', () => { this._click(); fn(); });

    click('btn-play', () => this._emit('play'));
    click('btn-coop', () => this._emit('coop'));
    click('btn-howto', () => this.show('briefing'));
    click('btn-settings', () => this.show('settings'));
    click('btn-resume', () => this._emit('resume'));
    click('btn-pause-settings', () => this.show('settings'));
    click('btn-quit', () => this._emit('quit'));
    click('btn-retry', () => this._emit('retry'));
    click('btn-menu', () => this._emit('mainmenu'));
    click('btn-next-round', () => this._emit('nextround'));

    document.querySelectorAll('.close-overlay').forEach(btn => {
      btn.addEventListener('click', () => {
        this._click();
        const id = btn.dataset.close;
        this.ov[id]?.classList.add('hidden');
        // returning from a sub-overlay: re-show pause if a game is paused
        this._emit('closeOverlay', id);
      });
    });

    // hover sfx for buttons
    document.querySelectorAll('.btn').forEach(b => b.addEventListener('mouseenter', () => this.audio?.ui('hover')));

    // settings controls
    const bind = (id, key, transform = (v) => v, outId = null, fmt = (v) => v) => {
      const el = byId(id); if (!el) return;
      const out = outId ? byId(outId) : null;
      const apply = () => {
        const val = transform(el.type === 'checkbox' ? el.checked : el.value);
        this.settings[key] = val;
        if (out) out.textContent = fmt(val);
        this._save();
        this._emit('settings', this.settings, key);
      };
      el.addEventListener('input', apply);
      el.addEventListener('change', apply);
    };
    bind('set-sens', 'sensitivity', v => parseFloat(v), 'out-sens', v => v.toFixed(2));
    bind('set-fov', 'fov', v => parseInt(v), 'out-fov', v => v);
    bind('set-vol', 'volume', v => parseInt(v), 'out-vol', v => v);
    bind('set-quality', 'quality', v => v);
    bind('set-bloom', 'bloom', v => !!v);
    bind('set-invert', 'invertY', v => !!v);
  }

  _applyInputsFromSettings() {
    const s = this.settings;
    const set = (id, val, out, fmt) => { const el = document.getElementById(id); if (!el) return; if (el.type === 'checkbox') el.checked = val; else el.value = val; if (out) document.getElementById(out).textContent = fmt ? fmt(val) : val; };
    set('set-sens', s.sensitivity, 'out-sens', v => (+v).toFixed(2));
    set('set-fov', s.fov, 'out-fov');
    set('set-vol', s.volume, 'out-vol');
    set('set-quality', s.quality);
    set('set-bloom', s.bloom);
    set('set-invert', s.invertY);
  }

  // Show the team-size picker; disable formats smaller than the human count.
  showSetup(minSize) {
    document.querySelectorAll('.size-btn').forEach((b) => {
      const s = parseInt(b.dataset.size, 10);
      const off = s < minSize;
      b.disabled = off; b.classList.toggle('disabled', off);
    });
    this.show('setup');
  }

  flashHint(msg) {
    const h = document.getElementById('menu-hint'); if (!h) return;
    h.textContent = msg; h.classList.add('show');
    clearTimeout(this._hintT); this._hintT = setTimeout(() => h.classList.remove('show'), 3500);
  }

  show(name) {
    this.ov[name]?.classList.remove('hidden');
  }
  hide(name) { this.ov[name]?.classList.add('hidden'); }
  hideAll() { for (const k in this.ov) this.ov[k].classList.add('hidden'); }

  showLock() { this.ov.lock.classList.remove('hidden'); }
  hideLock() { this.ov.lock.classList.add('hidden'); }

  showRound(data) {
    const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    document.getElementById('rs-title').textContent = data.title || 'ROUND CLEARED';
    document.getElementById('rs-sub').textContent = data.sub || '';
    const stats = document.getElementById('rs-stats');
    stats.innerHTML = (data.stats || []).map(s => `<div class="st"><b>${s.v}</b><span>${s.l}</span></div>`).join('');
    this.show('round');
  }
  updateRoundCountdown(n) { const e = document.getElementById('rs-count'); if (e) e.textContent = n; }

  showGameOver(data) {
    document.getElementById('go-title').textContent = data.title || 'YOU WERE ELIMINATED';
    const stats = document.getElementById('go-stats');
    stats.innerHTML = (data.stats || []).map(s => `<div class="st"><b>${s.v}</b><span>${s.l}</span></div>`).join('');
    this.show('gameover');
  }

  loadProgress(p, text) {
    const lp = document.getElementById('loadprog');
    lp.classList.remove('hidden');
    lp.querySelector('.bar i').style.width = Math.round(p * 100) + '%';
    if (text) lp.querySelector('span').textContent = text;
  }
  hideLoadProgress() { document.getElementById('loadprog')?.classList.add('hidden'); }
}
