// Every tunable number in the game lives here. Change a value, then run
// `npm run balance` to see what it does to pacing.

export const TICK = 1 / 30; // simulation step, seconds
export const HEX_SIZE = 10; // world units, centre to corner

export const BLOCK = { EMPTY: 0, ROCK: 1, GOLD: 2, MEAD: 3, GAS: 4, CORE: 5 } as const;
export type BlockKind = (typeof BLOCK)[keyof typeof BLOCK];

export const REGION = {
  baseRadius: 6,
  radiusEvery: 2, // grow one ring every N regions
  maxRadius: 13,
  hpBase: 3,
  hpGrowth: 1.78,
  valueBase: 1,
  valueGrowth: 1.42,
  depthBonus: 1.6, // core cells have (1 + bonus) times the hp and value of surface cells
  goldVeins: 3,
  goldVeinsPerRing: 0.5,
  goldValue: 7,
  goldHp: 1.5,
  meadChance: 0.035,
  gasChance: 0.05,
  coreHpShare: 0.14, // core hp, as a share of the whole region's hp
  coreValueShare: 0.3, // core value, as a share of the whole region's value
  coreSeekAt: 0.35, // ship heads for the core once this share of cells remains
  collapseValue: 0.5, // leftover cells pay this share when the region dies
  collapseSeconds: 3.2,
};

export const SHIP = {
  baseSpeed: 58,
  turnRate: 5.5, // radians per second
  lookAhead: 6,
  trailSampleDist: 3,
  samplesPerSegment: 3,
  baseSegments: 5,
  drillRate: 3,
  grindEvery: 0.5,
  grindShare: 0.12, // share of drill damage dealt by each hauler
  haulerRadius: 6.5,
};

export const BERSERK = {
  seconds: 8,
  drillMul: 2.2,
  speedMul: 1.5,
  chargePerMead: 0.34,
};

export const GAS = { rings: 2, hpShare: 0.3, drillShare: 3 };
export const THUNDER = { baseCooldown: 5, minCooldown: 0.8, cooldownMul: 0.97, range: 130 };
export const RAVENS = { speed: 75, strikeEvery: 0.5, dmgShare: 0.4, maxCount: 30 };

export type UpgradeId = 'drill' | 'forge' | 'haulers' | 'smelter' | 'thunder' | 'ravens';

export interface UpgradeDef {
  id: UpgradeId;
  name: string;
  blurb: string;
  baseCost: number;
  growth: number;
  maxLevel: number;
  unlockRegion: number; // zero-based region index
}

export const UPGRADES: UpgradeDef[] = [
  { id: 'drill', name: 'Drillhead', blurb: 'Drill damage', baseCost: 6, growth: 1.2, maxLevel: 1000, unlockRegion: 0 },
  { id: 'smelter', name: 'Smelter', blurb: 'Silver per block', baseCost: 9, growth: 1.21, maxLevel: 1000, unlockRegion: 0 },
  { id: 'forge', name: 'Forge Heat', blurb: 'Drill rate and speed', baseCost: 12, growth: 1.24, maxLevel: 120, unlockRegion: 0 },
  { id: 'haulers', name: 'Clan Haulers', blurb: 'Each hauler crew cuts the walls', baseCost: 18, growth: 1.2, maxLevel: 150, unlockRegion: 0 },
  { id: 'thunder', name: 'Thunder Charges', blurb: 'Splash damage at range', baseCost: 90, growth: 1.24, maxLevel: 200, unlockRegion: 1 },
  { id: 'ravens', name: 'Raven Drones', blurb: 'Drones mine on their own', baseCost: 350, growth: 1.35, maxLevel: RAVENS.maxCount, unlockRegion: 2 },
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

export type BuildTag = 'Blast' | 'Grind' | 'Thunder' | 'Ravens' | 'Harvest' | 'Berserk' | 'Drill';

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
  { id: 'kenaz', name: 'Kenaz', meaning: 'torch', tag: 'Blast', gain: 'Gas pockets reach 1 ring farther and hit 50% harder', cost: 'Drill damage -15%', maxLevel: 3 },
  { id: 'sowilo', name: 'Sowilo', meaning: 'sun', tag: 'Blast', gain: 'Mead casks burst like gas and charge Berserk twice as fast', cost: null, maxLevel: 2 },
  { id: 'thurisaz', name: 'Thurisaz', meaning: 'thorn', tag: 'Grind', gain: 'Hauler cutting x3', cost: 'Drill damage -30%', maxLevel: 3 },
  { id: 'hagalaz', name: 'Hagalaz', meaning: 'hail', tag: 'Thunder', gain: 'Thunder fires 50% faster, with a wider blast', cost: 'Ship speed -15%', maxLevel: 3 },
  { id: 'ansuz', name: 'Ansuz', meaning: 'Odin', tag: 'Ravens', gain: 'Raven damage x3', cost: 'Drill rate -25%', maxLevel: 3 },
  { id: 'fehu', name: 'Fehu', meaning: 'wealth', tag: 'Harvest', gain: 'Gold pays x3, and the ship hunts it hard', cost: 'Other blocks pay -40%', maxLevel: 3 },
  { id: 'jera', name: 'Jera', meaning: 'harvest', tag: 'Harvest', gain: 'All blocks pay +40%', cost: 'The Worldheart stays hidden until 12% of the region remains', maxLevel: 3 },
  { id: 'tiwaz', name: 'Tiwaz', meaning: 'spear', tag: 'Drill', gain: 'Hunts the Worldheart early, and it pays x3', cost: 'Leftover blocks pay nothing', maxLevel: 3 },
  { id: 'uruz', name: 'Uruz', meaning: 'strength', tag: 'Drill', gain: 'Drill damage x2.5', cost: 'Ship speed -30%', maxLevel: 3 },
  { id: 'wunjo', name: 'Wunjo', meaning: 'joy', tag: 'Berserk', gain: 'Berserk lasts 60% longer and doubles silver', cost: null, maxLevel: 2 },
];

export const SAGA = {
  unlockRegion: 5, // zero-based: must reach the 6th region
  baseGlory: 2,
  gloryGrowth: 1.2, // each region past the unlock is worth this much more
};

export const OFFLINE = {
  baseShare: 0.4,
  sharePerLevel: 0.08,
  baseHours: 4,
  hoursPerLevel: 2,
  minSeconds: 45,
};

export const SAVE_KEY = 'yggdrasil.save.v1';
