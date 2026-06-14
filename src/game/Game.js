/**
 * Game — CS:GO-style competitive match for 1–2 local (split-screen) humans.
 *
 * Two teams (CT / T). The humans always co-op on team 0; bots fill the rest
 * of team 0 and all of team 1 up to the chosen size (1v1 … 5v5). MR5: rounds
 * 1–5 are the first half, 6–10 the second, sides swap (and economy resets) at
 * halftime. A round is won by wiping the other team; first team to 6 round-wins
 * takes the match (5–5 is a draw). Every round opens with freeze/buy time.
 * Friendly fire is off; allies render blue, enemies red.
 */
import * as THREE from 'three';
import { Forge } from '../core/AssetForge.js';
import { CollisionWorld } from '../world/Collision.js';
import { MapBuilder } from '../world/MapBuilder.js';
import { Nav } from '../world/Nav.js';
import { Player } from '../entities/Player.js';
import { PlayerAvatar } from '../entities/PlayerAvatar.js';
import { WeaponManager } from '../entities/Weapon.js';
import { WEAPONS, EQUIPMENT, MONEY_START, MONEY_MAX } from '../entities/WeaponData.js';
import { Combat } from '../entities/Combat.js';
import { EnemyManager } from '../entities/Enemy.js';
import { FX } from '../fx/FX.js';

const lerp = (a, b, t) => a + (b - a) * t;
const HALF_ROUNDS = 5;       // rounds per half
const MAX_ROUNDS = 10;       // total rounds in a match
const CLINCH = 6;            // round-wins needed to take the match
const ROUND_TIME = 95;       // seconds of live play before CT win by default
const AV_LAYER = 10;         // base render layer for per-player co-op avatars

export class Game {
  constructor(engine, audio) {
    this.engine = engine;
    this.audio = audio;

    this.state = 'menu';        // menu | buy | playing | roundend | matchover | paused
    this.round = 0;
    this.wins = [0, 0];         // round-wins per team (team0 = humans, team1 = bots)
    this.lossStreak = [0, 0];   // consecutive round losses per team (loss-bonus)
    this.totalKills = 0; this.headshots = 0;
    this._roundCountdown = 0; this._endDelay = 0; this._roundResolved = false;
    this.built = false;

    this.players = [];          // human player objects
    this.slots = [];            // available player slots (input/camera/hud/buyMenu)
    this.numHumans = 1; this.numPlayers = 1; this.teamSize = 1;
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
    this._wireCombat();

    onProgress?.(1.0, 'Ready'); await frame();
    this.built = true;
  }

  /* --------------------------- player objects --------------------------- */

  _makePlayer(slot, i) {
    const ent = new Player(slot.camera, slot.input, this.world, this.audio);
    ent.team = 0; ent.isBot = false;
    const weapons = new WeaponManager(this.engine, slot.camera, slot.input, this.audio, ent, this.combat);
    const P = {
      id: i, name: slot.name || ('PLAYER ' + (i + 1)), color: slot.color || 0x39ff8e,
      input: slot.input, camera: slot.camera, hud: slot.hud, buyMenu: slot.buyMenu,
      ent, weapons,
      money: MONEY_START, owned: { primary: null, pistol: 'glock', armor: 0, helmet: false },
      kills: 0, deaths: 0, streak: 0, buyOpen: false, deadHandled: false, lostLoadout: false,
    };
    ent.name = P.name; ent.hudOwner = P;
    weapons.owner = ent;             // combat owner is the combatant entity
    weapons.onAmmoChange = (w, mag, reserve, reloading) => {
      P.hud.setAmmo(w, mag, reserve, reloading);
      P.hud.setWeaponSlots(weapons.available, weapons.current, WEAPONS);
    };
    weapons.onShoot = (w) => { ent.emitNoise(w.type === 'sniper' ? 2.2 : w.type === 'shotgun' ? 1.8 : 1.4); };
    return P;
  }

  byEnt(ent) { return this.players.find(p => p.ent === ent) || this.players[0]; }

  // Third-person bodies so co-op players can see each other. Each avatar is on
  // its own render layer; a player's camera renders every avatar layer except
  // its own, so you see teammates but not your own body.
  _setupAvatars() {
    // reset camera/sun layers to the world-only default
    for (const slot of this.slots) if (slot.camera) slot.camera.layers.set(0);
    this.engine.sun?.layers.set(0);
    if (this.numHumans < 2) return;       // nobody to look at in single-player
    for (let i = 0; i < this.players.length; i++) {
      const P = this.players[i], layer = AV_LAYER + i;
      P.avatar = new PlayerAvatar(this.engine.scene, { color: P.color, name: P.name });
      P.avatar.setLayer(layer);
      P.avatar.show(false);
      this.engine.sun?.layers.enable(layer);                       // cast shadows everyone sees
      for (let j = 0; j < this.players.length; j++) if (j !== i) this.players[j].camera.layers.enable(layer);
    }
  }
  _disposeAvatars() {
    for (const P of this.players) if (P.avatar) { P.avatar.dispose(); P.avatar = null; }
    for (const slot of this.slots) if (slot.camera) slot.camera.layers.set(0);
    this.engine.sun?.layers.set(0);
  }
  _updateAvatars(dt) {
    for (const P of this.players) {
      if (!P.avatar) continue;
      const e = P.ent;
      P.avatar.update(dt, e.feet, e.yaw, e.pitch, e.alive, Math.hypot(e.vel.x, e.vel.z));
    }
  }

  _wireCombat() {
    this.combat.onScope = (owner, on) => { const P = owner && owner.hudOwner; if (P) P.hud.showScope(on); };
    this.combat.onHit = (owner, victim, weapon, headshot, killed) => {
      const shooter = owner && owner.hudOwner;   // human shooter wrapper, else null
      const victimP = victim && victim.hudOwner; // human victim wrapper, else null

      if (shooter) {
        shooter.hud.hitmarker(headshot, killed);
        if (killed) {
          shooter.kills++; shooter.streak++; this.totalKills++; if (headshot) this.headshots++;
          const reward = (weapon.killReward || 300) + (headshot ? 100 : 0);
          shooter.money = Math.min(MONEY_MAX, shooter.money + reward);
          shooter.hud.setMoney(shooter.money); shooter.hud.setStreak(shooter.streak); shooter.hud.moneyGain(reward);
          if (shooter.streak === 3) shooter.hud.announce('TRIPLE KILL', '', 1100, '#ffd23d');
          if (shooter.streak === 5) shooter.hud.announce('ACE IN SIGHT', '', 1300, '#ff7a3d');
        }
      }
      if (victimP) {
        victimP.hud.damageFlash();
        const from = (owner && (owner.eyePos || owner.position)) || victim.eyePos;
        const dir = new THREE.Vector3().subVectors(from, victim.eyePos);
        victimP.hud.damageDirection(Math.atan2(dir.x, -dir.z) - victim.yaw);
        victimP.streak = 0; victimP.hud.setStreak(0);
      }
      if (killed) {
        const actor = owner ? owner.name : 'WORLD';
        const vict = victim ? victim.name : '';
        for (const P of this.players) P.hud.killfeed(actor, vict, weapon.name, headshot);
      }
    };
  }

  /* ------------------------------ sides / teams ------------------------------ */

  _isSecondHalf() { return this.round > HALF_ROUNDS; }
  // Which side a team plays this round (team 0 = CT in the first half).
  _sideOfTeam(team) { const team0CT = !this._isSecondHalf(); return (team === 0) === team0CT ? 'CT' : 'T'; }
  _teamForSide(side) {
    const team0CT = !this._isSecondHalf();
    if (side === 'CT') return team0CT ? 0 : 1;
    return team0CT ? 1 : 0;
  }
  _humanSide() { return this._sideOfTeam(0); }
  _ctWins() { return this.wins[this._teamForSide('CT')]; }
  _tWins() { return this.wins[this._teamForSide('T')]; }

  _allCombatants() { return [...this.players.map(p => p.ent), ...this.enemyMgr.enemies]; }
  _teamAlive(team) { let n = 0; for (const c of this._allCombatants()) if (c.team === team && c.alive) n++; return n; }

  /* ------------------------------ flow ------------------------------ */

  // numPlayers = humans connected; teamSize = 1..5 (clamped to >= humans).
  startMatch(numPlayers = 1, teamSize = numPlayers) {
    this.numHumans = Math.min(numPlayers, this.slots.length);
    this.numPlayers = this.numHumans;
    this.teamSize = Math.max(this.numHumans, Math.min(5, (teamSize | 0) || 1));
    this.engine.setPlayerCount(this.numHumans);

    this._disposeAvatars();
    this.players = [];
    for (let i = 0; i < this.numHumans; i++) this.players.push(this._makePlayer(this.slots[i], i));
    this._setupAvatars();

    this.round = 0; this.wins = [0, 0]; this.lossStreak = [0, 0];
    this.totalKills = 0; this.headshots = 0;
    this.enemyMgr.clearAll();
    for (const P of this.players) {
      P.money = MONEY_START; P.owned = { primary: null, pistol: 'glock', armor: 0, helmet: false };
      P.kills = 0; P.deaths = 0; P.streak = 0; P.lostLoadout = false; P.deadHandled = false;
      P.hud.attach(); P.hud.show(); P.hud.setMap(this.world.boxes, this.mapInfo.bounds);
      P.hud.setMoney(P.money); P.hud.setStreak(0);
      P.hud.setMatchScore(0, 0, this._humanSide());
    }
    this.audio.startAmbient();
    this.nextRound();
  }

  // Back-compat shim (older callers/tests pass just a player count).
  startGame(numPlayers = 1, teamSize) { this.startMatch(numPlayers, teamSize != null ? teamSize : numPlayers); }

  nextRound() {
    this.round++;
    this.menus.hideAll(); this.menus.hideLock();

    const secondHalf = this._isSecondHalf();
    const halftime = (this.round === HALF_ROUNDS + 1);
    const pistolRound = (this.round === 1 || this.round === HALF_ROUNDS + 1);
    if (halftime) {                       // side swap → economy reset
      for (const P of this.players) {
        P.money = MONEY_START; P.owned.primary = null; P.owned.armor = 0; P.owned.helmet = false; P.lostLoadout = false;
      }
      this.lossStreak = [0, 0];
    }

    this.enemyMgr.clearAll();

    // place humans (team 0) at their side spawns
    const team0Side = this._sideOfTeam(0), team1Side = this._sideOfTeam(1);
    const team0Spawns = this._sideSpawns(team0Side);
    this.players.forEach((P, i) => {
      const sp = team0Spawns[i % team0Spawns.length].clone();
      sp.y = this.world.groundHeight(sp.x, sp.z, 30);
      P.ent.reset(sp);
      P.ent.team = 0;
      P.ent.setLookFrom(new THREE.Vector3(0, 1.6, 0));
      if (P.lostLoadout) { P.owned.primary = null; P.owned.armor = 0; P.owned.helmet = false; }
      P.lostLoadout = false;
      P.ent.armor = P.owned.armor;
      P.ent._updateCamera(0.016);
      P.deadHandled = false;
      this._applyOwned(P, true);
      P.weapons.setBaseFov(this.menus.settings.fov);
      P.hud.setRound(this.round); P.hud.setMoney(P.money);
      P.hud.setMatchScore(this._ctWins(), this._tWins(), this._humanSide());
      P.hud.setHalf(secondHalf ? '2ND' : '1ST');
    });

    // fill both teams with bots; both push a single contested site so they clash
    const sites = this.mapInfo.sites;
    this._focusSite = (Math.random() < 0.5 ? sites.A : sites.B).center;
    this._spawnBots(this.teamSize - this.numHumans, 0, team0Side, true, pistolRound, this.numHumans, this._focusSite);
    this._spawnBots(this.teamSize, 1, team1Side, false, pistolRound, 0, this._focusSite);

    this.combat.setCombatants(this._allCombatants());
    for (const P of this.players) P.hud.setAlive(this._teamAlive(this._teamForSide('CT')), this._teamAlive(this._teamForSide('T')));

    this._roundStart = performance.now();
    this._freezeEnd = performance.now() + this.freezeDuration * 1000;
    this._buyEnd = this._freezeEnd; this.frozen = true;
    this._liveEnd = this._freezeEnd + ROUND_TIME * 1000;   // round clock starts after freeze
    this._endDelay = 0; this._roundResolved = false;
    this.audio.stinger('roundstart');
    if (halftime) for (const P of this.players) P.hud.announce('SWITCHING SIDES', `YOU ARE NOW ${this._humanSide()}`, 2400, '#e7c878');
    this.openBuyAll(true);
  }

  _resolveRound(winner) {
    this._roundResolved = true;
    this.state = 'roundend';
    this.wins[winner]++;
    const loser = winner === 0 ? 1 : 0;
    this.lossStreak[winner] = 0;
    this.lossStreak[loser] = Math.min(5, this.lossStreak[loser] + 1);

    // economy: round-win bonus vs escalating loss bonus, plus survival of equipment
    const winReward = 3250, lossReward = 1400 + 500 * (this.lossStreak[loser] - 1);
    for (const P of this.players) {
      const reward = (P.ent.team === winner) ? winReward : lossReward;
      P.money = Math.min(MONEY_MAX, P.money + reward); P.hud.setMoney(P.money);
      if (!P.ent.alive) P.lostLoadout = true;   // dead players re-buy next round
    }

    const winSide = this._sideOfTeam(winner);
    this.audio.stinger(winner === 0 ? 'win' : 'lose');
    for (const P of this.players) {
      const won = P.ent.team === winner;
      P.hud.announce(won ? 'ROUND WON' : 'ROUND LOST', `${winSide} ELIMINATED THE ENEMY`, 2000, won ? '#36c46a' : '#e0413a');
      P.hud.setMatchScore(this._ctWins(), this._tWins(), this._humanSide());
    }

    if (this.wins[winner] >= CLINCH || this.round >= MAX_ROUNDS) { this._matchOver(); return; }

    this._roundCountdown = 6;
    this.menus.showRound({
      title: `${winSide} WIN — ROUND ${this.round}`,
      sub: `MATCH  CT ${this._ctWins()} : ${this._tWins()} T`,
      stats: [
        { v: `${this._ctWins()} : ${this._tWins()}`, l: 'CT : T' },
        { v: `${this.round}/${MAX_ROUNDS}`, l: 'ROUND' },
        { v: `${this.teamSize}v${this.teamSize}`, l: 'FORMAT' },
        { v: this.players.map(p => '$' + p.money).join('  '), l: 'BALANCE' },
      ],
    });
    this._unlockMice();
  }

  _matchOver() {
    this.state = 'matchover';
    const draw = this.wins[0] === this.wins[1];
    const won = this.wins[0] > this.wins[1];
    this.audio.stinger(draw ? 'roundstart' : (won ? 'win' : 'lose'));
    this.audio.stopAmbient();
    this.menus.showGameOver({
      title: draw ? 'MATCH DRAWN' : (won ? 'VICTORY' : 'DEFEAT'),
      stats: [
        { v: `${this.wins[0]} : ${this.wins[1]}`, l: 'YOUR TEAM : ENEMY' },
        { v: `${this.teamSize}v${this.teamSize}`, l: 'FORMAT' },
        { v: this.totalKills, l: 'TEAM KILLS' },
        { v: this.players.map(p => `${p.kills}/${p.deaths}`).join('  '), l: 'K / D' },
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
    this._disposeAvatars();
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

  /* --------------------------- bot loadouts / spawns --------------------------- */

  _prefRange(type) { return { sniper: 34, rifle: 16, smg: 9, shotgun: 6, pistol: 11, melee: 2 }[type] || 14; }

  _botWeapon(pistolRound) {
    if (pistolRound) return Math.random() < 0.28 ? 'p250' : 'glock';
    const r = Math.random();
    if (r < 0.1) return 'awp';
    if (r < 0.2) return 'shotgun';
    if (r < 0.32) return 'mp5';
    return ['ak47', 'm4', 'ak47', 'm4'][(Math.random() * 4) | 0];
  }

  // Fixed-skill bots (medium). `friendly` controls blue/red readability + side tint.
  _botConfig(wkey, team, friendly, side, objective) {
    const wpn = WEAPONS[wkey];
    const t = 0.62;                                   // fixed skill
    const accuracy = lerp(0.34, 0.82, t);
    const CT = [0x8c98a6, 0x76828f, 0x6b7886];     // CT-side fatigue tints
    const T = [0x6e5a3a, 0x7a6038, 0x5f5030];      // T-side fatigue tints
    const tint = (side === 'CT' ? CT : T);
    return {
      health: 100, accuracy,
      reaction: lerp(0.55, 0.16, t), moveSpeed: lerp(3.0, 4.2, t),
      turnSpeed: lerp(2.6, 5.2, t), viewDist: lerp(46, 72, t),
      hearing: lerp(18, 30, t), memory: lerp(2.4, 4.0, t), strafe: 0.55,
      damageMult: 1.0,
      spread: lerp(0.13, 0.02, accuracy) * (wpn.type === 'sniper' ? 0.45 : wpn.type === 'shotgun' ? 1.6 : 1),
      preferredRange: this._prefRange(wpn.type), weapon: wpn,
      team, friendly, name: friendly ? 'ALLY' : 'ENEMY',
      objective: objective ? objective.clone() : null,
      color: tint[(Math.random() * tint.length) | 0],
    };
  }

  _spawnBots(count, team, side, friendly, pistolRound, startIndex = 0, objective = null) {
    if (count <= 0) return;
    const spawns = this._sideSpawns(side);
    for (let i = 0; i < count; i++) {
      const base = spawns[(startIndex + i) % spawns.length].clone();
      base.x += (Math.random() - 0.5) * 2.5; base.z += (Math.random() - 0.5) * 2.5;
      base.y = this.world.groundHeight(base.x, base.z, 30);
      const cfg = this._botConfig(this._botWeapon(pistolRound), team, friendly, side, objective);
      this.enemyMgr.spawn(base, cfg);
    }
  }

  _sideSpawns(side) {
    return (side === 'CT' ? this.mapInfo.spawnsCT : this.mapInfo.spawnsT).slice();
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
      // buy/freeze time over → auto-deploy anyone still in the menu so the round can start
      if (!this.canBuy()) for (const P of this.players) if (P.buyOpen) this.closeBuy(P);
      this._updateAvatars(dt);
      this.fx.update(dt);
      return;
    }

    if (this.state === 'playing') {
      if (this.frozen && performance.now() >= this._freezeEnd) {
        this.frozen = false;
        for (const P of this.players) { P.hud.setFreeze(0); P.hud.announce('GO!', '', 700, '#36c46a'); }
        this.audio.stinger('roundstart');
      }
      for (const P of this.players) {
        P.input.update?.(dt);
        if (this.frozen && P.input.pressed && P.input.pressed('KeyB') && !P.buyOpen) this.openBuy(P);
        if (!P.ent.alive) {
          if (!P.deadHandled) {
            P.deadHandled = true; P.deaths++; P.streak = 0; P.hud.setStreak(0);
            P.hud.announce('ELIMINATED', 'Spectating — round in progress', 2000, '#e0413a');
          }
          P.ent.update(dt, {});      // keep falling camera
          continue;
        }
        const aiming = P.weapons.adsAmount > 0.3 || P.weapons.scoped;
        P.ent.update(dt, { aiming, frozen: this.frozen });
        const speed01 = Math.min(1, Math.hypot(P.ent.vel.x, P.ent.vel.z) / P.ent.runSpeed);
        P.weapons.update(dt, speed01, !P.ent.onGround, this.frozen);
        P.hud.setHealth(P.ent.health); P.hud.setArmor(P.ent.armor);
        const remain = this.frozen ? Math.max(0, (this._freezeEnd - performance.now()) / 1000)
                                   : Math.max(0, (this._liveEnd - performance.now()) / 1000);
        P.hud.setTimer(remain);
        P.hud.setCrosshair(P.weapons.inaccuracy, P.camera.fov);
        P.hud.updateRadar(P.ent, this.enemyMgr.enemies, this.mapInfo.sites);
        P.hud.setLocation(this._zoneName(P.ent.feet));
        if (this.frozen) P.hud.setFreeze(Math.max(0, (this._freezeEnd - performance.now()) / 1000));
      }
      this.audio.setListener(this.players[0].camera);
      this._updateAvatars(dt);
      if (!this.frozen) { this.enemyMgr.update(dt, this._allCombatants()); this._maybePickup(); }
      const ctAlive = this._teamAlive(this._teamForSide('CT')), tAlive = this._teamAlive(this._teamForSide('T'));
      for (const P of this.players) { P.hud.setMatchScore(this._ctWins(), this._tWins(), this._humanSide()); P.hud.setAlive(ctAlive, tAlive); }
      for (const P of this.players) P.input.endFrame?.();

      // round resolution: a whole team wiped → the other team scores
      if (!this._roundResolved && !this.frozen) {
        const a0 = this._teamAlive(0), a1 = this._teamAlive(1);
        let winner = -1;
        if (a1 === 0 && a0 > 0) winner = 0;
        else if (a0 === 0 && a1 > 0) winner = 1;
        else if (a0 === 0 && a1 === 0) winner = 0;       // simultaneous (rare) → CT-team
        if (winner >= 0) { this._endDelay += dt; if (this._endDelay > 1.0) this._resolveRound(winner); }
        else if (performance.now() >= this._liveEnd) this._resolveRound(this._teamForSide('CT')); // time up → defenders hold
        else this._endDelay = 0;
      }

    } else if (this.state === 'roundend') {
      this.enemyMgr.update(dt, []);     // freeze bot fire, keep death anims / idle
      for (const P of this.players) P.ent.update(dt, { frozen: P.ent.alive });
      this._updateAvatars(dt);
      this._roundCountdown -= dt;
      this.menus.updateRoundCountdown(Math.max(0, Math.ceil(this._roundCountdown)));
      if (this._roundCountdown <= 0) this.nextRound();
    } else if (this.state === 'matchover') {
      this.enemyMgr.update(dt, []);
      for (const P of this.players) P.ent.update(dt, {});
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
