/**
 * BuyMenu — CS-style purchase screen. Two panels side by side; within
 * each panel the categories are stacked, every item showing its price.
 * Click an item to buy it (money permitting, during buy time).
 */
import { WEAPONS, EQUIPMENT, BUY_LAYOUT } from '../entities/WeaponData.js';
import { weaponIcon } from './HUD.js';

export class BuyMenu {
  constructor(audio) {
    this.audio = audio;
    this.game = null;
    this.onClose = null;
    this.el = {
      root: document.getElementById('buymenu'),
      left: document.getElementById('buy-col-left'),
      right: document.getElementById('buy-col-right'),
      balance: document.getElementById('buy-balance'),
      countdown: document.getElementById('buy-countdown'),
      owned: document.getElementById('buy-owned'),
      deploy: document.getElementById('buy-deploy'),
    };
    this.el.deploy.addEventListener('click', () => { this.audio?.ui('click'); this.onClose?.(); });
    // delegate item clicks
    for (const col of [this.el.left, this.el.right]) {
      col.addEventListener('click', (e) => {
        const btn = e.target.closest('.buy-item'); if (!btn) return;
        this._buy(btn.dataset.key, btn.dataset.kind);
      });
      col.addEventListener('mouseover', (e) => { if (e.target.closest('.buy-item')) this.audio?.ui('hover'); });
    }
  }

  get visible() { return !this.el.root.classList.contains('hidden'); }

  open(game) {
    this.game = game;
    this.render();
    this.el.root.classList.remove('hidden');
  }
  close() { this.el.root.classList.add('hidden'); }

  _buy(key, kind) {
    if (!this.game) return;
    const ok = kind === 'equip' ? this.game.buyArmor(key) : this.game.buyWeapon(key);
    if (ok) this.render();
  }

  _itemHTML(key, kind) {
    const g = this.game;
    if (kind === 'equip') {
      const e = EQUIPMENT[key];
      const owned = g.owned.armor >= 100 && (e.helmet ? g.owned.helmet : true);
      const cant = g.money < e.price;
      const cls = owned ? 'owned' : (cant ? 'cant' : '');
      const shieldIcon = `<svg viewBox="0 0 24 24" class="bi-ico"><path d="M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5l8-3z"/></svg>`;
      return `<button class="buy-item ${cls}" data-key="${key}" data-kind="equip">${shieldIcon}` +
        `<span class="bi-name">${e.name}</span>` +
        `<span class="bi-price">${owned ? 'OWNED' : '$' + e.price}</span></button>`;
    }
    const w = WEAPONS[key];
    const equipped = (w.slot === 1 && g.owned.primary === key) || (w.slot === 2 && g.owned.pistol === key);
    const cant = g.money < w.price;
    const cls = equipped ? 'owned' : (cant ? 'cant' : '');
    return `<button class="buy-item ${cls}" data-key="${key}" data-kind="weapon">` +
      `<span class="bi-ico bi-gun">${weaponIcon(w.view && w.view.kind)}</span>` +
      `<span class="bi-name">${w.name}</span>` +
      `<span class="bi-price">${equipped ? 'OWNED' : '$' + w.price}</span></button>`;
  }

  _colHTML(cats) {
    return cats.map(cat => {
      const items = cat.items.map(k => this._itemHTML(k, cat.kind === 'equip' ? 'equip' : 'weapon')).join('');
      return `<div class="buy-cat"><div class="buy-cat-label">${cat.label}</div><div class="buy-cat-items">${items}</div></div>`;
    }).join('');
  }

  render() {
    const g = this.game;
    this.el.left.innerHTML = this._colHTML(BUY_LAYOUT.left);
    this.el.right.innerHTML = this._colHTML(BUY_LAYOUT.right);
    this.el.balance.textContent = '$' + g.money;
    const prim = g.owned.primary ? WEAPONS[g.owned.primary].name : '—';
    const pist = g.owned.pistol ? WEAPONS[g.owned.pistol].name : '—';
    const armor = g.owned.armor >= 100 ? (g.owned.helmet ? 'KEVLAR+HELMET' : 'KEVLAR') : 'NONE';
    this.el.owned.innerHTML = `LOADOUT: <b>${prim}</b> · <b>${pist}</b> · ARMOR <b>${armor}</b>`;
    this.update();
  }

  update() {
    if (!this.game) return;
    const secs = Math.ceil(this.game.buyTimeLeft());
    this.el.countdown.textContent = '0:' + String(Math.max(0, secs)).padStart(2, '0');
    this.el.balance.textContent = '$' + this.game.money;
    this.el.root.classList.toggle('timeup', secs <= 0);
  }
}
