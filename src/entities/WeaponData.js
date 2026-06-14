/**
 * WeaponData — full roster (10 weapons + knife), buy prices, kill rewards,
 * and the buy-menu category layout.
 *
 * recoil model (procedural "spray"): each shot kicks the view up by
 * `kickUp` along a rising pattern and sideways by an oscillating
 * `kickSide`; the view recovers toward centre when not firing.
 */
export const WEAPONS = {
  knife: {
    name: 'KNIFE', slot: 3, type: 'melee', price: 0, killReward: 1500,
    damage: 55, backstab: 180, headshotMult: 2, range: 2.4,
    fireRate: 200, automatic: false,
    magSize: Infinity, reserve: Infinity, reloadTime: 0,
    spread: 0, audio: 'pistol',
    view: { kind: 'knife', accent: 0xcfd3da },
    swapTime: 0.5,
  },

  /* ------------------------------- pistols ------------------------------- */
  glock: {
    name: 'GLOCK-18', slot: 2, type: 'pistol', price: 200, killReward: 300,
    damage: 28, headshotMult: 4, armorPen: 0.5, range: 80,
    falloff: { start: 30, end: 70, min: 0.55 },
    fireRate: 400, automatic: false,
    magSize: 20, reserve: 120, reloadTime: 2.1,
    spread: 0.006, moveSpread: 0.05, jumpSpread: 0.12,
    recoil: { kickUp: 0.011, kickSide: 0.004, recover: 11, rise: 6 },
    audio: 'pistol', view: { kind: 'pistol', variant: 'glock', accent: 0x23252b }, swapTime: 0.7,
  },
  p250: {
    name: 'P250', slot: 2, type: 'pistol', price: 300, killReward: 300,
    damage: 35, headshotMult: 4, armorPen: 0.65, range: 80,
    falloff: { start: 28, end: 62, min: 0.5 },
    fireRate: 400, automatic: false,
    magSize: 13, reserve: 26, reloadTime: 2.2,
    spread: 0.006, moveSpread: 0.05, jumpSpread: 0.12,
    recoil: { kickUp: 0.013, kickSide: 0.005, recover: 11, rise: 5 },
    audio: 'pistol', view: { kind: 'pistol', variant: 'p250', accent: 0x2a2c30 }, swapTime: 0.7,
  },
  fiveseven: {
    name: 'FIVE-SEVEN', slot: 2, type: 'pistol', price: 500, killReward: 300,
    damage: 32, headshotMult: 4, armorPen: 0.9, range: 90,
    falloff: { start: 35, end: 75, min: 0.6 },
    fireRate: 400, automatic: false,
    magSize: 20, reserve: 100, reloadTime: 2.2,
    spread: 0.006, moveSpread: 0.05, jumpSpread: 0.12,
    recoil: { kickUp: 0.012, kickSide: 0.004, recover: 11, rise: 6 },
    audio: 'pistol', view: { kind: 'pistol', variant: 'fiveseven', accent: 0x3a3d42 }, swapTime: 0.75,
  },
  autopistol: {
    name: 'CZ-AUTO', slot: 2, type: 'pistol', price: 500, killReward: 300,
    damage: 24, headshotMult: 4, armorPen: 0.6, range: 70,
    falloff: { start: 22, end: 55, min: 0.5 },
    fireRate: 850, automatic: true,
    magSize: 25, reserve: 75, reloadTime: 2.4,
    spread: 0.01, moveSpread: 0.05, jumpSpread: 0.14,
    recoil: { kickUp: 0.012, kickSide: 0.007, recover: 9, rise: 8 },
    audio: 'pistol', view: { kind: 'pistol', variant: 'auto', accent: 0x1d1f24 }, swapTime: 0.75,
  },
  deagle: {
    name: 'DESERT EAGLE', slot: 2, type: 'pistol', price: 700, killReward: 300,
    damage: 60, headshotMult: 4, armorPen: 0.93, range: 110,
    falloff: { start: 40, end: 90, min: 0.6 },
    fireRate: 250, automatic: false,
    magSize: 7, reserve: 35, reloadTime: 2.5,
    spread: 0.008, moveSpread: 0.07, jumpSpread: 0.2,
    recoil: { kickUp: 0.04, kickSide: 0.012, recover: 6, rise: 2 },
    audio: 'sniper', view: { kind: 'pistol', variant: 'deagle', accent: 0x9aa0a6, mat: 'steel' }, swapTime: 0.85,
  },

  /* ----------------------------- primaries ----------------------------- */
  mp5: {
    name: 'MP5-SD', slot: 1, type: 'smg', price: 1500, killReward: 300,
    damage: 27, headshotMult: 4, armorPen: 0.6, range: 70,
    falloff: { start: 20, end: 55, min: 0.5 },
    fireRate: 800, automatic: true,
    magSize: 30, reserve: 120, reloadTime: 2.3,
    spread: 0.012, moveSpread: 0.03, jumpSpread: 0.13,
    recoil: { kickUp: 0.011, kickSide: 0.006, recover: 9, rise: 9 },
    audio: 'smg', view: { kind: 'smg', variant: 'mp5', accent: 0x26282c }, swapTime: 0.9,
  },
  shotgun: {
    name: 'NOVA', slot: 1, type: 'shotgun', price: 1050, killReward: 900,
    damage: 22, pellets: 8, headshotMult: 2, armorPen: 0.4, range: 35,
    falloff: { start: 8, end: 28, min: 0.15 },
    fireRate: 90, automatic: false,
    magSize: 8, reserve: 32, reloadTime: 0.55, shellReload: true,
    spread: 0.05, moveSpread: 0.04, jumpSpread: 0.1,
    recoil: { kickUp: 0.04, kickSide: 0.012, recover: 6, rise: 2 },
    audio: 'shotgun', view: { kind: 'shotgun', variant: 'nova', accent: 0x5a3a1e }, swapTime: 1.0,
  },
  ak47: {
    name: 'AK-47', slot: 1, type: 'rifle', price: 2700, killReward: 300,
    damage: 36, headshotMult: 4, armorPen: 0.78, range: 95,
    falloff: { start: 40, end: 85, min: 0.6 },
    fireRate: 600, automatic: true,
    magSize: 30, reserve: 90, reloadTime: 2.5,
    spread: 0.009, moveSpread: 0.045, jumpSpread: 0.18,
    recoil: { kickUp: 0.019, kickSide: 0.011, recover: 7.5, rise: 11 },
    audio: 'rifle', view: { kind: 'rifle_ak', variant: 'ak', accent: 0x6b4524 }, swapTime: 1.0,
  },
  m4: {
    name: 'M4A1-S', slot: 1, type: 'rifle', price: 3100, killReward: 300,
    damage: 31, headshotMult: 4, armorPen: 0.72, range: 95,
    falloff: { start: 45, end: 90, min: 0.62 },
    fireRate: 666, automatic: true,
    magSize: 30, reserve: 90, reloadTime: 2.6,
    spread: 0.008, moveSpread: 0.04, jumpSpread: 0.17,
    recoil: { kickUp: 0.014, kickSide: 0.007, recover: 9, rise: 10 },
    audio: 'rifle', view: { kind: 'rifle_m4', variant: 'm4', accent: 0x2c2f2b }, swapTime: 1.0,
  },
  awp: {
    name: 'AWP', slot: 1, type: 'sniper', price: 4750, killReward: 100,
    damage: 120, headshotMult: 2.2, armorPen: 0.95, range: 250,
    falloff: null,
    fireRate: 41, automatic: false,
    magSize: 5, reserve: 30, reloadTime: 3.4,
    spread: 0.0006, moveSpread: 0.18, jumpSpread: 0.3, unscopedSpread: 0.09,
    recoil: { kickUp: 0.05, kickSide: 0.01, recover: 4, rise: 1 },
    scoped: true, scopeFov: 24,
    audio: 'sniper', view: { kind: 'sniper', variant: 'awp', accent: 0x1f2a22 }, swapTime: 1.2,
  },
};

// Equipment (armor) purchasable in the buy menu.
export const EQUIPMENT = {
  kevlar: { name: 'KEVLAR VEST', price: 650, armor: 100, helmet: false },
  kevhelmet: { name: 'KEVLAR + HELMET', price: 1000, armor: 100, helmet: true },
};

// Buy-menu layout: left column then right column, each a list of categories.
export const BUY_LAYOUT = {
  left: [
    { label: 'PISTOLS', kind: 'weapon', items: ['glock', 'p250', 'fiveseven', 'autopistol', 'deagle'] },
    { label: 'EQUIPMENT', kind: 'equip', items: ['kevlar', 'kevhelmet'] },
  ],
  right: [
    { label: 'RIFLES', kind: 'weapon', items: ['ak47', 'm4'] },
    { label: 'HEAVY', kind: 'weapon', items: ['shotgun', 'mp5'] },
    { label: 'SNIPER', kind: 'weapon', items: ['awp'] },
  ],
};

export const MONEY_START = 800;
export const MONEY_MAX = 16000;
