import { BERSERK, GAS, LEVELS, MAX_LEVEL, PERKS, RANKS, RAVENS, REGION, RUNES, SAGA, SHIP, TOOL_SHAPES, UPGRADES, type PerkId, type RuneId, type UpgradeDef, type UpgradeId } from './config.ts';
import { makeRegion } from './region.ts';
import { SAGA_READY, offlineCapSeconds, offlineShare, placeShip, startUpgrades, zeroRunes, type GameState } from './state.ts';

export interface Stats {
  drillDamage: number;
  drillRate: number;
  speed: number;
  pods: number;
  cutDamage: number;
  cutEvery: number;
  sweepDamage: number;
  sweepEvery: number;
  lanceDamage: number;
  lanceEvery: number;
  thunderDamage: number;
  thunderEvery: number;
  thunderRings: number;
  pulseDamage: number;
  pulseEvery: number;
  silverMul: number;
  ravenCount: number;
  ravenRange: number;
  ravenSpeed: number;
  ravenWidth: number;
  ravenSmart: number;
  findChance: number;
  findValue: number;
  blastRings: number;
  blastMul: number;
  rockPayMul: number;
  goldPayMul: number;
  goldPull: number;
  corePayMul: number;
  coreOpenAt: number;
  coreHuntAt: number;
  collapseValue: number;
  berserkSeconds: number;
  berserkPayMul: number;
  berserkCharge: number;
  meadBursts: boolean;
}

export const upgradeDef = (id: UpgradeId) => UPGRADES.find((u) => u.id === id) as UpgradeDef;

/** Completed ranks: 0 for levels 1 to 25, 1 for levels 26 to 50, and so on. */
export const rankOf = (level: number) => (level <= 0 ? 0 : Math.floor((level - 1) / LEVELS.perRank));

/** Progress through the current rank, 1 to 25, as the player sees it. */
export const rankLevel = (level: number) => (level <= 0 ? 0 : ((level - 1) % LEVELS.perRank) + 1);

export const rankInfo = (level: number) => RANKS[Math.min(RANKS.length - 1, rankOf(level))];

/** Strength of an upgrade: small steps per level, big steps per rank. */
export function levelPower(level: number): number {
  if (level <= 0) return 0;
  return LEVELS.powerPerLevel ** (level - 1) * LEVELS.rankPower ** rankOf(level);
}

/** The hidden head start for the upgrade that arrived second in a pair. */
export function baseline(s: GameState, def: UpgradeDef): number {
  const pair = def.choice;
  if (!pair) return 1;
  const first = s.firstChoice[pair.group];
  return first && first !== def.id ? pair.lateBonus : 1;
}

/** How many times each raven trait has improved by this level. */
function ravenSteps(level: number) {
  const steps = { reach: 0, speed: 0, find: 0, smart: 0 };
  const earned = Math.floor((level - 1) / RAVENS.levelsPerStep);
  for (let n = 0; n < earned; n++) steps[RAVENS.levelCycle[n % RAVENS.levelCycle.length]] += 1;
  return steps;
}

/** The next raven improvement, and how many levels away it is. */
export function ravenNextStep(level: number) {
  const at = Math.max(1, level);
  const earned = Math.floor((at - 1) / RAVENS.levelsPerStep);
  return {
    trait: RAVENS.levelCycle[earned % RAVENS.levelCycle.length],
    inLevels: RAVENS.levelsPerStep - ((at - 1) % RAVENS.levelsPerStep),
  };
}

export function computeStats(s: GameState): Stats {
  const u = s.upgrades;
  const m = s.runes;
  const berserk = s.berserkLeft > 0;
  const steel = 1 + 0.3 * s.perks.steel;
  const tool = (id: UpgradeId) => {
    const def = upgradeDef(id);
    return def.power * levelPower(u[id]) * baseline(s, def) * steel;
  };
  const forge = u.forge > 0 ? levelPower(u.forge) ** LEVELS.forgePower * baseline(s, upgradeDef('forge')) : 1;
  const rate = forge * (berserk ? BERSERK.rateMul : 1);
  const smelter = u.smelter > 0 ? levelPower(u.smelter) * baseline(s, upgradeDef('smelter')) : 1;
  const berserkSeconds = BERSERK.seconds * 1.3 ** m.wunjo;
  const raven = ravenSteps(u.ravens);
  return {
    drillDamage: tool('drill') * 0.9 ** m.kenaz * 0.85 ** m.thurisaz * 1.4 ** m.uruz,
    drillRate: SHIP.drillRate * rate * 0.9 ** m.ansuz,
    speed: SHIP.baseSpeed * Math.sqrt(forge) * 0.9 ** m.hagalaz * 0.85 ** m.uruz * (berserk ? BERSERK.speedMul : 1),
    pods: u.haulers > 0 ? Math.min(SHIP.maxPods, 1 + rankOf(u.haulers)) : 0,
    cutDamage: tool('haulers') * 1.5 ** m.thurisaz,
    cutEvery: upgradeDef('haulers').period / rate,
    sweepDamage: tool('sweep'),
    sweepEvery: upgradeDef('sweep').period / rate,
    lanceDamage: tool('lance'),
    lanceEvery: upgradeDef('lance').period / rate,
    thunderDamage: tool('thunder'),
    thunderEvery: upgradeDef('thunder').period / rate / 1.3 ** m.hagalaz,
    thunderRings: TOOL_SHAPES.thunderRings + m.hagalaz,
    pulseDamage: tool('pulse'),
    pulseEvery: upgradeDef('pulse').period / rate,
    silverMul: smelter * (1 + 0.3 * s.perks.hoard) * 1.2 ** m.jera,
    ravenCount: u.ravens <= 0 ? 0 : rankOf(u.ravens) >= 1 ? 2 : 1,
    ravenRange: (RAVENS.reachHexes + raven.reach) * 10 * 1.3 ** m.ansuz,
    ravenSpeed: RAVENS.speed * RAVENS.speedStep ** raven.speed * 1.2 ** m.ansuz,
    ravenWidth: RAVENS.width,
    ravenSmart: Math.min(1, RAVENS.smart + RAVENS.smartStep * raven.smart),
    findChance: u.ravens <= 0 ? 0 : RAVENS.findChance + RAVENS.findStep * raven.find,
    findValue: RAVENS.findValues[Math.min(RAVENS.findValues.length - 1, rankOf(u.ravens))],
    blastRings: GAS.rings + m.kenaz,
    blastMul: 1.25 ** m.kenaz,
    rockPayMul: 0.8 ** m.fehu,
    goldPayMul: 1.6 ** m.fehu,
    goldPull: m.fehu > 0 ? 130 : 80,
    corePayMul: 1.5 ** m.tiwaz,
    coreOpenAt: m.tiwaz > 0 ? 0.8 : m.jera > 0 ? 0.12 : REGION.coreOpenAt,
    coreHuntAt: m.tiwaz > 0 ? 0.8 : REGION.coreHuntAt,
    collapseValue: m.tiwaz > 0 ? 0 : REGION.collapseValue,
    berserkSeconds,
    berserkPayMul: berserk ? 1.4 ** m.wunjo : 1,
    berserkCharge: BERSERK.chargePerMead * (m.sowilo > 0 ? 1.5 : 1),
    meadBursts: m.sowilo > 0,
  };
}

const met = (s: GameState, rule: [UpgradeId, number][]) => rule.some(([id, level]) => s.upgrades[id] >= level);

export function isUnlocked(s: GameState, def: UpgradeDef): boolean {
  if (def.unlock && !met(s, def.unlock)) return false;
  const first = def.choice ? s.firstChoice[def.choice.group] : undefined;
  if (def.choice && first && first !== def.id) return met(s, def.choice.lateAt);
  return true;
}

/** True when this upgrade is half of a pair and neither has been bought yet. */
export function isOpenChoice(s: GameState, def: UpgradeDef): boolean {
  return !!def.choice && !s.firstChoice[def.choice.group] && isUnlocked(s, def);
}

/** Price of the next single level from `level`. */
function stepCost(s: GameState, def: UpgradeDef, level: number): number {
  return Math.ceil(def.baseCost * baseline(s, def) * LEVELS.costGrowth ** level * LEVELS.rankCostStep ** Math.floor(level / LEVELS.perRank));
}

export function upgradeCost(s: GameState, id: UpgradeId, level: number, count = 1): number {
  const def = upgradeDef(id);
  let total = 0;
  for (let i = 0; i < count; i++) total += stepCost(s, def, level + i);
  return total;
}

/** How many levels the current silver affords, up to the current rank cap. */
export function maxAffordable(s: GameState, id: UpgradeId): number {
  const def = upgradeDef(id);
  if (!isUnlocked(s, def)) return 0;
  let level = s.upgrades[id];
  let left = s.silver;
  let count = 0;
  while (level < MAX_LEVEL) {
    const cost = stepCost(s, def, level);
    if (cost > left) break;
    left -= cost;
    level += 1;
    count += 1;
  }
  return count;
}

export function buyUpgrade(s: GameState, id: UpgradeId, count: number): boolean {
  const def = upgradeDef(id);
  const before = s.upgrades[id];
  if (!isUnlocked(s, def) || count <= 0 || before + count > MAX_LEVEL) return false;
  const cost = upgradeCost(s, id, before, count);
  if (cost > s.silver) return false;
  s.silver -= cost;
  s.upgrades[id] += count;
  if (def.choice && !s.firstChoice[def.choice.group]) s.firstChoice[def.choice.group] = id;
  if (before > 0 && rankOf(s.upgrades[id]) > rankOf(before)) {
    s.events.push({ t: 'rank', id, rank: rankOf(s.upgrades[id]) });
  }
  return true;
}

/** Buys the cheapest useful upgrades. Shared by the Old Foreman saga and the balance simulator. */
export function autoBuy(s: GameState): void {
  for (let guard = 0; guard < 200; guard++) {
    let best: UpgradeDef | null = null;
    let bestCost = Infinity;
    for (const def of UPGRADES) {
      if (!isUnlocked(s, def) || s.upgrades[def.id] >= MAX_LEVEL) continue;
      // Ravens pay off slowly, so they wait behind anything that adds damage or silver.
      const cost = upgradeCost(s, def.id, s.upgrades[def.id]) * (def.id === 'ravens' ? 4 : 1);
      if (cost < bestCost) {
        best = def;
        bestCost = cost;
      }
    }
    if (!best || upgradeCost(s, best.id, s.upgrades[best.id]) > s.silver) return;
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

/** Square root of the silver earned this generation, so idle time counts too. */
export function gloryPreview(s: GameState): number {
  if (!SAGA_READY(s)) return 0;
  return Math.floor(Math.sqrt(s.runSilver / SAGA.gloryBase));
}

export function passSaga(s: GameState): boolean {
  if (!SAGA_READY(s)) return false;
  s.glory += gloryPreview(s);
  s.sagas += 1;
  s.seed = (s.seed + 7919) | 0;
  s.upgrades = startUpgrades();
  s.firstChoice = {};
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
  s.reveal = [];
  s.sweep = null;
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
