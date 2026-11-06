import { BLISTER, BROOD, FRENZY, MOLT, MUTATIONS, PERKS, PLANET, SPIT, UPGRADES, WORM, type MutationId, type PerkId, type UpgradeDef, type UpgradeId } from './config.ts';
import { makePlanet } from './planet.ts';
import { MOLT_READY, offlineCapSeconds, offlineShare, placeWorm, zeroMutations, zeroUpgrades, type GameState } from './state.ts';

export interface Stats {
  jawDamage: number;
  biteRate: number;
  speed: number;
  segments: number;
  grindDamage: number;
  biomassMul: number;
  spitCooldown: number;
  spitDamage: number;
  broodCount: number;
  broodDamage: number;
  blastRings: number;
  blastMul: number;
  spitRings: number;
  crustPayMul: number;
  nectarPayMul: number;
  nectarScent: number;
  heartPayMul: number;
  heartScentAt: number;
  collapseValue: number;
  frenzySeconds: number;
  frenzyPayMul: number;
  frenzyCharge: number;
  pulseBursts: boolean;
}

const milestone = (level: number) => 1.6 ** Math.floor(level / 25);

export function computeStats(s: GameState): Stats {
  const u = s.upgrades;
  const m = s.mutations;
  const frenzy = s.frenzyLeft > 0;
  const baseDamage = (1 + 0.7 * u.jaws) * milestone(u.jaws) * (1 + 0.3 * s.perks.fangs);
  const jawDamage = baseDamage * 0.85 ** m.volatile * 0.7 ** m.serrated * 2.5 ** m.ironjaw;
  const meta = 1 + 0.05 * u.metabolism;
  const frenzySeconds = FRENZY.seconds * 1.6 ** m.gorger;
  return {
    jawDamage,
    biteRate: WORM.biteRate * meta * 0.75 ** m.hive * (frenzy ? FRENZY.biteMul : 1),
    speed: WORM.baseSpeed * (1 + 0.015 * u.metabolism) * 0.85 ** m.caustic * 0.7 ** m.ironjaw * (frenzy ? FRENZY.speedMul : 1),
    segments: WORM.baseSegments + u.length,
    // Grinding, spit and hatchlings scale from the unmodified bite, so a bite
    // penalty stays a penalty on biting and these builds stand on their own.
    grindDamage: baseDamage * WORM.grindShare * 3 ** m.serrated,
    biomassMul: (1 + 0.3 * u.gut) * milestone(u.gut) * (1 + 0.3 * s.perks.hide) * 1.4 ** m.thorough,
    spitCooldown: Math.max(SPIT.minCooldown, SPIT.baseCooldown * SPIT.cooldownMul ** u.spit) * 0.66 ** m.caustic,
    spitDamage: baseDamage * (2 + 0.5 * u.spit),
    broodCount: Math.min(u.brood, BROOD.maxCount),
    broodDamage: baseDamage * BROOD.dmgShare * 3 ** m.hive,
    blastRings: BLISTER.rings + m.volatile,
    blastMul: 1.5 ** m.volatile,
    spitRings: 1 + m.caustic,
    crustPayMul: 0.6 ** m.sweet,
    nectarPayMul: 3 ** m.sweet,
    nectarScent: m.sweet > 0 ? 160 : 35,
    heartPayMul: 3 ** m.heartseeker,
    heartScentAt: m.heartseeker > 0 ? 0.8 : m.thorough > 0 ? 0.12 : PLANET.heartScentAt,
    collapseValue: m.heartseeker > 0 ? 0 : PLANET.collapseValue,
    frenzySeconds,
    frenzyPayMul: frenzy ? 2 ** m.gorger : 1,
    frenzyCharge: FRENZY.chargePerPulse * (m.livewire > 0 ? 2 : 1),
    pulseBursts: m.livewire > 0,
  };
}

const upgradeDef = (id: UpgradeId) => UPGRADES.find((u) => u.id === id) as UpgradeDef;

export function isUnlocked(s: GameState, def: UpgradeDef): boolean {
  return s.runBestPlanet >= def.unlockPlanet;
}

export function upgradeCost(id: UpgradeId, level: number, count = 1): number {
  const def = upgradeDef(id);
  const first = def.baseCost * def.growth ** level;
  return (first * (def.growth ** count - 1)) / (def.growth - 1);
}

/** How many levels the current biomass affords, up to the upgrade's cap. */
export function maxAffordable(s: GameState, id: UpgradeId): number {
  const def = upgradeDef(id);
  if (!isUnlocked(s, def)) return 0;
  const level = s.upgrades[id];
  const first = def.baseCost * def.growth ** level;
  const n = Math.floor(Math.log((s.biomass * (def.growth - 1)) / first + 1) / Math.log(def.growth));
  const count = Math.min(Math.max(0, n), def.maxLevel - level);
  // Rounding can land one level high; the check keeps biomass from going negative.
  return count > 0 && upgradeCost(id, level, count) > s.biomass ? count - 1 : count;
}

export function buyUpgrade(s: GameState, id: UpgradeId, count: number): boolean {
  const def = upgradeDef(id);
  if (!isUnlocked(s, def) || count <= 0) return false;
  if (s.upgrades[id] + count > def.maxLevel) return false;
  const cost = upgradeCost(id, s.upgrades[id], count);
  if (cost > s.biomass) return false;
  s.biomass -= cost;
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
    if (!best || bestCost > s.biomass) return;
    buyUpgrade(s, best.id, 1);
  }
}

/** Draws three different mutations for the player to choose between. */
export function openMutationOffer(s: GameState, rand: () => number = Math.random): void {
  if (s.mutationOffer || s.mutationPicks <= 0) return;
  const pool = MUTATIONS.filter((m) => s.mutations[m.id] < m.maxLevel).map((m) => m.id);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  if (pool.length === 0) {
    s.mutationPicks = 0;
    return;
  }
  s.mutationOffer = pool.slice(0, 3);
}

export function chooseMutation(s: GameState, id: MutationId): boolean {
  if (!s.mutationOffer?.includes(id)) return false;
  s.mutations[id] += 1;
  s.mutationPicks -= 1;
  s.mutationOffer = null;
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
  if (cost > s.chitin) return false;
  s.chitin -= cost;
  s.perks[id] += 1;
  return true;
}

export function startingBiomass(s: GameState): number {
  const y = s.perks.yolk;
  return y === 0 ? 0 : 25 * 2.2 ** (y - 1);
}

export function chitinPreview(s: GameState): number {
  if (!MOLT_READY(s)) return 0;
  return Math.floor(MOLT.baseChitin * MOLT.chitinGrowth ** (s.runBestPlanet - MOLT.unlockPlanet));
}

export function molt(s: GameState): boolean {
  if (!MOLT_READY(s)) return false;
  s.chitin += chitinPreview(s);
  s.molts += 1;
  s.seed = (s.seed + 7919) | 0;
  s.upgrades = zeroUpgrades();
  s.mutations = zeroMutations();
  s.mutationPicks = 0;
  s.mutationOffer = null;
  s.biomass = startingBiomass(s);
  s.runBiomass = 0;
  s.planetIndex = 0;
  s.runBestPlanet = 0;
  s.planet = makePlanet(0, s.seed);
  placeWorm(s.worm, s.planet, s.seed);
  s.brood = [];
  s.frenzyCharge = 0;
  s.frenzyLeft = 0;
  s.phase = 'eating';
  s.phaseLeft = 0;
  s.lure = null;
  s.rate = 0;
  s.rateWindow = 0;
  s.events.push({ t: 'planet', name: s.planet.name, index: 0 });
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
  s.biomass += gained;
  s.runBiomass += gained;
  s.lifetimeBiomass += gained;
  return { seconds, gained };
}
