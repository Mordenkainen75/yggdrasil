import { SAGA, RUNES, OFFLINE, PERKS, UPGRADES, SHIP, type RuneId, type PerkId, type UpgradeId } from './config.ts';
import { makeRegion, type Region } from './region.ts';

export type GameEvent =
  | { t: 'hit'; cell: number }
  | { t: 'mine'; x: number; y: number; kind: number; value: number; hue: number }
  | { t: 'burst'; x: number; y: number }
  | { t: 'bolt'; x0: number; y0: number; x1: number; y1: number }
  | { t: 'core'; x: number; y: number; bonus: number }
  | { t: 'region'; name: string; index: number }
  | { t: 'berserk' }
  | { t: 'waypoint'; x: number; y: number };

export interface Raven {
  x: number;
  y: number;
  target: number;
  cooldown: number;
}

const TRAIL_SAMPLES = 520; // enough for the longest possible convoy

export interface Ship {
  x: number;
  y: number;
  angle: number;
  target: number;
  retarget: number;
  drillTimer: number;
  grindTimer: number;
  thunderTimer: number;
  drilling: boolean;
  trail: Float32Array; // ring buffer of x,y pairs
  trailHead: number;
  sinceSample: number;
}

export interface GameState {
  seed: number;
  time: number;
  silver: number;
  runSilver: number;
  lifetimeSilver: number;
  glory: number;
  sagas: number;
  regionIndex: number;
  runBestRegion: number;
  bestRegion: number;
  regionsMined: number;
  upgrades: Record<UpgradeId, number>;
  perks: Record<PerkId, number>;
  runes: Record<RuneId, number>;
  runePicks: number; // choices earned and waiting; they never expire
  runeOffer: RuneId[] | null;
  region: Region;
  ship: Ship;
  ravens: Raven[];
  berserkCharge: number;
  berserkLeft: number;
  phase: 'mining' | 'collapse';
  phaseLeft: number;
  waypoint: { x: number; y: number; left: number } | null;
  rate: number; // smoothed silver per second
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

export function zeroRunes(): Record<RuneId, number> {
  return Object.fromEntries(RUNES.map((m) => [m.id, 0])) as Record<RuneId, number>;
}

export function makeShip(): Ship {
  return {
    x: 0,
    y: 0,
    angle: 0,
    target: -1,
    retarget: 0,
    drillTimer: 0,
    grindTimer: SHIP.grindEvery,
    thunderTimer: 2,
    drilling: false,
    trail: new Float32Array(TRAIL_SAMPLES * 2),
    trailHead: 0,
    sinceSample: 0,
  };
}

/** Puts the ship in space beside the region with its haulers trailing straight behind it. */
export function placeShip(w: Ship, p: Region, seed: number): void {
  const a = ((seed * 2654435761) >>> 0) / 4294967296 * Math.PI * 2;
  const dist = p.worldRadius + 70;
  w.x = Math.cos(a) * dist;
  w.y = Math.sin(a) * dist;
  w.angle = a + Math.PI;
  w.target = -1;
  w.retarget = 0;
  w.drilling = false;
  resetTrail(w);
}

export function resetTrail(w: Ship): void {
  const samples = w.trail.length / 2;
  for (let i = 0; i < samples; i++) {
    const back = i * SHIP.trailSampleDist;
    w.trail[i * 2] = w.x - Math.cos(w.angle) * back;
    w.trail[i * 2 + 1] = w.y - Math.sin(w.angle) * back;
  }
  w.trailHead = 0;
  w.sinceSample = 0;
}

export function pushTrail(w: Ship): void {
  const samples = w.trail.length / 2;
  w.trailHead = (w.trailHead - 1 + samples) % samples;
  w.trail[w.trailHead * 2] = w.x;
  w.trail[w.trailHead * 2 + 1] = w.y;
}

/** Position of a hauler; segment 0 sits just behind the ship. */
export function segmentPos(w: Ship, seg: number, out: { x: number; y: number }): void {
  const samples = w.trail.length / 2;
  const i = (w.trailHead + (seg + 1) * SHIP.samplesPerSegment) % samples;
  out.x = w.trail[i * 2];
  out.y = w.trail[i * 2 + 1];
}

export function newGame(seed = (Math.random() * 2 ** 31) | 0): GameState {
  const region = makeRegion(0, seed);
  const ship = makeShip();
  placeShip(ship, region, seed);
  return {
    seed,
    time: 0,
    silver: 0,
    runSilver: 0,
    lifetimeSilver: 0,
    glory: 0,
    sagas: 0,
    regionIndex: 0,
    runBestRegion: 0,
    bestRegion: 0,
    regionsMined: 0,
    upgrades: zeroUpgrades(),
    perks: zeroPerks(),
    runes: zeroRunes(),
    runePicks: 0,
    runeOffer: null,
    region,
    ship,
    ravens: [],
    berserkCharge: 0,
    berserkLeft: 0,
    phase: 'mining',
    phaseLeft: 0,
    waypoint: null,
    rate: 0,
    rateWindow: 0,
    rateTimer: 1,
    autoTimer: 1,
    lastSeen: Date.now(),
    events: [],
  };
}

export const SAGA_READY = (s: GameState) => s.runBestRegion >= SAGA.unlockRegion;

export function offlineShare(s: GameState): number {
  return OFFLINE.baseShare + OFFLINE.sharePerLevel * s.perks.hearth;
}

export function offlineCapSeconds(s: GameState): number {
  return (OFFLINE.baseHours + OFFLINE.hoursPerLevel * s.perks.hearth) * 3600;
}
