import { MOLT, MUTATIONS, OFFLINE, PERKS, UPGRADES, WORM, type MutationId, type PerkId, type UpgradeId } from './config.ts';
import { makePlanet, type Planet } from './planet.ts';

export type GameEvent =
  | { t: 'hit'; cell: number }
  | { t: 'eat'; x: number; y: number; kind: number; value: number; hue: number }
  | { t: 'burst'; x: number; y: number }
  | { t: 'spit'; x0: number; y0: number; x1: number; y1: number }
  | { t: 'heart'; x: number; y: number; bonus: number }
  | { t: 'planet'; name: string; index: number }
  | { t: 'frenzy' }
  | { t: 'lure'; x: number; y: number };

export interface Hatchling {
  x: number;
  y: number;
  target: number;
  cooldown: number;
}

const TRAIL_SAMPLES = 520; // enough for the longest possible body

export interface Worm {
  x: number;
  y: number;
  angle: number;
  target: number;
  retarget: number;
  biteTimer: number;
  grindTimer: number;
  spitTimer: number;
  biting: boolean;
  trail: Float32Array; // ring buffer of x,y pairs
  trailHead: number;
  sinceSample: number;
}

export interface GameState {
  seed: number;
  time: number;
  biomass: number;
  runBiomass: number;
  lifetimeBiomass: number;
  chitin: number;
  molts: number;
  planetIndex: number;
  runBestPlanet: number;
  bestPlanet: number;
  planetsEaten: number;
  upgrades: Record<UpgradeId, number>;
  perks: Record<PerkId, number>;
  mutations: Record<MutationId, number>;
  mutationPicks: number; // choices earned and waiting; they never expire
  mutationOffer: MutationId[] | null;
  planet: Planet;
  worm: Worm;
  brood: Hatchling[];
  frenzyCharge: number;
  frenzyLeft: number;
  phase: 'eating' | 'collapse';
  phaseLeft: number;
  lure: { x: number; y: number; left: number } | null;
  rate: number; // smoothed biomass per second
  rateWindow: number;
  rateTimer: number;
  autoTimer: number;
  lastSeen: number; // wall clock, ms
  events: GameEvent[];
}

export function zeroUpgrades(): Record<UpgradeId, number> {
  return Object.fromEntries(UPGRADES.map((u) => [u.id, 0])) as Record<UpgradeId, number>;
}

export function zeroPerks(): Record<PerkId, number> {
  return Object.fromEntries(PERKS.map((p) => [p.id, 0])) as Record<PerkId, number>;
}

export function zeroMutations(): Record<MutationId, number> {
  return Object.fromEntries(MUTATIONS.map((m) => [m.id, 0])) as Record<MutationId, number>;
}

export function makeWorm(): Worm {
  return {
    x: 0,
    y: 0,
    angle: 0,
    target: -1,
    retarget: 0,
    biteTimer: 0,
    grindTimer: WORM.grindEvery,
    spitTimer: 2,
    biting: false,
    trail: new Float32Array(TRAIL_SAMPLES * 2),
    trailHead: 0,
    sinceSample: 0,
  };
}

/** Puts the worm in space beside the planet with its body trailing straight behind it. */
export function placeWorm(w: Worm, p: Planet, seed: number): void {
  const a = ((seed * 2654435761) >>> 0) / 4294967296 * Math.PI * 2;
  const dist = p.worldRadius + 70;
  w.x = Math.cos(a) * dist;
  w.y = Math.sin(a) * dist;
  w.angle = a + Math.PI;
  w.target = -1;
  w.retarget = 0;
  w.biting = false;
  resetTrail(w);
}

export function resetTrail(w: Worm): void {
  const samples = w.trail.length / 2;
  for (let i = 0; i < samples; i++) {
    const back = i * WORM.trailSampleDist;
    w.trail[i * 2] = w.x - Math.cos(w.angle) * back;
    w.trail[i * 2 + 1] = w.y - Math.sin(w.angle) * back;
  }
  w.trailHead = 0;
  w.sinceSample = 0;
}

export function pushTrail(w: Worm): void {
  const samples = w.trail.length / 2;
  w.trailHead = (w.trailHead - 1 + samples) % samples;
  w.trail[w.trailHead * 2] = w.x;
  w.trail[w.trailHead * 2 + 1] = w.y;
}

/** Position of a body segment; segment 0 sits just behind the head. */
export function segmentPos(w: Worm, seg: number, out: { x: number; y: number }): void {
  const samples = w.trail.length / 2;
  const i = (w.trailHead + (seg + 1) * WORM.samplesPerSegment) % samples;
  out.x = w.trail[i * 2];
  out.y = w.trail[i * 2 + 1];
}

export function newGame(seed = (Math.random() * 2 ** 31) | 0): GameState {
  const planet = makePlanet(0, seed);
  const worm = makeWorm();
  placeWorm(worm, planet, seed);
  return {
    seed,
    time: 0,
    biomass: 0,
    runBiomass: 0,
    lifetimeBiomass: 0,
    chitin: 0,
    molts: 0,
    planetIndex: 0,
    runBestPlanet: 0,
    bestPlanet: 0,
    planetsEaten: 0,
    upgrades: zeroUpgrades(),
    perks: zeroPerks(),
    mutations: zeroMutations(),
    mutationPicks: 0,
    mutationOffer: null,
    planet,
    worm,
    brood: [],
    frenzyCharge: 0,
    frenzyLeft: 0,
    phase: 'eating',
    phaseLeft: 0,
    lure: null,
    rate: 0,
    rateWindow: 0,
    rateTimer: 1,
    autoTimer: 1,
    lastSeen: Date.now(),
    events: [],
  };
}

export const MOLT_READY = (s: GameState) => s.runBestPlanet >= MOLT.unlockPlanet;

export function offlineShare(s: GameState): number {
  return OFFLINE.baseShare + OFFLINE.sharePerLevel * s.perks.dreams;
}

export function offlineCapSeconds(s: GameState): number {
  return (OFFLINE.baseHours + OFFLINE.hoursPerLevel * s.perks.dreams) * 3600;
}
