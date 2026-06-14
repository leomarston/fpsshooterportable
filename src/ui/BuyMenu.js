/**
 * BuyMenu — per-player purchase screen built into its own container, so two
 * can coexist in split-screen. Two columns; categories stacked with prices.
 * Player 1 buys with the mouse; player 2 navigates with the gamepad
 * (stick = move selection, A = buy, Start/B = deploy).
 */
import { WEAPONS, EQUIPMENT, BUY_LAYOUT } from '../entities/WeaponData.js';
import { weaponIcon } from './HUD.js';

const SHELL = `
  <div class="buy-wrap">
    <div class="buy-head">
      <div class="buy-title">BUY MENU</div>
      <div class="buy-money">BALANCE <b class="buy-balance">$0</b></div>
      <div class="buy-timer">BUY TIME <b class="buy-countdown">0:10</b></div>
    </div>
    <div class="buy-cols"><div class="buy-col buy-col-left"></div><div class="buy-col buy-col-right"></div></div>
    <div class="buy-foot"><div class="buy-owned"></div><button class="btn btn-primary buy-deploy">DEPLOY <span class="kbd-mini">B</span></button></div>
  </div>`;

export class BuyMenu {
  constructor(audio, container) {
    this.audio = audio;
    this.root = container;
    this.root.classList.add('buyv');
    this.root.innerHTML = SHELL;
    const q = (c) => this.root.querySelector('.' + c);
    this.el = {
      left: q('buy-col-left'), right: q('buy-col-right'),
      balance: q('buy-balance'), countdown: q('buy-countdown'),
      owned: q('buy-owned'), deploy: q('buy-deploy'),
    };
    this.P = null; this.game = null;
    this.items = []; this.sel = 0; this._navCd = 0;
    this.el.deploy.addEventListener('click', () => { this.audio?.ui('click'); this.game?.closeBuy(this.P); });
    for (const col of [this.el.left, this.el.right]) {
      col.addEventListener('click', (e) => { const b = e.target.closest('.buy-item'); if (b) this._buy(b.dataset.key, b.dataset.kind); });
      col.addEventListener('mouseover', (e) => { if (e.target.closest('.buy-item')) this.audio?.ui('hover'); });
    }
  }

  get visible() { return !this.root.classList.contains('hidden'); }

  open(P, game) { this.P = P; this.game = game; this.sel = 0; this.render(); this.root.classList.remove('hidden'); }
  close() { this.root.classList.add('hidden'); }

  _buy(key, kind) {
    if (!this.game || !this.P) return;
    const ok = kind === 'equip' ? this.game.buyArmor(this.P, key) : this.game.buyWeapon(this.P, key);
    if (ok) this.render();
  }

  _itemHTML(key, kind) {
    const P = this.P;
    if (kind === 'equip') {
      const e = EQUIPMENT[key];
      const owned = P.owned.armor >= 100 && (e.helmet ? P.owned.helmet : true);
      const cant = P.money < e.price;
      const ico = `<svg viewBox="0 0 24 24" class="bi-ico"><path d="M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5l8-3z"/></svg>`;
      return `<button class="buy-item ${owned ? 'owned' : cant ? 'cant' : ''}" data-key="${key}" data-kind="equip">${ico}<span class="bi-name">${e.name}</span><span class="bi-price">${owned ? 'OWNED' : '$' + e.price}</span></button>`;
    }
    const w = WEAPONS[key];
    const eq = (w.slot === 1 && P.owned.primary === key) || (w.slot === 2 && P.owned.pistol === key);
    const cant = P.money < w.price;
    return `<button class="buy-item ${eq ? 'owned' : cant ? 'cant' : ''}" data-key="${key}" data-kind="weapon"><span class="bi-ico bi-gun">${weaponIcon(w.view && w.view.kind)}</span><span class="bi-name">${w.name}</span><span class="bi-price">${eq ? 'OWNED' : '$' + w.price}</span></button>`;
  }
  _colHTML(cats) {
    return cats.map(cat => {
      const items = cat.items.map(k => this._itemHTML(k, cat.kind === 'equip' ? 'equip' : 'weapon')).join('');
      return `<div class="buy-cat"><div class="buy-cat-label">${cat.label}</div><div class="buy-cat-items">${items}</div></div>`;
    }).join('');
  }

  render() {
    const P = this.P;
    this.el.left.innerHTML = this._colHTML(BUY_LAYOUT.left);
    this.el.right.innerHTML = this._colHTML(BUY_LAYOUT.right);
    this.el.balance.textContent = '$' + P.money;
    const nm = (k) => k ? WEAPONS[k].name : '—';
    const armor = P.owned.armor >= 100 ? (P.owned.helmet ? 'KEVLAR+HELMET' : 'KEVLAR') : 'NONE';
    this.el.owned.innerHTML = `<b>${P.name}</b> · <b>${nm(P.owned.primary)}</b> · <b>${nm(P.owned.pistol)}</b> · ARMOR <b>${armor}</b>`;
    // flat item list for gamepad navigation
    this.items = Array.from(this.root.querySelectorAll('.buy-item'));
    this.sel = Math.min(this.sel, Math.max(0, this.items.length - 1));
    this._highlight();
    this.update();
  }

  _highlight() {
    this.items.forEach((it, i) => it.classList.toggle('sel', i === this.sel && this.P && this.P.input.kind === 'gamepad'));
    const it = this.items[this.sel];
    if (it && it.scrollIntoView) it.scrollIntoView({ block: 'nearest' });
  }
  _move(d) { if (!this.items.length) return; this.sel = (this.sel + d + this.items.length) % this.items.length; this._highlight(); this.audio?.ui('hover'); }
  _confirm() { const it = this.items[this.sel]; if (it) this._buy(it.dataset.key, it.dataset.kind); }

  update() {
    if (!this.game || !this.P) return;
    const secs = Math.ceil(this.game.buyTimeLeft());
    this.el.countdown.textContent = '0:' + String(Math.max(0, secs)).padStart(2, '0');
    this.el.balance.textContent = '$' + this.P.money;
    this.root.classList.toggle('timeup', secs <= 0);

    // gamepad navigation
    if (this.P.input.kind === 'gamepad') {
      const inp = this.P.input;
      this._navCd -= 1 / 60;
      const ax = inp.moveAxis();
      if (this._navCd <= 0) {
        if (ax.f > 0.5) { this._move(-1); this._navCd = 0.16; }
        else if (ax.f < -0.5) { this._move(1); this._navCd = 0.16; }
      }
      if (inp.pressed('Space')) this._confirm();                         // A = buy
      if (inp.pressed('Escape') || inp.pressed('ControlLeft')) this.game.closeBuy(this.P); // Start/B = deploy
    }
  }
}
