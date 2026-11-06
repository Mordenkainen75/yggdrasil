import { GAS, RAVENS, BERSERK, SAGA, RUNES, PERKS, REGION, THUNDER, UPGRADES, SHIP, type RuneId, type PerkId, type UpgradeDef, type UpgradeId } from './config.ts';
import { makeRegion } from './region.ts';
import { SAGA_READY, offlineCapSeconds, offlineShare, placeShip, zeroRunes, zeroUpgrades, type GameState } from './state.ts';

export interface Stats {
  drillDamage: number;
  drillRate: number;
  speed: number;
  segments: number;
  grindDamage: number;
  silverMul: number;
  thunderCooldown: number;
  thunderDamage: number;
  ravenCount: number;
  ravenDamage: number;
  blastRings: number;
  blastMul: number;
  thunderRings: number;
  rockPayMul: number;
  goldPayMul: number;
  goldPull: number;
  corePayMul: number;
  coreSeekAt: number;
  collapseValue: number;
  berserkSeconds: number;
  berserkPayMul: number;
  berserkCharge: number;
  meadBursts: boolean;
}

const milestone = (level: number) => 1.6 ** Math.floor(level / 25);

export function computeStats(s: GameState): Stats {
  const u = s.upgrades;
  const m = s.runes;
  const berserk = s.berserkLeft > 0;
  const baseDamage = (1 + 0.7 * u.drill) * milestone(u.drill) * (1 + 0.3 * s.perks.steel);
  const drillDamage = baseDamage * 0.85 ** m.kenaz * 0.7 ** m.thurisaz * 2.5 ** m.uruz;
  const meta = 1 + 0.05 * u.forge;
  const berserkSeconds = BERSERK.seconds * 1.6 ** m.wunjo;
  return {
    drillDamage,
    drillRate: SHIP.drillRate * meta * 0.75 ** m.ansuz * (berserk ? BERSERK.drillMul : 1),
    speed: SHIP.baseSpeed * (1 + 0.015 * u.forge) * 0.85 ** m.hagalaz * 0.7 ** m.uruz * (berserk ? BERSERK.speedMul : 1),
    segments: SHIP.baseSegments + u.haulers,
    // Cutting, thunder and ravens scale from the unmodified drill, so a drill
    // penalty stays a penalty on drilling and these builds stand on their own.
    grindDamage: baseDamage * SHIP.grindShare * 3 ** m.thurisaz,
    silverMul: (1 + 0.3 * u.smelter) * milestone(u.smelter) * (1 + 0.3 * s.perks.hoard) * 1.4 ** m.jera,
    thunderCooldown: Math.max(THUNDER.minCooldown, THUNDER.baseCooldown * THUNDER.cooldownMul ** u.thunder) * 0.66 ** m.hagalaz,
    thunderDamage: baseDamage * (2 + 0.5 * u.thunder),
    ravenCount: Math.min(u.ravens, RAVENS.maxCount),
    ravenDamage: baseDamage * RAVENS.dmgShare * 3 ** m.ansuz,
    blastRings: GAS.rings + m.kenaz,
    blastMul: 1.5 ** m.kenaz,
    thunderRings: 1 + m.hagalaz,
    rockPayMul: 0.6 ** m.fehu,
    goldPayMul: 3 ** m.fehu,
    goldPull: m.fehu > 0 ? 160 : 35,
    corePayMul: 3 ** m.tiwaz,
    coreSeekAt: m.tiwaz > 0 ? 0.8 : m.jera > 0 ? 0.12 : REGION.coreSeekAt,
    collapseValue: m.tiwaz > 0 ? 0 : REGION.collapseValue,
    berserkSeconds,
    berserkPayMul: berserk ? 2 ** m.wunjo : 1,
    berserkCharge: BERSERK.chargePerMead * (m.sowilo > 0 ? 2 : 1),
    meadBursts: m.sowilo > 0,
  };
}

const upgradeDef = (id: UpgradeId) => UPGRADES.find((u) => u.id === id) as UpgradeDef;

export function isUnlocked(s: GameState, def: UpgradeDef): boolean {
  return s.runBestRegion >= def.unlockRegion;
}

export function upgradeCost(id: UpgradeId, level: number, count = 1): number {
  const def = upgradeDef(id);
  const first = def.baseCost * def.growth ** level;
  return (first * (def.growth ** count - 1)) / (def.growth - 1);
}

/** How many levels the current silver affords, up to the upgrade's cap. */
export function maxAffordable(s: GameState, id: UpgradeId): number {
  const def = upgradeDef(id);
  if (!isUnlocked(s, def)) return 0;
  const level = s.upgrades[id];
  const first = def.baseCost * def.growth ** level;
  const n = Math.floor(Math.log((s.silver * (def.growth - 1)) / first + 1) / Math.log(def.growth));
  const count = Math.min(Math.max(0, n), def.maxLevel - level);
  // Rounding can land one level high; the check keeps silver from going negative.
  return count > 0 && upgradeCost(id, level, count) > s.silver ? count - 1 : count;
}

export function buyUpgrade(s: GameState, id: UpgradeId, count: number): boolean {
  const def = upgradeDef(id);
  if (!isUnlocked(s, def) || count <= 0) return false;
  if (s.upgrades[id] + count > def.maxLevel) return false;
  const cost = upgradeCost(id, s.upgrades[id], count);
  if (cost > s.silver) return false;
  s.silver -= cost;
  s.upgrades[id] += count;
  return true;
}

/** Buys the cheapest useful upgrades. Shared by the Instinct perk and the balance simulator. */
export function autoBuy(s: GameState): void {
  for (let guard = 0; guard < 200; guard++) {
    let best: UpgradeDef | null = null;
    let bestCost = Infinity;
    for (const def of UPGRADES) {
      if (!isUnlocked(s, def) || s.upgrades[def.id] >= def.maxLevel) continue;
      const cost = upgradeCost(def.id, s.upgrades[def.id]);
      if (cost < bestCost) {
        best = def;
        bestCost = cost;
      }
    }
    if (!best || bestCost > s.silver) return;
    buyUpgrade(s, best.id, 1);
  }
}

/** Draws three different runes for the player to choose between. */
export function openRuneOffer(s: GameState, rand: () => number = Math.random): void {
  if (s.runeOffer || s.runePicks <= 0) return;
  const pool = RUNES.filter((m) => s.runes[m.id] < m.maxLevel).map((m) => m.id);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  if (pool.length === 0) {
    s.runePicks = 0;
    return;
  }
  s.runeOffer = pool.slice(0, 3);
}

export function chooseRune(s: GameState, id: RuneId): boolean {
  if (!s.runeOffer?.includes(id)) return false;
  s.runes[id] += 1;
  s.runePicks -= 1;
  s.runeOffer = null;
  return true;
}

export function perkCost(id: PerkId, level: number): number {
  const def = PERKS.find((p) => p.id === id);
  if (!def) return Infinity;
  return Math.ceil(def.baseCost * def.growth ** level);
}

export function buyPerk(s: GameState, id: PerkId): boolean {
  const def = PERKS.find((p) => p.id === id);
  if (!def || s.perks[id] >= def.maxLevel) return false;
  const cost = perkCost(id, s.perks[id]);
  if (cost > s.glory) return false;
  s.glory -= cost;
  s.perks[id] += 1;
  return true;
}

export function startingSilver(s: GameState): number {
  const y = s.perks.stores;
  return y === 0 ? 0 : 25 * 2.2 ** (y - 1);
}

export function gloryPreview(s: GameState): number {
  if (!SAGA_READY(s)) return 0;
  return Math.floor(SAGA.baseGlory * SAGA.gloryGrowth ** (s.runBestRegion - SAGA.unlockRegion));
}

export function passSaga(s: GameState): boolean {
  if (!SAGA_READY(s)) return false;
  s.glory += gloryPreview(s);
  s.sagas += 1;
  s.seed = (s.seed + 7919) | 0;
  s.upgrades = zeroUpgrades();
  s.runes = zeroRunes();
  s.runePicks = 0;
  s.runeOffer = null;
  s.silver = startingSilver(s);
  s.runSilver = 0;
  s.regionIndex = 0;
  s.runBestRegion = 0;
  s.region = makeRegion(0, s.seed);
  placeShip(s.ship, s.region, s.seed);
  s.ravens = [];
  s.berserkCharge = 0;
  s.berserkLeft = 0;
  s.phase = 'mining';
  s.phaseLeft = 0;
  s.waypoint = null;
  s.rate = 0;
  s.rateWindow = 0;
  s.events.push({ t: 'region', name: s.region.name, index: 0 });
  return true;
}

export interface OfflineReport {
  seconds: number;
  gained: number;
}

/** Pays out time spent away from the game. Returns null if the absence was too short. */
export function applyOffline(s: GameState, now: number, minSeconds: number): OfflineReport | null {
  const away = (now - s.lastSeen) / 1000;
  s.lastSeen = now;
  if (!(away >= minSeconds)) return null;
  const seconds = Math.min(away, offlineCapSeconds(s));
  const gained = s.rate * offlineShare(s) * seconds;
  if (gained <= 0) return null;
  s.silver += gained;
  s.runSilver += gained;
  s.lifetimeSilver += gained;
  return { seconds, gained };
}
