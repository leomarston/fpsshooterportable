/**
 * Game — orchestrates the match for 1 or 2 local (split-screen) players.
 *
 * Builds the shared world (map, navmesh, enemies) once; each player has
 * its own Player entity, weapons, camera, input, HUD, buy menu and
 * economy. Co-op rounds: clear every hostile to win; both players respawn
 * each round; a downed player spectates until the round ends; the run
 * ends only when every player is down.
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
  constructor(engine, audio) {
    this.engine = engine;
    this.audio = audio;

    this.state = 'menu';        // menu | buy | playing | roundend | dead | paused
    this.round = 0;
    this.totalKills = 0; this.headshots = 0;
    this._roundCountdown = 0; this._deathTimer = 0; this._endDelay = 0;
    this.built = false;

    this.players = [];          // active player objects
    this.slots = [];            // available player slots (input/camera/hud/buyMenu)
    this.numPlayers = 1;
    this.menus = null;          // set by main

    this._freezeEnd = 0; this._buyEnd = 0; this.frozen = false;
    this.freezeDuration = 10;
  }

  // main.js provides per-player UI/input slots: {input, camera, hud, buyMenu, name, color}
  configureSlots(slots) { this.slots = slots; }

  async build(onProgress) {
    const scene = this.engine.scene;
    onProgress?.(0.1, 'Forging materials…'); await frame();
    this.world = new CollisionWorld();
    this.fx = new FX(scene);
    this.map = new MapBuilder(scene, this.world, Forge);
    onProgress?.(0.25, 'Building the site…'); await frame();
    this.mapInfo = this.map.build();
    onProgress?.(0.6, 'Baking navigation…'); await frame();
    this.nav = new Nav(this.world, this.mapInfo.bounds, 1.6);
    onProgress?.(0.8, 'Arming operators…'); await frame();

    this.combat = new Combat(this.world, this.fx, this.audio);
    this.enemyMgr = new EnemyManager(scene, this.world, this.nav, this.audio, this.fx, this.combat, this.engine.camera);
    this.combat.setEnemies(this.enemyMgr);
    this._wireCombat();

    onProgress?.(1.0, 'Ready'); await frame();
    this.built = true;
  }

  /* --------------------------- player objects --------------------------- */

  _makePlayer(slot, i) {
    const ent = new Player(slot.camera, slot.input, this.world, this.audio);
    const weapons = new WeaponManager(this.engine, slot.camera, slot.input, this.audio, ent, this.combat);
    const P = {
      id: i, name: slot.name || ('PLAYER ' + (i + 1)), color: slot.color || 0x39ff8e,
      input: slot.input, camera: slot.camera, hud: slot.hud, buyMenu: slot.buyMenu,
      ent, weapons,
      money: MONEY_START, owned: { primary: null, pistol: 'glock', armor: 0, helmet: false },
      kills: 0, streak: 0, buyOpen: false, deadHandled: false,
    };
    weapons.owner = P;
    weapons.onAmmoChange = (w, mag, reserve, reloading) => {
      P.hud.setAmmo(w, mag, reserve, reloading);
      P.hud.setWeaponSlots(weapons.available, weapons.current, WEAPONS);
    };
    weapons.onShoot = (w) => { ent.emitNoise(w.type === 'sniper' ? 2.2 : w.type === 'shotgun' ? 1.8 : 1.4); };
    return P;
  }

  byOwner(owner) { return owner || this.players[0]; }
  byEnt(ent) { return this.players.find(p => p.ent === ent) || this.players[0]; }

  _wireCombat() {
    this.combat.onHitmarker = (owner, headshot, killed) => this.byOwner(owner).hud.hitmarker(headshot, killed);
    this.combat.onScope = (owner, on) => this.byOwner(owner).hud.showScope(on);
    this.combat.onKill = (owner, enemy, weapon, headshot) => {
      const P = this.byOwner(owner);
      P.kills++; P.streak++; this.totalKills++; if (headshot) this.headshots++;
      const reward = (weapon.killReward || 300) + (headshot ? 100 : 0);
      P.money = Math.min(MONEY_MAX, P.money + reward);
      P.hud.setKills(P.kills); P.hud.setMoney(P.money); P.hud.setStreak(P.streak); P.hud.moneyGain(reward);
      P.hud.killfeed(P.name, 'HOSTILE', weapon.name, headshot);
      for (const q of this.players) q.hud.setEnemies(this.enemyMgr.aliveCount);
      if (P.streak === 3) P.hud.announce('TRIPLE KILL', '', 1100, '#ffd23d');
      if (P.streak === 5) P.hud.announce('RAMPAGE', '', 1300, '#ff7a3d');
    };
    this.combat.onPlayerHit = (ent, dmg, fromPos, headshot) => {
      const P = this.byEnt(ent);
      P.hud.damageFlash();
      const dir = new THREE.Vector3().subVectors(fromPos, ent.eyePos);
      P.hud.damageDirection(Math.atan2(dir.x, -dir.z) - ent.yaw);
      P.streak = 0; P.hud.setStreak(0);
    };
  }

  /* ------------------------------ flow ------------------------------ */

  startGame(numPlayers = 1) {
    this.numPlayers = Math.min(numPlayers, this.slots.length);
    this.engine.setPlayerCount(this.numPlayers);
    // (re)build player objects
    this.players = [];
    for (let i = 0; i < this.numPlayers; i++) this.players.push(this._makePlayer(this.slots[i], i));
    this.combat.setPlayers(this.players.map(p => p.ent));
    this.enemyMgr.players = this.players.map(p => p.ent);
    this.round = 0; this.totalKills = 0; this.headshots = 0;
    this.enemyMgr.clearAll();
    for (const P of this.players) {
      P.money = MONEY_START; P.owned = { primary: null, pistol: 'glock', armor: 0, helmet: false };
      P.kills = 0; P.streak = 0;
      P.hud.attach(); P.hud.show(); P.hud.setMap(this.world.boxes, this.mapInfo.bounds);
      P.hud.setKills(0); P.hud.setMoney(P.money); P.hud.setStreak(0);
    }
    this.audio.startAmbient();
    this.nextRound();
  }

  nextRound() {
    this.round++;
    this.menus.hideAll(); this.menus.hideLock();
    // spawn + heal + loadout each player
    const spawns = this._pickPlayerSpawns();
    this.players.forEach((P, i) => {
      P.ent.reset(spawns[i]);
      P.ent.setLookFrom(new THREE.Vector3(0, 1.6, 0));
      P.ent.armor = P.owned.armor;
      P.ent._updateCamera(0.016);
      P.deadHandled = false;
      this._applyOwned(P, true);
      P.weapons.setBaseFov(this.menus.settings.fov);
      P.hud.setRound(this.round); P.hud.setMoney(P.money);
    });

    const diff = this._difficulty(this.round);
    this._spawnWave(diff);
    for (const P of this.players) P.hud.setEnemies(this.enemyMgr.aliveCount);

    this._roundStart = performance.now();
    this._freezeEnd = performance.now() + this.freezeDuration * 1000;
    this._buyEnd = this._freezeEnd; this.frozen = true;
    this.audio.stinger('roundstart');
    this._endDelay = 0;
    this.openBuyAll(true);
  }

  _endRoundWin() {
    this.state = 'roundend';
    this.audio.stinger('win');
    const bonus = 2000 + (this.round - 1) * 300;
    for (const P of this.players) {
      if (P.ent.alive) { P.money = Math.min(MONEY_MAX, P.money + bonus); P.hud.setMoney(P.money); }
      P.hud.announce('ROUND CLEARED', P.ent.alive ? `+$${bonus}` : 'RESPAWNING…', 1800, '#36c46a');
    }
    this._roundCountdown = 7;
    const P0 = this.players[0];
    this.menus.showRound({
      title: `ROUND ${this.round} CLEARED`, sub: `Reward +$${bonus}`,
      stats: [
        { v: this.round, l: 'ROUND' },
        { v: this.totalKills, l: 'TOTAL KILLS' },
        { v: this.players.map(p => '$' + p.money).join('  '), l: 'BALANCE' },
        { v: this.numPlayers, l: 'PLAYERS' },
      ],
    });
    this._unlockMice();
    for (const P of this.players) P.kills = 0;
  }

  _gameOver() { this.state = 'dead'; this._deathTimer = 1.8; }

  _showGameOver() {
    this.audio.stinger('lose'); this.audio.stopAmbient();
    this.menus.showGameOver({
      title: this.numPlayers > 1 ? 'SQUAD ELIMINATED' : 'YOU WERE ELIMINATED',
      stats: [
        { v: this.round, l: 'REACHED ROUND' },
        { v: this.totalKills, l: 'TOTAL KILLS' },
        { v: this.players.map(p => p.kills).join(' / '), l: 'KILLS' },
        { v: this.numPlayers, l: 'PLAYERS' },
      ],
    });
    this._unlockMice();
    for (const P of this.players) P.hud.hide();
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused'; this._unlockMice(); this.menus.show('pause');
  }
  resume() {
    if (this.state !== 'paused') return;
    this.menus.hide('pause'); this.menus.hide('settings'); this.state = 'playing';
  }
  quitToMenu() {
    this.state = 'menu'; this.enemyMgr.clearAll(); this.audio.stopAmbient();
    this.menus.hideAll();
    for (const P of this.players) { P.hud.hide(); P.buyMenu.close(); }
    this.engine.setPlayerCount(1);
    this.menus.show('menu');
  }

  /* ------------------------------ economy / buy ------------------------------ */

  canBuy() { return (this._buyEnd - performance.now()) > 0; }
  buyTimeLeft() { return Math.max(0, (this._buyEnd - performance.now()) / 1000); }

  openBuyAll(roundStart = false) {
    this.state = 'buy';
    for (const P of this.players) this.openBuy(P, roundStart);
  }
  openBuy(P, roundStart = false) {
    if (P.buyOpen) return;
    if (!roundStart && !this.canBuy()) { P.hud.announce('BUY TIME OVER', '', 800, '#e0413a'); return; }
    P.buyOpen = true; P.hud.setFreeze(0);
    if (P.input.requestLock && P.id === 0) P.input.exitLock();
    P.buyMenu.open(P, this);
  }
  closeBuy(P) {
    if (!P.buyOpen) return;
    P.buyOpen = false; P.buyMenu.close();
    if (this.players.every(q => !q.buyOpen)) this.state = 'playing';
    if (P.id === 0 && P.input.requestLock) P.input.requestLock();
  }

  buyWeapon(P, key) {
    const w = WEAPONS[key];
    if (!w || !this.canBuy()) return false;
    if ((w.slot === 1 && P.owned.primary === key) || (w.slot === 2 && P.owned.pistol === key)) return false;
    if (P.money < w.price) { this.audio.ui('back'); return false; }
    P.money -= w.price;
    if (w.slot === 1) P.owned.primary = key; else if (w.slot === 2) P.owned.pistol = key;
    this._applyOwned(P, false); P.weapons.equip(key);
    P.hud.setMoney(P.money); this.audio.ui('click');
    return true;
  }
  buyArmor(P, kind) {
    const e = EQUIPMENT[kind];
    if (!e || !this.canBuy()) return false;
    const already = P.owned.armor >= 100 && (e.helmet ? P.owned.helmet : true);
    if (already) return false;
    if (P.money < e.price) { this.audio.ui('back'); return false; }
    P.money -= e.price; P.owned.armor = e.armor; P.owned.helmet = e.helmet;
    P.ent.armor = e.armor; P.ent.maxArmor = 100;
    P.hud.setArmor(P.ent.armor); P.hud.setMoney(P.money); this.audio.ui('click');
    return true;
  }
  _applyOwned(P, refill) {
    P.weapons.give([P.owned.primary, P.owned.pistol, 'knife'].filter(Boolean), refill);
  }
  _unlockMice() { for (const P of this.players) if (P.input.exitLock) P.input.exitLock(); }

  /* --------------------------- difficulty / spawns --------------------------- */

  _difficulty(round) {
    const t = Math.min(1, (round - 1) / 9);
    const accuracy = lerp(0.34, 0.82, t);
    return {
      count: Math.min(3 + Math.ceil(round * 1.25) + (this.numPlayers - 1) * 2, 16),
      health: Math.round(lerp(90, 150, t)), accuracy,
      reaction: lerp(0.55, 0.14, t), moveSpeed: lerp(3.0, 4.3, t),
      turnSpeed: lerp(2.6, 5.4, t), viewDist: lerp(42, 74, t),
      hearing: lerp(16, 30, t), memory: lerp(2.2, 4.0, t), strafe: 0.55,
      damageMult: lerp(0.6, 1.05, t), baseSpread: lerp(0.14, 0.02, accuracy),
      pool: this._enemyPool(round), round,
    };
  }
  _enemyPool(round) {
    if (round <= 1) return ['glock', 'mp5'];
    if (round <= 3) return ['mp5', 'glock', 'ak47'];
    if (round <= 5) return ['ak47', 'm4', 'mp5'];
    return ['ak47', 'm4', 'awp', 'shotgun', 'mp5', 'deagle'];
  }
  _prefRange(type) { return { sniper: 34, rifle: 16, smg: 9, shotgun: 6, pistol: 11, melee: 2 }[type] || 14; }

  _spawnWave(diff) {
    const colors = [0x555a48, 0x4a4234, 0x5a5040, 0x3f4636];
    const used = [];
    for (let i = 0; i < diff.count; i++) {
      const pos = this._pickEnemySpawn(used); used.push(pos);
      const wkey = diff.pool[(Math.random() * diff.pool.length) | 0];
      const wpn = WEAPONS[wkey];
      this.enemyMgr.spawn(pos, {
        health: diff.health, accuracy: diff.accuracy, reaction: diff.reaction,
        moveSpeed: diff.moveSpeed, turnSpeed: diff.turnSpeed, viewDist: diff.viewDist,
        hearing: diff.hearing, memory: diff.memory, strafe: diff.strafe, damageMult: diff.damageMult,
        spread: diff.baseSpread * (wpn.type === 'sniper' ? 0.45 : wpn.type === 'shotgun' ? 1.6 : 1),
        preferredRange: this._prefRange(wpn.type), weapon: wpn,
        color: colors[(Math.random() * colors.length) | 0],
      });
    }
  }

  _pickPlayerSpawns() {
    const arr = this.mapInfo.spawnsCT.slice();
    const out = [];
    for (let i = 0; i < this.numPlayers; i++) {
      const p = (arr[i % arr.length] || arr[0]).clone();
      p.y = this.world.groundHeight(p.x, p.z, 30); out.push(p);
    }
    return out;
  }
  _minDistToPlayers(pos) {
    let d = Infinity; for (const P of this.players) d = Math.min(d, pos.distanceTo(P.ent.position)); return d;
  }
  _pickEnemySpawn(used) {
    const candidates = this.mapInfo.spawnsT.slice();
    for (let i = 0; i < 6; i++) candidates.push(this.nav.randomPoint());
    let best = null, bestScore = -Infinity;
    for (const c of candidates) {
      const cc = c.clone(); cc.y = this.world.groundHeight(cc.x, cc.z, 30);
      const dPlayer = this._minDistToPlayers(cc);
      if (dPlayer < 18) continue;
      let dUsed = Infinity; for (const u of used) dUsed = Math.min(dUsed, cc.distanceTo(u));
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
      if (this.frozen && performance.now() >= this._freezeEnd) this.frozen = false;
      for (const P of this.players) { P.input.update?.(dt); if (P.buyOpen) P.buyMenu.update(); P.input.endFrame?.(); }
      this.fx.update(dt);
      return;
    }

    if (this.state === 'playing') {
      if (this.frozen && performance.now() >= this._freezeEnd) {
        this.frozen = false;
        for (const P of this.players) { P.hud.setFreeze(0); P.hud.announce('GO!', 'ROUND LIVE', 800, '#36c46a'); }
        this.audio.stinger('roundstart');
      }
      // per-player update
      for (const P of this.players) {
        P.input.update?.(dt);
        // a player who pressed buy reopens their menu
        if (this.frozen && P.input.pressed && P.input.pressed('KeyB') && !P.buyOpen) this.openBuy(P);
        if (!P.ent.alive) {
          if (!P.deadHandled) { P.deadHandled = true; P.hud.announce('ELIMINATED', 'Respawn next round', 2200, '#e0413a'); }
          P.ent.update(dt, {}); // keep falling camera
          continue;
        }
        const aiming = P.weapons.adsAmount > 0.3 || P.weapons.scoped;
        P.ent.update(dt, { aiming, frozen: this.frozen });
        const speed01 = Math.min(1, Math.hypot(P.ent.vel.x, P.ent.vel.z) / P.ent.runSpeed);
        P.weapons.update(dt, speed01, !P.ent.onGround, this.frozen);
        // HUD
        P.hud.setHealth(P.ent.health); P.hud.setArmor(P.ent.armor);
        P.hud.setTimer((performance.now() - (this._roundStart || performance.now())) / 1000);
        P.hud.setCrosshair(P.weapons.inaccuracy, P.camera.fov);
        P.hud.updateRadar(P.ent, this.enemyMgr.enemies, this.mapInfo.sites);
        P.hud.setEnemies(this.enemyMgr.aliveCount);
        P.hud.setLocation(this._zoneName(P.ent.feet));
        if (this.frozen) P.hud.setFreeze(Math.max(0, (this._freezeEnd - performance.now()) / 1000));
      }
      this.audio.setListener(this.players[0].camera);
      if (!this.frozen) { this.enemyMgr.update(dt, this.players.map(p => p.ent)); this._maybePickup(); }
      for (const P of this.players) P.input.endFrame?.();

      // round end / game over
      if (this.enemyMgr.aliveCount === 0) {
        this._endDelay += dt;
        if (this._endDelay > 1.2) this._endRoundWin();
      }
      if (this.players.every(P => !P.ent.alive)) this._gameOver();

    } else if (this.state === 'roundend') {
      this.enemyMgr.update(dt, this.players.map(p => p.ent));
      this._roundCountdown -= dt;
      this.menus.updateRoundCountdown(Math.max(0, Math.ceil(this._roundCountdown)));
      if (this._roundCountdown <= 0) this.nextRound();
    } else if (this.state === 'dead') {
      for (const P of this.players) P.ent.update(dt, {});
      this.enemyMgr.update(dt, this.players.map(p => p.ent));
      this._deathTimer -= dt;
      if (this._deathTimer <= 0) { this._deathTimer = 1e9; this._showGameOver(); }
    }

    this.fx.update(dt);
  }

  _maybePickup() {
    for (const P of this.players) {
      if (!P.ent.alive || !(P.input.pressed && P.input.pressed('KeyG'))) continue;
      let best = null, bd = 3.0;
      for (const e of this.enemyMgr.enemies) {
        if (!e.dead) continue;
        const d = e.feet.distanceTo(P.ent.position);
        if (d < bd) { bd = d; best = e; }
      }
      if (best) {
        const key = Object.keys(WEAPONS).find(k => WEAPONS[k] === best.cfg.weapon);
        if (key && WEAPONS[key].slot === 1) {
          P.owned.primary = key; this._applyOwned(P, false); P.weapons.equip(key);
          P.hud.announce(`PICKED UP ${WEAPONS[key].name}`, '', 900, '#e7c878');
        }
      }
    }
  }

  // render views for the engine
  views() { return this.players.map(P => ({ camera: P.camera, vmScene: P.weapons.vmScene })); }
}

function frame() { return new Promise(r => requestAnimationFrame(() => r())); }
