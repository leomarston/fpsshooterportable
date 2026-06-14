/**
 * WeaponData — stats for every weapon. Original archetype names.
 *
 * Damage, fire rate, magazines, reload, spread and recoil are tuned to
 * feel like their CS counterparts: a high-damage hard-kicking rifle, a
 * controllable lower-damage rifle, a one-shot bolt-action sniper, fast
 * SMG, punchy pistol, spread shotgun and a melee knife.
 *
 * recoil model (procedural "spray"):
 *   each shot pushes the view up by `kickUp` (scaled along a rising
 *   pattern) and sideways by an oscillating `kickSide`; the view
 *   recovers toward centre when not firing.
 */
export const WEAPONS = {
  knife: {
    name: 'KNIFE', slot: 3, type: 'melee',
    damage: 55, backstab: 180, headshotMult: 2, range: 2.4,
    fireRate: 200, automatic: false,
    magSize: Infinity, reserve: Infinity, reloadTime: 0,
    spread: 0, audio: 'pistol',
    view: { kind: 'knife', accent: 0xcfd3da },
    swapTime: 0.5,
  },
  pistol: {
    name: 'M9 SIDEARM', slot: 2, type: 'pistol',
    damage: 30, headshotMult: 4, armorPen: 0.5, range: 80,
    falloff: { start: 30, end: 70, min: 0.55 },
    fireRate: 400, automatic: false,
    magSize: 20, reserve: 120, reloadTime: 1.9,
    spread: 0.006, moveSpread: 0.05, jumpSpread: 0.12,
    recoil: { kickUp: 0.012, kickSide: 0.004, recover: 11, rise: 6 },
    audio: 'pistol',
    view: { kind: 'pistol', accent: 0x2b2d31 },
    swapTime: 0.7,
  },
  smg: {
    name: 'MP-K', slot: 1, type: 'smg',
    damage: 26, headshotMult: 4, armorPen: 0.6, range: 70,
    falloff: { start: 20, end: 55, min: 0.5 },
    fireRate: 750, automatic: true,
    magSize: 30, reserve: 120, reloadTime: 2.3,
    spread: 0.012, moveSpread: 0.03, jumpSpread: 0.13,
    recoil: { kickUp: 0.011, kickSide: 0.006, recover: 9, rise: 9 },
    audio: 'smg',
    view: { kind: 'smg', accent: 0x26282c },
    swapTime: 0.9,
  },
  ar47: {
    name: 'AR-47', slot: 1, type: 'rifle',
    damage: 36, headshotMult: 4, armorPen: 0.78, range: 90,
    falloff: { start: 40, end: 85, min: 0.6 },
    fireRate: 600, automatic: true,
    magSize: 30, reserve: 90, reloadTime: 2.5,
    spread: 0.009, moveSpread: 0.045, jumpSpread: 0.18,
    recoil: { kickUp: 0.019, kickSide: 0.011, recover: 7.5, rise: 11 },
    audio: 'rifle',
    view: { kind: 'rifle_ak', accent: 0x6b4524 },
    swapTime: 1.0,
  },
  m4x: {
    name: 'M4-X', slot: 1, type: 'rifle',
    damage: 31, headshotMult: 4, armorPen: 0.7, range: 90,
    falloff: { start: 45, end: 90, min: 0.62 },
    fireRate: 666, automatic: true,
    magSize: 30, reserve: 90, reloadTime: 2.6,
    spread: 0.008, moveSpread: 0.04, jumpSpread: 0.17,
    recoil: { kickUp: 0.014, kickSide: 0.007, recover: 9, rise: 10 },
    audio: 'rifle',
    view: { kind: 'rifle_m4', accent: 0x2c2f2b },
    swapTime: 1.0,
  },
  sniper: {
    name: 'AWM-X', slot: 1, type: 'sniper',
    damage: 120, headshotMult: 2.2, armorPen: 0.95, range: 200,
    falloff: null,
    fireRate: 41, automatic: false,
    magSize: 5, reserve: 30, reloadTime: 3.4,
    spread: 0.0006, moveSpread: 0.18, jumpSpread: 0.3,
    unscopedSpread: 0.09,
    recoil: { kickUp: 0.05, kickSide: 0.01, recover: 4, rise: 1 },
    scoped: true, scopeFov: 28,
    audio: 'sniper',
    view: { kind: 'sniper', accent: 0x1f2a22 },
    swapTime: 1.2,
  },
  shotgun: {
    name: 'BREACHER', slot: 1, type: 'shotgun',
    damage: 22, pellets: 8, headshotMult: 2, armorPen: 0.4, range: 35,
    falloff: { start: 8, end: 28, min: 0.15 },
    fireRate: 90, automatic: false,
    magSize: 8, reserve: 32, reloadTime: 0.55, shellReload: true,
    spread: 0.05, moveSpread: 0.04, jumpSpread: 0.1,
    recoil: { kickUp: 0.04, kickSide: 0.012, recover: 6, rise: 2 },
    audio: 'shotgun',
    view: { kind: 'shotgun', accent: 0x5a3a1e },
    swapTime: 1.0,
  },
};

// Default player loadout (primary slot decided per round / pickups).
export const LOADOUT_PROGRESSION = ['smg', 'ar47', 'm4x', 'sniper', 'shotgun'];
