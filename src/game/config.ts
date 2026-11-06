// Every tunable number in the game lives here. Change a value, then run
// `npm run balance` to see what it does to pacing.

export const TICK = 1 / 30; // simulation step, seconds
export const HEX_SIZE = 6; // world units, centre to corner

export const BLOCK = { EMPTY: 0, ROCK: 1, GOLD: 2, MEAD: 3, GAS: 4, CORE: 5, FIND: 6 } as const;
export type BlockKind = (typeof BLOCK)[keyof typeof BLOCK];

export const REGION = {
  baseRadius: 16,
  radiusPerRegion: 2,
  maxRadius: 32,
  hpBase: 15, // about 5 seconds per surface block for a starting drill
  hpGrowth: 3.2,
  valueBase: 3,
  valueGrowth: 1.45,
  depthBonus: 1, // core cells have (1 + bonus) times the hp and value of surface cells
  hexesPerGoldVein: 70,
  goldVeinSteps: [4, 12] as const,
  goldValue: 7,
  goldHp: 1.5,
  meadChance: 0.012,
  gasChance: 0.025,
  coreHpShare: 0.1, // core hp, as a share of the whole region's hp
  coreValueShare: 0.3, // core value, as a share of the whole region's value
  corePaidAsMined: 0.5, // this share pays out as its health falls, the rest at collapse
  coreOpenAt: 0.35, // the core stays sealed until only this share of cells remains
  coreHuntAt: 0.1, // the ship goes for it on its own once this share remains
  collapseValue: 0.5, // leftover cells pay this share when the region dies
  collapseSeconds: 3.4,
};

export const SHIP = {
  baseSpeed: 36,
  turnRate: 5.5, // radians per second
  lookAhead: 5,
  sightHexes: 4, // how far the crew can see across open space
  sightSolids: 1, // solid hexes a sight line can reach; a later upgrade could raise this
  sightRays: 30,
  sightEvery: 0.2, // seconds between looks around
  trailSampleDist: 2,
  samplesPerSegment: 3,
  drillRate: 3, // hits per second
  haulerRadius: 4.2,
  drawScale: 0.62,
  maxPods: 9,
};

export const BERSERK = {
  seconds: 8,
  rateMul: 1.8,
  speedMul: 1.3,
  chargePerMead: 0.34,
  rechargeSeconds: 180, // fills on its own this slowly; mead is the fast way
};

// How much the ship wants a block, in distance units. Damaged beats special beats
// normal, nearby. A far block can still lose to a near one, which keeps it from
// crossing the map for every scratch. Hidden behind rock, a bonus counts for less.
export const TARGETING = {
  damaged: 140,
  aheadWeight: 0.35,
  gemMul: 1.4, // gems, as a multiple of gold
  mead: 70,
  gas: 55,
  buriedShare: 0.4,
  openSide: 2,
};

export const GAS = { rings: 3, hpShare: 0.3, drillShare: 3 };

// Ravens never deal damage. Their abilities stay strong at any stage, so they grow
// slowly: most levels are quiet, and every third one improves a single trait, in
// the order below. Each rank raises what their gems are worth.
export const RAVENS = {
  levelCycle: ['speed', 'find', 'reach', 'smart'] as const,
  levelsPerStep: 3,
  reachHexes: 4,
  speed: 8,
  speedStep: 1.12,
  findChance: 0.02, // chance per uncharted rock hex a trip reports
  findStep: 0.0025,
  smart: 0.25, // chance of heading for uncharted hexes instead of a random direction
  smartStep: 0.1,
  width: 1, // rings scouted either side of the flight path: the hexes crossed and their neighbors
  returnSpeed: 3, // the flight home is this much faster, so a raven catches a ship that moved on
  restSeconds: 1.5,
  staggerSeconds: 3, // the second raven's first launch waits this long
  revealPerTick: 3,
  findValues: [2, 5, 10, 15],
};

export const TOOL_SHAPES = {
  sweepReach: 9,
  sweepSpread: 0.7, // radians either side of the bow
  lanceHexes: 8,
  thunderRange: 120,
  thunderRings: 2,
  pulseRings: 3,
};

// Each upgrade runs 1/25 to 25/25, then ranks up. A level is small and a rank is big.
export const LEVELS = {
  perRank: 25,
  powerPerLevel: 1.03,
  rankPower: 2,
  costGrowth: 1.07,
  rankCostStep: 4,
  forgePower: 0.35, // Forge Heat speeds up everything, so it takes only part of a level's power
};

// Each realm will add about three ranks of its own. These are Midgard's.
export const RANKS = [
  { name: 'Iron', color: '#a9b7c6' },
  { name: 'Steel', color: '#7fc8ff' },
  { name: 'Silver', color: '#eef3f8' },
];

export const MAX_LEVEL = RANKS.length * LEVELS.perRank;

export type UpgradeId = 'drill' | 'ravens' | 'smelter' | 'forge' | 'haulers' | 'sweep' | 'lance' | 'thunder' | 'pulse';
type Requirement = [UpgradeId, number][]; // any one of these upgrade levels

export interface UpgradeDef {
  id: UpgradeId;
  name: string;
  group: 'tool' | 'clan';
  baseCost: number;
  power: number; // hidden baseline: damage per strike at level 1
  period: number; // seconds between strikes
  unlock: Requirement | null;
  // A pair: buy either first, and the other arrives later but stronger.
  choice?: { group: string; lateAt: Requirement; lateBonus: number };
}

const firstPair = { group: 'bellows', lateAt: [['drill', 26]] as Requirement, lateBonus: 1.5 };
const secondPair = { group: 'arms', lateAt: [['haulers', 26]] as Requirement, lateBonus: 2.5 };

export const UPGRADES: UpgradeDef[] = [
  { id: 'drill', name: 'Drillhead', group: 'tool', baseCost: 5, power: 1, period: 1 / SHIP.drillRate, unlock: null },
  { id: 'ravens', name: 'Ravens', group: 'clan', baseCost: 15, power: 0, period: 0, unlock: null },
  { id: 'smelter', name: 'Smelter', group: 'clan', baseCost: 40, power: 0, period: 0, unlock: [['drill', 10]], choice: firstPair },
  { id: 'forge', name: 'Forge Heat', group: 'clan', baseCost: 60, power: 0, period: 0, unlock: [['drill', 10]], choice: firstPair },
  { id: 'haulers', name: 'Clan Haulers', group: 'tool', baseCost: 100, power: 8, period: 1, unlock: [['smelter', 5], ['forge', 5]] },
  { id: 'sweep', name: 'Sweep Arms', group: 'tool', baseCost: 900, power: 24, period: 1, unlock: [['haulers', 10]], choice: secondPair },
  { id: 'lance', name: 'Gungnir Lance', group: 'tool', baseCost: 900, power: 60, period: 3, unlock: [['haulers', 10]], choice: secondPair },
  { id: 'thunder', name: 'Thunder Charges', group: 'tool', baseCost: 9000, power: 600, period: 6, unlock: [['sweep', 10], ['lance', 10]] },
  { id: 'pulse', name: 'Mjölnir Pulse', group: 'tool', baseCost: 60000, power: 2500, period: 8, unlock: [['thunder', 10]] },
];

export type PerkId = 'hoard' | 'steel' | 'stores' | 'hearth' | 'foreman';

export interface PerkDef {
  id: PerkId;
  name: string;
  blurb: string;
  baseCost: number;
  growth: number;
  maxLevel: number;
}

export const PERKS: PerkDef[] = [
  { id: 'hoard', name: 'Hoard Lore', blurb: '+30% silver, each level', baseCost: 1, growth: 1.35, maxLevel: 200 },
  { id: 'steel', name: "Ancestors' Steel", blurb: '+30% damage, each level', baseCost: 1, growth: 1.35, maxLevel: 200 },
  { id: 'stores', name: 'Clan Stores', blurb: 'Start each generation with more silver', baseCost: 2, growth: 1.6, maxLevel: 40 },
  { id: 'hearth', name: 'Hearthkeepers', blurb: 'Earn more, and longer, while away', baseCost: 3, growth: 1.7, maxLevel: 10 },
  { id: 'foreman', name: 'Old Foreman', blurb: 'Buys upgrades and fires Berserk for you', baseCost: 8, growth: 1, maxLevel: 1 },
];

export type RuneId =
  | 'kenaz' | 'thurisaz' | 'hagalaz' | 'ansuz' | 'fehu'
  | 'wunjo' | 'sowilo' | 'tiwaz' | 'jera' | 'uruz';

export type BuildTag = 'Blast' | 'Grind' | 'Thunder' | 'Recon' | 'Harvest' | 'Berserk' | 'Drill';

export interface RuneDef {
  id: RuneId;
  name: string; // the real Elder Futhark rune
  meaning: string;
  tag: BuildTag;
  gain: string;
  cost: string | null; // the tradeoff, if there is one
  maxLevel: number;
}

// One is carved after every region and lasts until the saga passes on. Most
// carry a real cost, so a build is a set of decisions and not a list of bonuses.
export const RUNES: RuneDef[] = [
  { id: 'kenaz', name: 'Kenaz', meaning: 'torch', tag: 'Blast', gain: 'Gas pockets reach 1 ring farther and hit 25% harder', cost: 'Drill damage -10%', maxLevel: 3 },
  { id: 'sowilo', name: 'Sowilo', meaning: 'sun', tag: 'Blast', gain: 'Mead casks burst like gas and charge Berserk 50% faster', cost: null, maxLevel: 2 },
  { id: 'thurisaz', name: 'Thurisaz', meaning: 'thorn', tag: 'Grind', gain: 'Hauler cutting x1.5', cost: 'Drill damage -15%', maxLevel: 3 },
  { id: 'hagalaz', name: 'Hagalaz', meaning: 'hail', tag: 'Thunder', gain: 'Thunder fires 30% faster, with a wider blast', cost: 'Ship speed -10%', maxLevel: 3 },
  { id: 'ansuz', name: 'Ansuz', meaning: 'Odin', tag: 'Recon', gain: 'Ravens fly 30% farther and 20% faster', cost: 'Drill rate -10%', maxLevel: 3 },
  { id: 'fehu', name: 'Fehu', meaning: 'wealth', tag: 'Harvest', gain: 'Gold pays x1.6, and the ship hunts it hard', cost: 'Other blocks pay -20%', maxLevel: 3 },
  { id: 'jera', name: 'Jera', meaning: 'harvest', tag: 'Harvest', gain: 'All blocks pay +20%', cost: 'The Worldheart stays sealed until 12% of the region remains', maxLevel: 3 },
  { id: 'tiwaz', name: 'Tiwaz', meaning: 'spear', tag: 'Drill', gain: 'The Worldheart opens early and pays x1.5', cost: 'Leftover blocks pay nothing', maxLevel: 3 },
  { id: 'uruz', name: 'Uruz', meaning: 'strength', tag: 'Drill', gain: 'Drill damage x1.4', cost: 'Ship speed -15%', maxLevel: 3 },
  { id: 'wunjo', name: 'Wunjo', meaning: 'joy', tag: 'Berserk', gain: 'Berserk lasts 30% longer and pays x1.4', cost: null, maxLevel: 2 },
];

export const SAGA = {
  unlockRegion: 4, // zero-based: must reach the 5th region
  gloryBase: 5000, // glory is the square root of silver earned, over this
};

export const OFFLINE = {
  baseShare: 0.4,
  sharePerLevel: 0.08,
  baseHours: 8,
  hoursPerLevel: 2,
  minSeconds: 45,
};

export const SAVE_KEY = 'yggdrasil.save.v2';
