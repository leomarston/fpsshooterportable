/**
 * Game — orchestrates the whole match.
 *
 * Builds the world (map, navmesh), creates the player, weapons, combat
 * and bot manager, then runs an escalating round system: clear every
 * hostile to win the round; each round spawns more bots with sharper
 * aim, faster reactions and better guns. Player death ends the run.
 */
import * as THREE from 'three';
import { Forge } from '../core/AssetForge.js';
import { CollisionWorld } from '../world/Collision.js';
import { MapBuilder } from '../world/MapBuilder.js';
import { Nav } from '../world/Nav.js';
import { Player } from '../entities/Player.js';
import { WeaponManager } from '../entities/Weapon.js';
import { WEAPONS, EQUIPMENT, MONEY_START, MONEY_MAX } from '../entities/WeaponData.js';
import { Combat } from '../entities/Combat.js';
import { EnemyManager } from '../entities/Enemy.js';
import { FX } from '../fx/FX.js';

const lerp = (a, b, t) => a + (b - a) * t;

export class Game {
  constructor(engine, input, audio, hud, menus) {
    this.engine = engine;
    this.input = input;
    this.audio = audio;
    this.hud = hud;
    this.menus = menus;

    this.state = 'menu';     // menu | buy | playing | roundend | dead | paused
    this.round = 0;
    this.kills = 0;
    this.score = 0;
    this.streak = 0;
    this.totalKills = 0;
    this.headshots = 0;
    this._roundCountdown = 0;
    this._deathTimer = 0;
    this._endDelay = 0;
    this.built = false;

    // economy / loadout
    this.money = MONEY_START;
    this.owned = { primary: null, pistol: 'glock', armor: 0, helmet: false };
    this._buyEnd = 0;          // performance.now() when buy time ends
    this._freezeEnd = 0;       // when the freeze period ends (== buy end)
    this.frozen = false;       // freeze time: player can look but not move
    this.buyMenu = null;       // set by main.js
    this.freezeDuration = 10;  // seconds of freeze + buy time at round start
  }

  async build(onProgress) {
    const scene = this.engine.scene;
    onProgress?.(0.1, 'Forging materials…');
    await frame();

    this.world = new CollisionWorld();
    this.fx = new FX(scene);
    this.map = new MapBuilder(scene, this.world, Forge);

    onProgress?.(0.25, 'Building the site…');
    await frame();
    this.mapInfo = this.map.build();

    onProgress?.(0.6, 'Baking navigation…');
    await frame();
    this.nav = new Nav(this.world, this.mapInfo.bounds, 1.6);

    // feed the radar the real map geometry
    this.hud.setMap(this.world.boxes, this.mapInfo.bounds, this.mapInfo.sites);

    onProgress?.(0.8, 'Arming operators…');
    await frame();

    this.player = new Player(this.engine.camera, this.input, this.world, this.audio);
    this.combat = new Combat(this.world, this.fx, this.audio);
    this.combat.setPlayer(this.player);
    this.weapons = new WeaponManager(this.engine, this.engine.camera, this.input, this.audio, this.player, this.combat);
    this.enemyMgr = new EnemyManager(scene, this.world, this.nav, this.audio, this.fx, this.combat, this.engine.camera);
    this.combat.setEnemies(this.enemyMgr);

    this._wireCombat();
    this._wireWeapons();

    onProgress?.(1.0, 'Ready');
    await frame();
    this.built = true;
  }

  _wireWeapons() {
    this.weapons.onAmmoChange = (w, mag, reserve, reloading) => {
      this.hud.setAmmo(w, mag, reserve, reloading);
      this.hud.setWeaponSlots(this.weapons.available, this.weapons.current, WEAPONS);
    };
    this.weapons.onShoot = (w) => {
      this.player.emitNoise(w.type === 'sniper' ? 2.2 : w.type === 'shotgun' ? 1.8 : 1.4);
    };
  }

  _wireCombat() {
    this.combat.onHitmarker = (headshot, killed) => this.hud.hitmarker(headshot, killed);
    this.combat.onScope = (on) => this.hud.showScope(on);
    this.combat.onKill = (enemy, weapon, headshot) => {
      this.kills++; this.totalKills++; this.streak++;
      if (headshot) this.headshots++;
      this.score += (headshot ? 150 : 100) + this.streak * 10;
      // money reward (weapon-specific, headshot bonus)
      const reward = (weapon.killReward || 300) + (headshot ? 100 : 0);
      this.money = Math.min(MONEY_MAX, this.money + reward);
      this.hud.setKills(this.kills); this.hud.setMoney(this.money); this.hud.setStreak(this.streak);
      this.hud.moneyGain(reward);
      this.hud.killfeed('YOU', 'HOSTILE', weapon.name, headshot);
      this.hud.setEnemies(this.enemyMgr.aliveCount);
      if (this.streak === 3) this.hud.announce('TRIPLE KILL', '', 1200, '#ffd23d');
      if (this.streak === 5) this.hud.announce('RAMPAGE', '', 1400, '#ff7a3d');
      if (this.streak >= 8 && this.streak % 2 === 0) this.hud.announce('UNSTOPPABLE', '', 1400, '#ff4d4d');
    };
    this.combat.onPlayerHit = (dmg, fromPos, headshot) => {
      this.hud.damageFlash();
      const dir = new THREE.Vector3().subVectors(fromPos, this.player.eyePos);
      const ang = Math.atan2(dir.x, -dir.z) - this.player.yaw;
      this.hud.damageDirection(ang);
      this.streak = 0; this.hud.setStreak(0);
    };
  }

  /* ------------------------------ flow ------------------------------ */

  startGame() {
    this.round = 0; this.kills = 0; this.score = 0; this.streak = 0;
    this.totalKills = 0; this.headshots = 0;
    this.money = MONEY_START;
    this.owned = { primary: null, pistol: 'glock', armor: 0, helmet: false };
    this.enemyMgr.clearAll();
    this.hud.setKills(0); this.hud.setMoney(this.money); this.hud.setStreak(0);
    this.hud.show();
    this.audio.startAmbient();
    this.nextRound();
  }

  nextRound() {
    this.round++;
    this.menus.hideAll();
    this.menus.hideLock();

    // respawn + heal player at CT spawn, facing the bombsites
    const spawn = this._pickPlayerSpawn();
    this.player.reset(spawn);
    this.player.setLookFrom(new THREE.Vector3(0, 1.6, 0));
    this.player.armor = this.owned.armor;
    this.player._updateCamera(0.016);

    // give the owned loadout (top up ammo), default pistol + knife always
    this._applyOwned(true);
    this.weapons.setBaseFov(this.menus.settings.fov);

    // spawn the wave (frozen until the buy phase ends / player deploys)
    const diff = this._difficulty(this.round);
    this._spawnWave(diff);

    this._roundStart = performance.now();
    this._freezeEnd = performance.now() + this.freezeDuration * 1000;
    this._buyEnd = this._freezeEnd;     // buy time == freeze time
    this.frozen = true;                 // locked in place until freeze ends
    this.hud.setRound(this.round);
    this.hud.setMoney(this.money);
    this.hud.setEnemies(this.enemyMgr.aliveCount);
    this.audio.stinger('roundstart');
    this._endDelay = 0;

    // open the buy phase (freeze time)
    this.openBuy(true);
  }

  /* ------------------------------ economy / buy ------------------------------ */

  canBuy() { return (this._buyEnd - performance.now()) > 0; }
  buyTimeLeft() { return Math.max(0, (this._buyEnd - performance.now()) / 1000); }

  openBuy(roundStart = false) {
    if (this.state === 'buy') return;
    if (!roundStart && !this.canBuy()) { this.hud.announce('BUY TIME OVER', '', 900, '#e0413a'); return; }
    this._returnState = roundStart ? 'playing' : this.state;
    this.state = 'buy';
    this.input.exitLock();
    this.hud.setFreeze(0);
    this.buyMenu?.open(this);
  }
  closeBuy() {
    if (this.state !== 'buy') return;
    this.state = 'playing';
    this.buyMenu?.close();
    if (this.round === 1 && !this._engaged) {
      this._engaged = true;
      this.hud.announce(`ROUND ${this.round}`, 'ENGAGE', 1500, '#e7c878');
    }
  }

  buyWeapon(key) {
    const w = WEAPONS[key];
    if (!w || !this.canBuy()) return false;
    if ((w.slot === 1 && this.owned.primary === key) || (w.slot === 2 && this.owned.pistol === key)) return false;
    if (this.money < w.price) { this.audio.ui('back'); return false; }
    this.money -= w.price;
    if (w.slot === 1) this.owned.primary = key; else if (w.slot === 2) this.owned.pistol = key;
    this._applyOwned(false);
    this.weapons.equip(key);
    this.hud.setMoney(this.money);
    this.audio.ui('click');
    return true;
  }
  buyArmor(kind) {
    const e = EQUIPMENT[kind];
    if (!e || !this.canBuy()) return false;
    const already = this.owned.armor >= 100 && (e.helmet ? this.owned.helmet : true);
    if (already) return false;
    if (this.money < e.price) { this.audio.ui('back'); return false; }
    this.money -= e.price;
    this.owned.armor = e.armor; this.owned.helmet = e.helmet;
    this.player.armor = e.armor; this.player.maxArmor = 100;
    this.hud.setArmor(this.player.armor);
    this.hud.setMoney(this.money);
    this.audio.ui('click');
    return true;
  }
  _applyOwned(refill) {
    const list = [this.owned.primary, this.owned.pistol, 'knife'].filter(Boolean);
    this.weapons.give(list, refill);
  }

  _endRoundWin() {
    this.state = 'roundend';
    this.audio.stinger('win');
    // round-clear cash bonus
    const bonus = 2000 + (this.round - 1) * 300;
    this.money = Math.min(MONEY_MAX, this.money + bonus);
    this.hud.setMoney(this.money);
    this.hud.announce('ROUND CLEARED', `+$${bonus}`, 1800, '#36c46a');
    this._roundCountdown = 7;
    this.menus.showRound({
      title: `ROUND ${this.round} CLEARED`,
      sub: `Reward +$${bonus}`,
      stats: [
        { v: this.round, l: 'ROUND' },
        { v: this.kills, l: 'ROUND KILLS' },
        { v: '$' + this.money, l: 'BALANCE' },
        { v: this.totalKills, l: 'TOTAL KILLS' },
      ],
    });
    this.input.exitLock();
    this.kills = 0;
  }

  _gameOver() {
    this.state = 'dead';
    this._deathTimer = 1.8;
  }

  _showGameOver() {
    this.audio.stinger('lose');
    this.audio.stopAmbient();
    const acc = this.totalKills ? Math.round(this.headshots / this.totalKills * 100) : 0;
    this.menus.showGameOver({
      title: 'YOU WERE ELIMINATED',
      stats: [
        { v: this.round, l: 'REACHED ROUND' },
        { v: this.totalKills, l: 'TOTAL KILLS' },
        { v: this.score, l: 'SCORE' },
        { v: acc + '%', l: 'HS RATE' },
      ],
    });
    this.input.exitLock();
    this.hud.hide();
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.input.exitLock();
    this.menus.show('pause');
  }
  resume() {
    if (this.state !== 'paused') return;
    this.menus.hide('pause');
    this.menus.hide('settings');
    this.state = 'playing';
  }
  quitToMenu() {
    this.state = 'menu';
    this.enemyMgr.clearAll();
    this.audio.stopAmbient();
    this.menus.hideAll();
    this.hud.hide();
    this.menus.show('menu');
  }

  /* --------------------------- difficulty --------------------------- */

  _difficulty(round) {
    const t = Math.min(1, (round - 1) / 9);
    const accuracy = lerp(0.34, 0.82, t);
    return {
      count: Math.min(3 + Math.ceil(round * 1.25), 14),
      health: Math.round(lerp(90, 150, t)),
      accuracy,
      reaction: lerp(0.55, 0.14, t),
      moveSpeed: lerp(3.0, 4.3, t),
      turnSpeed: lerp(2.6, 5.4, t),
      viewDist: lerp(42, 74, t),
      hearing: lerp(16, 30, t),
      memory: lerp(2.2, 4.0, t),
      strafe: 0.55,
      damageMult: lerp(0.6, 1.05, t),
      baseSpread: lerp(0.14, 0.02, accuracy),
      pool: this._enemyPool(round),
      round,
    };
  }

  _enemyPool(round) {
    if (round <= 1) return ['glock', 'mp5'];
    if (round <= 3) return ['mp5', 'glock', 'ak47'];
    if (round <= 5) return ['ak47', 'm4', 'mp5'];
    return ['ak47', 'm4', 'awp', 'shotgun', 'mp5', 'deagle'];
  }

  _prefRange(type) {
    return { sniper: 34, rifle: 16, smg: 9, shotgun: 6, pistol: 11, melee: 2 }[type] || 14;
  }

  _spawnWave(diff) {
    const colors = [0x555a48, 0x4a4234, 0x5a5040, 0x3f4636];
    const used = [];
    for (let i = 0; i < diff.count; i++) {
      const pos = this._pickEnemySpawn(used);
      used.push(pos);
      const wkey = diff.pool[(Math.random() * diff.pool.length) | 0];
      const wpn = WEAPONS[wkey];
      const cfg = {
        health: diff.health,
        accuracy: diff.accuracy,
        reaction: diff.reaction,
        moveSpeed: diff.moveSpeed,
        turnSpeed: diff.turnSpeed,
        viewDist: diff.viewDist,
        hearing: diff.hearing,
        memory: diff.memory,
        strafe: diff.strafe,
        damageMult: diff.damageMult,
        spread: diff.baseSpread * (wpn.type === 'sniper' ? 0.45 : wpn.type === 'shotgun' ? 1.6 : 1),
        preferredRange: this._prefRange(wpn.type),
        weapon: wpn,
        color: colors[(Math.random() * colors.length) | 0],
      };
      this.enemyMgr.spawn(pos, cfg);
    }
  }

  _pickPlayerSpawn() {
    const arr = this.mapInfo.spawnsCT;
    const p = arr[(Math.random() * arr.length) | 0].clone();
    p.y = this.world.groundHeight(p.x, p.z, 30);
    return p;
  }

  _pickEnemySpawn(used) {
    const candidates = this.mapInfo.spawnsT.slice();
    // add some nav points around the far half of the map for variety
    for (let i = 0; i < 6; i++) candidates.push(this.nav.randomPoint());
    let best = null, bestScore = -Infinity;
    const pp = this.player.position;
    for (const c of candidates) {
      const cc = c.clone(); cc.y = this.world.groundHeight(cc.x, cc.z, 30);
      const dPlayer = cc.distanceTo(pp);
      if (dPlayer < 20) continue;
      let dUsed = Infinity;
      for (const u of used) dUsed = Math.min(dUsed, cc.distanceTo(u));
      const score = dPlayer + dUsed * 1.5 + Math.random() * 6;
      if (score > bestScore) { bestScore = score; best = cc; }
    }
    if (!best) { best = this.mapInfo.spawnsT[0].clone(); best.y = this.world.groundHeight(best.x, best.z, 30); }
    return best;
  }

  _zoneName(p) {
    if (p.z < -40) return 'T SPAWN';
    if (p.x > 15) return p.z > 24 ? 'BOMBSITE A' : 'LONG A';
    if (p.x < -13) return p.z > 24 ? 'BOMBSITE B' : 'TUNNELS';
    if (p.z > 30) return 'CT SPAWN';
    return p.z > -2 ? 'MID' : 'T MID';
  }

  /* ------------------------------ update ------------------------------ */

  update(dt) {
    if (!this.built) return;

    if (this.state === 'buy') {
      // freeze time: world holds, only the buy menu ticks
      if (this.frozen && performance.now() >= this._freezeEnd) this.frozen = false;
      this.buyMenu?.update();
      this.hud.setMoney(this.money);
      this.fx.update(dt);
      return;
    }

    if (this.state === 'playing') {
      // end of freeze time -> round goes live
      if (this.frozen && performance.now() >= this._freezeEnd) {
        this.frozen = false;
        this.hud.setFreeze(0);
        this.hud.announce('GO!', 'ROUND LIVE', 900, '#36c46a');
        this.audio.stinger('roundstart');
      }
      const aiming = this.weapons.adsAmount > 0.3 || this.weapons.scoped;
      this.player.update(dt, { aiming, frozen: this.frozen });
      const speed01 = Math.min(1, Math.hypot(this.player.vel.x, this.player.vel.z) / this.player.runSpeed);
      this.weapons.update(dt, speed01, !this.player.onGround, this.frozen);
      this.audio.setListener(this.engine.camera);
      if (!this.frozen) { this.enemyMgr.update(dt, this.player); this._maybePickup(); }
      if (this.frozen) this.hud.setFreeze(Math.max(0, (this._freezeEnd - performance.now()) / 1000));

      // HUD
      this.hud.setHealth(this.player.health);
      this.hud.setArmor(this.player.armor);
      this.hud.setTimer((performance.now() - (this._roundStart || performance.now())) / 1000);
      const fov = this.engine.camera.fov;
      this.hud.setCrosshair(this.weapons.inaccuracy, fov);
      this.hud.updateRadar(this.player, this.enemyMgr.enemies, this.mapInfo.sites);
      this.hud.setEnemies(this.enemyMgr.aliveCount);
      this.hud.setLocation(this._zoneName(this.player.feet));
      this.hud.setBuyTime((!this.frozen && this.canBuy()) ? this.buyTimeLeft() : 0);

      // round end?
      if (this.enemyMgr.aliveCount === 0) {
        this._endDelay += dt;
        if (this._endDelay > 1.2) this._endRoundWin();
      }
      // death?
      if (!this.player.alive) this._gameOver();
    } else if (this.state === 'roundend') {
      // let world keep animating (fx/enemies death anims)
      this.enemyMgr.update(dt, this.player);
      this._roundCountdown -= dt;
      this.menus.updateRoundCountdown(Math.max(0, Math.ceil(this._roundCountdown)));
      if (this._roundCountdown <= 0) this.nextRound();
    } else if (this.state === 'dead') {
      this.player.update(dt, {});
      this.enemyMgr.update(dt, this.player);
      this._deathTimer -= dt;
      if (this._deathTimer <= 0) { this._deathTimer = 1e9; this._showGameOver(); }
    }

    this.fx.update(dt);
  }

  _maybePickup() {
    if (!this.input.pressed('KeyG')) return;
    let best = null, bd = 3.0;
    for (const e of this.enemyMgr.enemies) {
      if (!e.dead) continue;
      const d = e.feet.distanceTo(this.player.position);
      if (d < bd) { bd = d; best = e; }
    }
    if (best) {
      const key = Object.keys(WEAPONS).find(k => WEAPONS[k] === best.cfg.weapon);
      if (key && WEAPONS[key].slot === 1) {
        this.owned.primary = key;
        this._applyOwned(false);
        this.weapons.equip(key);
        this.hud.announce(`PICKED UP ${WEAPONS[key].name}`, '', 900, '#e7c878');
      }
    }
  }
}

function frame() { return new Promise(r => requestAnimationFrame(() => r())); }
