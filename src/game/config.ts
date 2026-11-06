// Every tunable number in the game lives here. Change a value, then run
// `npm run balance` to see what it does to pacing.

export const TICK = 1 / 30; // simulation step, seconds
export const HEX_SIZE = 10; // world units, centre to corner

export const BLOCK = { EMPTY: 0, CRUST: 1, NECTAR: 2, PULSE: 3, BLISTER: 4, HEART: 5 } as const;
export type BlockKind = (typeof BLOCK)[keyof typeof BLOCK];

export const PLANET = {
  baseRadius: 6,
  radiusEvery: 2, // grow one ring every N planets
  maxRadius: 13,
  hpBase: 3,
  hpGrowth: 1.78,
  valueBase: 1,
  valueGrowth: 1.42,
  depthBonus: 1.6, // core cells have (1 + bonus) times the hp and value of surface cells
  nectarVeins: 3,
  nectarVeinsPerRing: 0.5,
  nectarValue: 7,
  nectarHp: 1.5,
  pulseChance: 0.035,
  blisterChance: 0.05,
  heartHpShare: 0.14, // heart hp, as a share of the whole planet's hp
  heartValueShare: 0.3, // heart value, as a share of the whole planet's value
  heartScentAt: 0.35, // worm goes for the heart once this share of cells remains
  collapseValue: 0.5, // leftover cells pay this share when the planet dies
  collapseSeconds: 3.2,
};

export const WORM = {
  baseSpeed: 58,
  turnRate: 5.5, // radians per second
  lookAhead: 6,
  trailSampleDist: 3,
  samplesPerSegment: 3,
  baseSegments: 5,
  biteRate: 3,
  grindEvery: 0.5,
  grindShare: 0.12, // share of jaw damage dealt by each body segment
  bodyRadius: 6.5,
};

export const FRENZY = {
  seconds: 8,
  biteMul: 2.2,
  speedMul: 1.5,
  chargePerPulse: 0.34,
};

export const BLISTER = { rings: 2, hpShare: 0.3, jawShare: 3 };
export const SPIT = { baseCooldown: 5, minCooldown: 0.8, cooldownMul: 0.97, range: 130 };
export const BROOD = { speed: 75, biteEvery: 0.5, dmgShare: 0.4, maxCount: 30 };

export type UpgradeId = 'jaws' | 'metabolism' | 'length' | 'gut' | 'spit' | 'brood';

export interface UpgradeDef {
  id: UpgradeId;
  name: string;
  blurb: string;
  baseCost: number;
  growth: number;
  maxLevel: number;
  unlockPlanet: number; // zero-based planet index
}

export const UPGRADES: UpgradeDef[] = [
  { id: 'jaws', name: 'Jaws', blurb: 'Bite damage', baseCost: 6, growth: 1.2, maxLevel: 1000, unlockPlanet: 0 },
  { id: 'gut', name: 'Gut', blurb: 'Biomass per block', baseCost: 9, growth: 1.21, maxLevel: 1000, unlockPlanet: 0 },
  { id: 'metabolism', name: 'Metabolism', blurb: 'Bite rate and speed', baseCost: 12, growth: 1.24, maxLevel: 120, unlockPlanet: 0 },
  { id: 'length', name: 'Length', blurb: 'Body segments grind the walls', baseCost: 18, growth: 1.2, maxLevel: 150, unlockPlanet: 0 },
  { id: 'spit', name: 'Acid Spit', blurb: 'Splash damage at range', baseCost: 90, growth: 1.24, maxLevel: 200, unlockPlanet: 1 },
  { id: 'brood', name: 'Brood', blurb: 'Hatchlings chew on their own', baseCost: 350, growth: 1.35, maxLevel: BROOD.maxCount, unlockPlanet: 2 },
];

export type PerkId = 'hide' | 'fangs' | 'yolk' | 'dreams' | 'instinct';

export interface PerkDef {
  id: PerkId;
  name: string;
  blurb: string;
  baseCost: number;
  growth: number;
  maxLevel: number;
}

export const PERKS: PerkDef[] = [
  { id: 'hide', name: 'Rich Blood', blurb: '+30% biomass, each level', baseCost: 1, growth: 1.35, maxLevel: 200 },
  { id: 'fangs', name: 'Ancient Fangs', blurb: '+30% damage, each level', baseCost: 1, growth: 1.35, maxLevel: 200 },
  { id: 'yolk', name: 'Yolk Sac', blurb: 'Start each run with more biomass', baseCost: 2, growth: 1.6, maxLevel: 40 },
  { id: 'dreams', name: 'Deep Dreams', blurb: 'Earn more, and longer, while away', baseCost: 3, growth: 1.7, maxLevel: 10 },
  { id: 'instinct', name: 'Instinct', blurb: 'Buys upgrades and fires Frenzy for you', baseCost: 8, growth: 1, maxLevel: 1 },
];

export type MutationId =
  | 'volatile' | 'serrated' | 'caustic' | 'hive' | 'sweet'
  | 'gorger' | 'livewire' | 'heartseeker' | 'thorough' | 'ironjaw';

export type BuildTag = 'Blast' | 'Grind' | 'Acid' | 'Swarm' | 'Harvest' | 'Frenzy' | 'Bite';

export interface MutationDef {
  id: MutationId;
  name: string;
  tag: BuildTag;
  gain: string;
  cost: string | null; // the tradeoff, if there is one
  maxLevel: number;
}

// One is chosen after every planet and lasts until the next molt. Most carry a
// real cost, so a build is a set of decisions and not a list of free bonuses.
export const MUTATIONS: MutationDef[] = [
  { id: 'volatile', name: 'Volatile Blood', tag: 'Blast', gain: 'Blisters reach 1 ring farther and hit 50% harder', cost: 'Bite damage -15%', maxLevel: 3 },
  { id: 'livewire', name: 'Live Wire', tag: 'Blast', gain: 'Pulse blocks burst like blisters and charge Frenzy twice as fast', cost: null, maxLevel: 2 },
  { id: 'serrated', name: 'Serrated Hide', tag: 'Grind', gain: 'Body grinding x3', cost: 'Bite damage -30%', maxLevel: 3 },
  { id: 'caustic', name: 'Caustic Glands', tag: 'Acid', gain: 'Spit fires 50% faster, with a wider splash', cost: 'Crawl speed -15%', maxLevel: 3 },
  { id: 'hive', name: 'Hive Mother', tag: 'Swarm', gain: 'Hatchling damage x3', cost: 'Bite rate -25%', maxLevel: 3 },
  { id: 'sweet', name: 'Sweet Tooth', tag: 'Harvest', gain: 'Nectar pays x3, and the worm hunts it hard', cost: 'Other blocks pay -40%', maxLevel: 3 },
  { id: 'thorough', name: 'Thorough', tag: 'Harvest', gain: 'All blocks pay +40%', cost: 'The heart stays hidden until 12% of the planet remains', maxLevel: 3 },
  { id: 'heartseeker', name: 'Heartseeker', tag: 'Bite', gain: 'Hunts the heart early, and hearts pay x3', cost: 'Leftover blocks pay nothing', maxLevel: 3 },
  { id: 'ironjaw', name: 'Iron Jaw', tag: 'Bite', gain: 'Bite damage x2.5', cost: 'Crawl speed -30%', maxLevel: 3 },
  { id: 'gorger', name: 'Gorger', tag: 'Frenzy', gain: 'Frenzy lasts 60% longer and doubles biomass', cost: null, maxLevel: 2 },
];

export const MOLT = {
  unlockPlanet: 5, // zero-based: must reach the 6th planet
  baseChitin: 2,
  chitinGrowth: 1.2, // each planet past the unlock is worth this much more
};

export const OFFLINE = {
  baseShare: 0.4,
  sharePerLevel: 0.08,
  baseHours: 4,
  hoursPerLevel: 2,
  minSeconds: 45,
};

export const SAVE_KEY = 'wyrmhole.save.v1';
