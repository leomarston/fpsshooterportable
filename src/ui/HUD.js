/**
 * HUD — a self-contained, class-scoped heads-up display built into a given
 * container element, so multiple instances can coexist (split-screen).
 * One instance per player view (full screen for 1P, a half for each in 2P).
 */

// White weapon silhouettes (CS:GO shows an icon, not text).
export function weaponIcon(kind) {
  const wrap = (p) => `<svg viewBox="0 0 140 48" preserveAspectRatio="xMidYMid meet"><g fill="currentColor">${p}</g></svg>`;
  switch (kind) {
    case 'rifle_ak': return wrap(`<rect x="8" y="20" width="20" height="9"/><polygon points="8,20 16,33 8,31"/><rect x="26" y="19" width="80" height="10"/><rect x="40" y="15" width="26" height="4"/><polygon points="56,29 76,29 71,43 60,43"/><polygon points="44,29 53,29 51,39 46,39"/><rect x="104" y="22" width="30" height="4"/><rect x="128" y="16" width="4" height="9"/>`);
    case 'rifle_m4': return wrap(`<rect x="8" y="21" width="20" height="8"/><rect x="26" y="19" width="82" height="10"/><rect x="40" y="14" width="34" height="3.5"/><rect x="56" y="29" width="12" height="14"/><polygon points="44,29 53,29 51,39 46,39"/><rect x="106" y="22" width="28" height="3.5"/><rect x="128" y="16" width="3.5" height="8"/>`);
    case 'smg': return wrap(`<rect x="24" y="21" width="16" height="7"/><rect x="38" y="20" width="58" height="9"/><rect x="58" y="29" width="9" height="15"/><polygon points="48,29 56,29 54,39 50,39"/><rect x="92" y="22" width="22" height="4"/>`);
    case 'pistol': return wrap(`<rect x="46" y="17" width="48" height="9"/><rect x="88" y="19" width="10" height="4"/><polygon points="52,26 70,26 65,43 56,43"/>`);
    case 'sniper': return wrap(`<rect x="8" y="23" width="16" height="6"/><rect x="20" y="22" width="100" height="6"/><rect x="116" y="23" width="18" height="3"/><rect x="58" y="13" width="38" height="5"/><rect x="62" y="10" width="6" height="4"/><rect x="86" y="10" width="6" height="4"/><polygon points="40,28 51,28 49,41 42,41"/>`);
    case 'shotgun': return wrap(`<rect x="8" y="21" width="16" height="8"/><rect x="24" y="20" width="84" height="8"/><rect x="58" y="28" width="42" height="4"/><rect x="104" y="21" width="30" height="3"/>`);
    case 'knife': return wrap(`<polygon points="44,32 98,16 104,21 52,36"/><rect x="30" y="28" width="16" height="9" rx="2"/>`);
    default: return wrap(`<rect x="30" y="20" width="80" height="9"/>`);
  }
}

const TEMPLATE = (accent) => `
  <div class="crosshair" style="--col:${accent}"><span class="ch ch-t"></span><span class="ch ch-b"></span><span class="ch ch-l"></span><span class="ch ch-r"></span><span class="ch-dot"></span></div>
  <div class="hitmarker"><span></span><span></span><span></span><span></span></div>
  <div class="damage-dirs"></div>
  <div class="vignette"></div>
  <div class="scope hidden"><div class="scope-lens"><div class="scope-h"></div><div class="scope-v"></div></div></div>
  <div class="top-bar">
    <div class="score-side ct"><span class="score-num score-ct">0</span><span class="score-lbl">CT <i class="alive-ct">0</i></span></div>
    <div class="timer-wrap"><div class="round-timer">0:00</div><div class="round-phase">ROUND <b class="round-num">1</b> <span class="half-lbl">1ST</span></div></div>
    <div class="score-side t"><span class="score-num score-t">0</span><span class="score-lbl">T <i class="alive-t">0</i></span></div>
  </div>
  <div class="killfeed"></div>
  <div class="radar"><canvas class="radar-canvas" width="220" height="220"></canvas><div class="radar-frame"></div><div class="radar-loc">DUST</div></div>
  <div class="money-box">
    <div class="money-row"><span class="money-sym">$</span><span class="money-val">0</span><span class="money-gain"></span></div>
    <div class="money-sub">STREAK <b class="streak-val">0</b></div>
    <div class="buy-hint hidden">PRESS <b>B</b> · <span class="buy-time">0:00</span></div>
  </div>
  <div class="vitals">
    <div class="vital health"><svg viewBox="0 0 24 24" class="vital-ico"><path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z"/></svg><div class="vital-stack"><span class="health-val">100</span><div class="vbar"><i class="health-bar"></i></div></div></div>
    <div class="vital armor"><svg viewBox="0 0 24 24" class="vital-ico"><path d="M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5l8-3z"/></svg><div class="vital-stack"><span class="armor-val">100</span><div class="vbar"><i class="armor-bar"></i></div></div></div>
  </div>
  <div class="ammo-block">
    <div class="weapon-icon"></div><div class="weapon-name">—</div>
    <div class="ammo-counts"><span class="ammo-mag">0</span><span class="ammo-div">/</span><span class="ammo-reserve">0</span><svg class="ammo-ico" viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="13" rx="2.5"/><rect x="9.5" y="16" width="5" height="5"/></svg></div>
    <div class="ammo-ticks"></div><div class="reload-hint hidden">PRESS <b>R</b> TO RELOAD</div><div class="weapon-slots"></div>
  </div>
  <div class="freeze-banner hidden"><div class="fz-label">FREEZE TIME</div><div class="fz-time">0:10</div><div class="fz-hint">PRESS <b>B</b> TO BUY</div></div>
  <div class="announce"></div>
  <div class="player-tag"></div>`;

export class HUD {
  constructor(root, opts = {}) {
    this.root = root;
    this.accent = opts.accent || '#39ff8e';
    this.label = opts.label || '';
    this.radarRange = 42;
    this._lowHp = false;
    this._attached = false;
  }

  attach() {
    if (this._attached) return;
    this.root.classList.add('hudv');
    this.root.innerHTML = TEMPLATE(this.accent);
    const q = (c) => this.root.querySelector('.' + c);
    this.el = {
      crosshair: q('crosshair'), hitmarker: q('hitmarker'), vignette: q('vignette'),
      dmgDirs: q('damage-dirs'), scope: q('scope'),
      scoreCT: q('score-ct'), scoreT: q('score-t'), timer: q('round-timer'), roundNum: q('round-num'),
      halfLbl: q('half-lbl'), aliveCT: q('alive-ct'), aliveT: q('alive-t'),
      sideCT: this.root.querySelector('.score-side.ct'), sideT: this.root.querySelector('.score-side.t'),
      killfeed: q('killfeed'), radar: q('radar-canvas'), radarLoc: q('radar-loc'),
      moneyVal: q('money-val'), moneyGain: q('money-gain'), streak: q('streak-val'),
      buyHint: q('buy-hint'), buyTime: q('buy-time'),
      healthVal: q('health-val'), healthBar: q('health-bar'), armorVal: q('armor-val'), armorBar: q('armor-bar'),
      vitalHealth: this.root.querySelector('.vital.health'),
      weaponIcon: q('weapon-icon'), weaponName: q('weapon-name'),
      ammoMag: q('ammo-mag'), ammoReserve: q('ammo-reserve'), ammoTicks: q('ammo-ticks'),
      reloadHint: q('reload-hint'), weaponSlots: q('weapon-slots'),
      freezeBanner: q('freeze-banner'), freezeTime: q('fz-time'), announce: q('announce'),
      tag: q('player-tag'),
    };
    this.rctx = this.el.radar.getContext('2d');
    if (this.label) this.el.tag.textContent = this.label;
    this._attached = true;
  }

  show() { this.attach(); this.root.classList.remove('hidden'); }
  hide() { this.root.classList.add('hidden'); }

  setHealth(hp) {
    hp = Math.max(0, Math.round(hp));
    this.el.healthVal.textContent = hp; this.el.healthBar.style.width = hp + '%';
    const low = hp <= 30; this.el.vitalHealth.classList.toggle('low', low);
    if (low !== this._lowHp) { this._lowHp = low; this.el.vignette.classList.toggle('lowhp', low); }
  }
  setArmor(a) { a = Math.max(0, Math.round(a)); this.el.armorVal.textContent = a; this.el.armorBar.style.width = a + '%'; }

  setAmmo(weapon, mag, reserve, reloading) {
    const kind = weapon.view && weapon.view.kind;
    if (kind !== this._iconKind) { this._iconKind = kind; this.el.weaponIcon.innerHTML = weaponIcon(kind); }
    this.el.weaponName.textContent = weapon.name;
    const inf = mag === Infinity;
    this.el.ammoMag.textContent = inf ? '∞' : mag;
    this.el.ammoReserve.textContent = (reserve === Infinity) ? '∞' : reserve;
    this.el.ammoMag.classList.toggle('low', !inf && mag <= Math.max(1, Math.ceil((weapon.magSize || 30) * 0.2)));
    this.el.reloadHint.classList.toggle('hidden', !(!inf && mag === 0 && reserve > 0 && !reloading));
    this._renderTicks(weapon, mag, inf);
  }
  _renderTicks(weapon, mag, inf) {
    const t = this.el.ammoTicks;
    if (inf || !weapon.magSize || weapon.magSize > 40) { t.innerHTML = ''; return; }
    const size = weapon.magSize;
    if (t.childElementCount !== size) { t.innerHTML = ''; for (let i = 0; i < size; i++) t.appendChild(document.createElement('i')); }
    const kids = t.children; for (let i = 0; i < size; i++) kids[i].className = (i < mag) ? '' : 'spent';
  }
  setWeaponSlots(available, current, weaponsData) {
    const slots = this.el.weaponSlots; slots.innerHTML = '';
    const order = available.slice().sort((a, b) => weaponsData[a].slot - weaponsData[b].slot);
    for (const k of order) {
      const w = weaponsData[k]; const div = document.createElement('div');
      div.className = 'wslot' + (k === current ? ' active' : '');
      div.innerHTML = weaponIcon(w.view && w.view.kind) + `<span class="k">${w.slot}</span>`;
      slots.appendChild(div);
    }
  }

  setRound(n) { this.el.roundNum.textContent = n; }
  setTimer(s) { s = Math.max(0, Math.floor(s)); this.el.timer.textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
  setLocation(name) { if (this.el.radarLoc) this.el.radarLoc.textContent = name; }
  // competitive scoreboard: round-wins per side + which side the player is on
  setMatchScore(ct, t, mySide) {
    this.el.scoreCT.textContent = ct; this.el.scoreT.textContent = t;
    if (this.el.sideCT) this.el.sideCT.classList.toggle('mine', mySide === 'CT');
    if (this.el.sideT) this.el.sideT.classList.toggle('mine', mySide === 'T');
  }
  setAlive(ctAlive, tAlive) {
    if (this.el.aliveCT) this.el.aliveCT.textContent = ctAlive;
    if (this.el.aliveT) this.el.aliveT.textContent = tAlive;
  }
  setHalf(label) { if (this.el.halfLbl) this.el.halfLbl.textContent = label; }
  setEnemies(c) { if (this.el.aliveT) this.el.aliveT.textContent = c; }
  setKills(k) { /* personal kills tracked on the scoreboard, not the top bar */ }
  setMoney(m) { this.el.moneyVal.textContent = m; }
  setScore(m) { this.el.moneyVal.textContent = m; }
  setStreak(s) { this.el.streak.textContent = s; }
  setObjective() {}

  moneyGain(a) { const g = this.el.moneyGain; if (!g) return; g.textContent = '+' + a; g.classList.remove('show'); void g.offsetWidth; g.classList.add('show'); }
  setBuyTime(secs) { const h = this.el.buyHint; if (!h) return; if (secs > 0) { h.classList.remove('hidden'); this.el.buyTime.textContent = '0:' + String(Math.ceil(secs)).padStart(2, '0'); } else h.classList.add('hidden'); }
  setFreeze(secs) { const b = this.el.freezeBanner; if (!b) return; if (secs > 0) { b.classList.remove('hidden'); this.el.freezeTime.textContent = '0:' + String(Math.ceil(secs)).padStart(2, '0'); } else b.classList.add('hidden'); }

  setCrosshair(inacc, fovDeg) {
    const H = (this.root.clientHeight || window.innerHeight);
    const ppr = (H / 2) / Math.tan((fovDeg * Math.PI / 180) / 2);
    this.el.crosshair.style.setProperty('--gap', Math.min(80, 5 + inacc * ppr).toFixed(1) + 'px');
  }
  hitmarker(headshot, killed) {
    const hm = this.el.hitmarker; hm.classList.remove('show', 'kill', 'head'); void hm.offsetWidth;
    hm.classList.add('show'); if (killed) hm.classList.add('kill'); else if (headshot) hm.classList.add('head');
  }
  killfeed(actor, victim, weaponName, headshot) {
    const row = document.createElement('div'); row.className = 'kf-row';
    row.innerHTML = `<span class="kf-actor">${actor}</span><span class="kf-weapon">${weaponName}${headshot ? ' ◎' : ''}</span><span class="kf-victim">${victim}</span>`;
    this.el.killfeed.appendChild(row);
    setTimeout(() => { row.classList.add('fade'); setTimeout(() => row.remove(), 500); }, 4200);
    while (this.el.killfeed.children.length > 4) this.el.killfeed.firstChild.remove();
  }
  damageFlash() { const v = this.el.vignette; v.classList.add('hit'); setTimeout(() => v.classList.remove('hit'), 110); }
  damageDirection(ang) {
    const arc = document.createElement('div'); arc.className = 'dmg-arc'; arc.style.transform = `rotate(${ang}rad)`;
    this.el.dmgDirs.appendChild(arc); void arc.offsetWidth; arc.classList.add('show'); setTimeout(() => arc.remove(), 950);
  }
  showScope(on) { this.el.scope.classList.toggle('hidden', !on); this.el.crosshair.style.opacity = on ? '0' : '1'; }
  announce(big, sub = '', dur = 2000, color = '#fff') {
    const a = this.el.announce;
    a.innerHTML = `<div class="announce-big" style="color:${color}">${big}</div>` + (sub ? `<div class="announce-sub">${sub}</div>` : '');
    a.style.opacity = '1'; clearTimeout(this._annTimer);
    this._annTimer = setTimeout(() => { a.style.transition = 'opacity .5s'; a.style.opacity = '0'; setTimeout(() => { a.innerHTML = ''; a.style.transition = ''; }, 500); }, dur);
  }

  setMap(boxes, bounds) {
    this._bounds = bounds; const rects = []; const mapArea = (bounds.x1 - bounds.x0) * (bounds.z1 - bounds.z0);
    for (const b of boxes) {
      if (!b.solid || !b.blocksSight) continue;
      const h = b.max.y - b.min.y; if (b.min.y > 2.2 || h < 1.2) continue;
      const area = (b.max.x - b.min.x) * (b.max.z - b.min.z); if (area > mapArea * 0.5) continue;
      rects.push({ x0: b.min.x, z0: b.min.z, x1: b.max.x, z1: b.max.z, prop: area < 9 });
    }
    this._mapRects = rects;
  }
  // `mates` = combatants on the viewer's team (allies). Enemies are NOT shown.
  updateRadar(player, mates, sites) {
    const ctx = this.rctx; if (!ctx) return;
    const W = this.el.radar.width, Hc = this.el.radar.height, cx = W / 2, cy = Hc / 2, s = (W / 2) / this.radarRange;
    const cos = Math.cos(player.yaw), sin = Math.sin(player.yaw), px = player.feet.x, pz = player.feet.z;
    const toR = (wx, wz) => { const dx = wx - px, dz = wz - pz; return [cx + (dx * cos - dz * sin) * s, cy + (dx * sin + dz * cos) * s]; };
    ctx.clearRect(0, 0, W, Hc); ctx.fillStyle = '#0c0f13'; ctx.fillRect(0, 0, W, Hc);
    if (this._mapRects) for (const r of this._mapRects) {
      const p1 = toR(r.x0, r.z0), p2 = toR(r.x1, r.z0), p3 = toR(r.x1, r.z1), p4 = toR(r.x0, r.z1);
      ctx.beginPath(); ctx.moveTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); ctx.lineTo(p3[0], p3[1]); ctx.lineTo(p4[0], p4[1]); ctx.closePath();
      if (r.prop) ctx.fillStyle = '#6e5a36'; else { ctx.fillStyle = '#3a3526'; ctx.strokeStyle = '#5f5740'; ctx.lineWidth = 1; ctx.stroke(); }
      ctx.fill();
    }
    ctx.font = 'bold 16px Rajdhani, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const key of Object.keys(sites || {})) { const sp = sites[key]; const [sx, sy] = toR(sp.center.x, sp.center.z); ctx.fillStyle = '#e6c87399'; ctx.fillText(key, sx, sy); }
    // friendly blips only — teammates (not the viewer, not enemies)
    for (const m of (mates || [])) {
      if (!m || m === player || !m.alive) continue;
      const [sx, sy] = toR(m.feet.x, m.feet.z);
      if (sx < -6 || sx > W + 6 || sy < -6 || sy > Hc + 6) continue;
      ctx.fillStyle = '#46d3ff';
      ctx.beginPath(); ctx.arc(sx, sy, 3.4, 0, 7); ctx.fill();
      ctx.strokeStyle = '#0c0f13'; ctx.lineWidth = 1.2; ctx.stroke();
    }
    ctx.save(); ctx.translate(cx, cy); ctx.fillStyle = this.accent; ctx.strokeStyle = '#0c0f13'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(-5.5, 6); ctx.lineTo(0, 3); ctx.lineTo(5.5, 6); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = this.accent + '22'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-26, -42); ctx.lineTo(26, -42); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
}
