/**
 * HUD — drives the DOM overlay in a CS:GO-style layout:
 *   • radar/minimap (renders the real map) + money/score box  — top-left
 *   • kills | round timer | hostiles                          — top-center
 *   • kill feed                                               — top-right
 *   • health + armor (icon, number, bar)                      — bottom-left
 *   • weapon, ammo clip/reserve, bullet ticks                 — bottom-right
 */
export class HUD {
  constructor() {
    const $ = (id) => document.getElementById(id);
    this.el = {
      hud: $('hud'), crosshair: $('crosshair'), hitmarker: $('hitmarker'),
      vignette: $('vignette'), dmgDirs: $('damage-dirs'), scope: $('scope'),
      scoreCT: $('score-ct'), scoreT: $('score-t'), timer: $('round-timer'), roundNum: $('round-num'),
      killfeed: $('killfeed'),
      healthVal: $('health-val'), healthBar: $('health-bar'),
      armorVal: $('armor-val'), armorBar: $('armor-bar'),
      vitalHealth: document.querySelector('.vital.health'),
      weaponName: $('weapon-name'), ammoMag: $('ammo-mag'), ammoReserve: $('ammo-reserve'),
      ammoTicks: $('ammo-ticks'), reloadHint: $('reload-hint'), weaponSlots: $('weapon-slots'),
      moneyVal: $('money-val'), streak: $('streak-val'),
      radar: $('radar-canvas'), radarLoc: $('radar-loc'), announce: $('announce'),
    };
    this.rctx = this.el.radar.getContext('2d');
    this.radarRange = 42;     // world units shown from centre to edge
    this._lowHp = false;
    this._mapRects = null;
    this._bounds = null;
  }

  show() { this.el.hud.classList.remove('hidden'); }
  hide() { this.el.hud.classList.add('hidden'); }

  setHealth(hp) {
    hp = Math.max(0, Math.round(hp));
    this.el.healthVal.textContent = hp;
    this.el.healthBar.style.width = hp + '%';
    const low = hp <= 30;
    this.el.vitalHealth.classList.toggle('low', low);
    if (low !== this._lowHp) { this._lowHp = low; this.el.vignette.classList.toggle('lowhp', low); }
  }
  setArmor(a) {
    a = Math.max(0, Math.round(a));
    this.el.armorVal.textContent = a;
    this.el.armorBar.style.width = a + '%';
  }

  setAmmo(weapon, mag, reserve, reloading) {
    this.el.weaponName.textContent = weapon.name;
    const inf = mag === Infinity;
    this.el.ammoMag.textContent = inf ? '∞' : mag;
    this.el.ammoReserve.textContent = (reserve === Infinity) ? '∞' : reserve;
    const lowThresh = Math.max(1, Math.ceil((weapon.magSize || 30) * 0.2));
    this.el.ammoMag.classList.toggle('low', !inf && mag <= lowThresh);
    this.el.reloadHint.classList.toggle('hidden', !(!inf && mag === 0 && reserve > 0 && !reloading));
    this._renderTicks(weapon, mag, inf);
  }

  _renderTicks(weapon, mag, inf) {
    const t = this.el.ammoTicks;
    if (inf || !weapon.magSize || weapon.magSize > 40) { t.innerHTML = ''; return; }
    const size = weapon.magSize;
    if (t.childElementCount !== size) {
      t.innerHTML = '';
      for (let i = 0; i < size; i++) t.appendChild(document.createElement('i'));
    }
    const kids = t.children;
    for (let i = 0; i < size; i++) kids[i].className = (i < mag) ? '' : 'spent';
  }

  setWeaponSlots(available, current, weaponsData) {
    const slots = this.el.weaponSlots;
    slots.innerHTML = '';
    const order = available.slice().sort((a, b) => weaponsData[a].slot - weaponsData[b].slot);
    for (const k of order) {
      const w = weaponsData[k];
      const div = document.createElement('div');
      div.className = 'wslot' + (k === current ? ' active' : '');
      div.innerHTML = `<span class="k">${w.slot}</span> ${w.name}`;
      slots.appendChild(div);
    }
  }

  setRound(n) { this.el.roundNum.textContent = n; }
  setTimer(seconds) {
    const s = Math.max(0, Math.floor(seconds));
    this.el.timer.textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }
  setObjective() { /* layout has no objective line; kept for API compatibility */ }
  setEnemies(c) { this.el.scoreT.textContent = c; }
  setKills(k) { this.el.scoreCT.textContent = k; }
  setScore(s) { this.el.moneyVal.textContent = s; }
  setStreak(s) { this.el.streak.textContent = s; }
  setLocation(name) { if (this.el.radarLoc) this.el.radarLoc.textContent = name; }

  setCrosshair(inaccuracy, fovDeg) {
    const H = window.innerHeight;
    const ppr = (H / 2) / Math.tan((fovDeg * Math.PI / 180) / 2);
    const gap = Math.min(80, 5 + inaccuracy * ppr);
    this.el.crosshair.style.setProperty('--gap', gap.toFixed(1) + 'px');
  }

  hitmarker(headshot, killed) {
    const hm = this.el.hitmarker;
    hm.classList.remove('show', 'kill', 'head');
    void hm.offsetWidth;
    hm.classList.add('show');
    if (killed) hm.classList.add('kill');
    else if (headshot) hm.classList.add('head');
  }

  killfeed(actor, victim, weaponName, headshot) {
    const row = document.createElement('div');
    row.className = 'kf-row';
    row.innerHTML = `<span class="kf-actor">${actor}</span>` +
      `<span class="kf-weapon">${weaponName}${headshot ? ' ◎' : ''}</span>` +
      `<span class="kf-victim">${victim}</span>`;
    this.el.killfeed.appendChild(row);
    setTimeout(() => { row.classList.add('fade'); setTimeout(() => row.remove(), 500); }, 4200);
    while (this.el.killfeed.children.length > 5) this.el.killfeed.firstChild.remove();
  }

  damageFlash() { const v = this.el.vignette; v.classList.add('hit'); setTimeout(() => v.classList.remove('hit'), 110); }

  damageDirection(angleRad) {
    const arc = document.createElement('div');
    arc.className = 'dmg-arc';
    arc.style.transform = `rotate(${angleRad}rad)`;
    this.el.dmgDirs.appendChild(arc);
    void arc.offsetWidth; arc.classList.add('show');
    setTimeout(() => arc.remove(), 950);
  }

  showScope(on) {
    this.el.scope.classList.toggle('hidden', !on);
    this.el.crosshair.style.opacity = on ? '0' : '1';
  }

  announce(big, sub = '', duration = 2000, color = '#fff') {
    const a = this.el.announce;
    a.innerHTML = `<div class="announce-big" style="color:${color}">${big}</div>` +
      (sub ? `<div class="announce-sub">${sub}</div>` : '');
    a.style.opacity = '1';
    clearTimeout(this._annTimer);
    this._annTimer = setTimeout(() => {
      a.style.transition = 'opacity .5s'; a.style.opacity = '0';
      setTimeout(() => { a.innerHTML = ''; a.style.transition = ''; }, 500);
    }, duration);
  }

  /* ------------------------------- radar ------------------------------- */

  // Precompute a lightweight set of wall/prop footprints from world colliders.
  setMap(boxes, bounds, sites) {
    this._bounds = bounds; this._sites = sites;
    const rects = [];
    const mapArea = (bounds.x1 - bounds.x0) * (bounds.z1 - bounds.z0);
    for (const b of boxes) {
      if (!b.solid || !b.blocksSight) continue;
      const h = b.max.y - b.min.y;
      if (b.min.y > 2.2) continue;          // skip overhead lintels -> doorways read as gaps
      if (h < 1.2) continue;
      const area = (b.max.x - b.min.x) * (b.max.z - b.min.z);
      if (area > mapArea * 0.5) continue;   // skip the ground slab
      const small = area < 9;               // crates / barrels / posts
      rects.push({ x0: b.min.x, z0: b.min.z, x1: b.max.x, z1: b.max.z, prop: small });
    }
    this._mapRects = rects;
  }

  updateRadar(player, enemies, sites) {
    const ctx = this.rctx;
    const W = this.el.radar.width, Hc = this.el.radar.height;
    const cx = W / 2, cy = Hc / 2;
    const s = (W / 2) / this.radarRange;
    const yaw = player.yaw;
    const cos = Math.cos(yaw), sin = Math.sin(yaw);
    const px = player.feet.x, pz = player.feet.z;
    const toR = (wx, wz) => {
      const dx = wx - px, dz = wz - pz;
      return [cx + (dx * cos - dz * sin) * s, cy + (dx * sin + dz * cos) * s];
    };

    ctx.clearRect(0, 0, W, Hc);
    ctx.fillStyle = '#0c0f13'; ctx.fillRect(0, 0, W, Hc);

    // map walls / props
    if (this._mapRects) {
      for (const r of this._mapRects) {
        const p1 = toR(r.x0, r.z0), p2 = toR(r.x1, r.z0), p3 = toR(r.x1, r.z1), p4 = toR(r.x0, r.z1);
        ctx.beginPath();
        ctx.moveTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); ctx.lineTo(p3[0], p3[1]); ctx.lineTo(p4[0], p4[1]); ctx.closePath();
        if (r.prop) { ctx.fillStyle = '#6e5a36'; }
        else { ctx.fillStyle = '#3a3526'; ctx.strokeStyle = '#5f5740'; ctx.lineWidth = 1; ctx.stroke(); }
        ctx.fill();
      }
    }

    // bombsite letters
    ctx.font = 'bold 16px Rajdhani, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const key of Object.keys(sites || {})) {
      const sp = sites[key]; const [sx, sy] = toR(sp.center.x, sp.center.z);
      ctx.fillStyle = '#e6c87399'; ctx.fillText(key, sx, sy);
    }

    // enemies
    for (const e of enemies) {
      if (e.dead) continue;
      const [sx, sy] = toR(e.feet.x, e.feet.z);
      if (sx < -6 || sx > W + 6 || sy < -6 || sy > Hc + 6) continue;
      const seen = e.canSee || e.alert > 0.5;
      // facing tick
      ctx.fillStyle = seen ? '#ff4d4d' : '#d06a44';
      ctx.beginPath(); ctx.arc(sx, sy, 3.6, 0, 7); ctx.fill();
      if (seen) { ctx.strokeStyle = '#ff4d4d88'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(sx, sy, 7, 0, 7); ctx.stroke(); }
    }

    // player arrow (always centre, pointing up)
    ctx.save();
    ctx.translate(cx, cy);
    ctx.fillStyle = '#39ff8e'; ctx.strokeStyle = '#0c0f13'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(-5.5, 6); ctx.lineTo(0, 3); ctx.lineTo(5.5, 6); ctx.closePath();
    ctx.fill(); ctx.stroke();
    // view cone
    ctx.fillStyle = '#39ff8e22';
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-26, -42); ctx.lineTo(26, -42); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
}
