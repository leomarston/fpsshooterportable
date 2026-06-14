/**
 * HUD — drives the DOM overlay: dynamic crosshair (expands with
 * inaccuracy), health/armor, ammo, kill feed, hit markers, directional
 * damage arcs, low-health vignette, radar, scope and announcements.
 */
export class HUD {
  constructor() {
    this.el = {
      hud: document.getElementById('hud'),
      crosshair: document.getElementById('crosshair'),
      hitmarker: document.getElementById('hitmarker'),
      vignette: document.getElementById('vignette'),
      dmgDirs: document.getElementById('damage-dirs'),
      scope: document.getElementById('scope'),
      roundNum: document.getElementById('round-num'),
      objective: document.getElementById('objective'),
      enemiesLeft: document.getElementById('enemies-left'),
      killfeed: document.getElementById('killfeed'),
      healthVal: document.getElementById('health-val'),
      armorVal: document.getElementById('armor-val'),
      vitalHealth: document.querySelector('.vital.health'),
      weaponName: document.getElementById('weapon-name'),
      ammoMag: document.getElementById('ammo-mag'),
      ammoReserve: document.getElementById('ammo-reserve'),
      reloadHint: document.getElementById('reload-hint'),
      weaponSlots: document.getElementById('weapon-slots'),
      kills: document.getElementById('kills-val'),
      score: document.getElementById('score-val'),
      streak: document.getElementById('streak-val'),
      radar: document.getElementById('radar-canvas'),
      announce: document.getElementById('announce'),
    };
    this.rctx = this.el.radar.getContext('2d');
    this.radarRange = 55;
    this._hmTimer = null;
    this._lowHp = false;
  }

  show() { this.el.hud.classList.remove('hidden'); }
  hide() { this.el.hud.classList.add('hidden'); }

  setHealth(hp) {
    hp = Math.max(0, Math.round(hp));
    this.el.healthVal.textContent = hp;
    const low = hp <= 30;
    this.el.vitalHealth.classList.toggle('low', low);
    if (low !== this._lowHp) {
      this._lowHp = low;
      this.el.vignette.classList.toggle('lowhp', low);
    }
  }
  setArmor(a) { this.el.armorVal.textContent = Math.max(0, Math.round(a)); }

  setAmmo(weapon, mag, reserve, reloading) {
    this.el.weaponName.textContent = weapon.name;
    const inf = mag === Infinity;
    this.el.ammoMag.textContent = inf ? '∞' : mag;
    this.el.ammoReserve.textContent = (reserve === Infinity) ? '∞' : reserve;
    this.el.ammoMag.classList.toggle('low', !inf && mag <= Math.max(1, Math.ceil((weapon.magSize || 30) * 0.2)));
    const empty = !inf && mag === 0 && reserve > 0 && !reloading;
    this.el.reloadHint.classList.toggle('hidden', !empty);
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
  setObjective(t) { this.el.objective.textContent = t; }
  setEnemies(c) { this.el.enemiesLeft.textContent = c; }
  setKills(k) { this.el.kills.textContent = k; }
  setScore(s) { this.el.score.textContent = s; }
  setStreak(s) { this.el.streak.textContent = s; }

  // inaccuracy: cone half-angle in radians; fovDeg: vertical FOV
  setCrosshair(inaccuracy, fovDeg) {
    const H = window.innerHeight;
    const ppr = (H / 2) / Math.tan((fovDeg * Math.PI / 180) / 2);
    const gap = Math.min(80, 5 + inaccuracy * ppr);
    this.el.crosshair.style.setProperty('--gap', gap.toFixed(1) + 'px');
  }

  hitmarker(headshot, killed) {
    const hm = this.el.hitmarker;
    hm.classList.remove('show', 'kill', 'head');
    void hm.offsetWidth; // reflow to restart animation
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

  damageFlash() {
    const v = this.el.vignette;
    v.classList.add('hit');
    setTimeout(() => v.classList.remove('hit'), 110);
  }

  damageDirection(angleRad) {
    const arc = document.createElement('div');
    arc.className = 'dmg-arc';
    arc.style.transform = `rotate(${angleRad}rad)`;
    this.el.dmgDirs.appendChild(arc);
    void arc.offsetWidth;
    arc.classList.add('show');
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

  updateRadar(player, enemies, sites) {
    const ctx = this.rctx;
    const W = this.el.radar.width, Hc = this.el.radar.height;
    const cx = W / 2, cy = Hc / 2, R = W / 2 - 6;
    ctx.clearRect(0, 0, W, Hc);
    // sweep ring
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.clip();
    ctx.fillStyle = 'rgba(12,10,7,0.55)'; ctx.fillRect(0, 0, W, Hc);
    // grid
    ctx.strokeStyle = 'rgba(194,160,90,0.18)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, Hc); ctx.moveTo(0, cy); ctx.lineTo(W, cy); ctx.stroke();

    const yaw = player.yaw;
    const cos = Math.cos(yaw), sin = Math.sin(yaw);
    const toRadar = (wx, wz) => {
      const dx = wx - player.feet.x, dz = wz - player.feet.z;
      // rotate so player's facing (-z) points up
      const rx = dx * cos - dz * sin;
      const rz = dx * sin + dz * cos;
      const sx = cx + (rx / this.radarRange) * R;
      const sy = cy + (rz / this.radarRange) * R;
      return [sx, sy];
    };

    // sites
    ctx.font = 'bold 13px Rajdhani, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const key of Object.keys(sites || {})) {
      const s = sites[key];
      const [sx, sy] = toRadar(s.center.x, s.center.z);
      ctx.fillStyle = 'rgba(230,210,140,0.5)';
      ctx.fillText(key, sx, sy);
    }
    // enemies
    for (const e of enemies) {
      if (e.dead) continue;
      const [sx, sy] = toRadar(e.feet.x, e.feet.z);
      const d2 = (sx - cx) ** 2 + (sy - cy) ** 2;
      if (d2 > R * R) continue;
      const seen = e.canSee || e.alert > 0.5;
      ctx.fillStyle = seen ? '#ff4d4d' : '#c2603a';
      ctx.beginPath(); ctx.arc(sx, sy, 3.2, 0, 7); ctx.fill();
      if (seen) { ctx.strokeStyle = 'rgba(255,77,77,0.5)'; ctx.beginPath(); ctx.arc(sx, sy, 6, 0, 7); ctx.stroke(); }
    }
    ctx.restore();

    // player arrow at center
    ctx.fillStyle = '#39ff8e';
    ctx.beginPath();
    ctx.moveTo(cx, cy - 6); ctx.lineTo(cx - 4, cy + 5); ctx.lineTo(cx + 4, cy + 5);
    ctx.closePath(); ctx.fill();
  }
}
