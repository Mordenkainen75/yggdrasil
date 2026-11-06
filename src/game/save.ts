import { SAVE_KEY } from './config.ts';
import { makePlanet } from './planet.ts';
import { makeWorm, newGame, placeWorm, resetTrail, zeroMutations, zeroPerks, zeroUpgrades, type GameState } from './state.ts';
import type { MutationId } from './config.ts';

interface SaveFile {
  v: 1;
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
  upgrades: Record<string, number>;
  perks: Record<string, number>;
  mutations: Record<string, number>;
  mutationPicks: number;
  mutationOffer: MutationId[] | null;
  planetSeed: number;
  kind: number[]; // sparse: only cells that started solid, in p.cells order
  hp: number[];
  frenzyCharge: number;
  rate: number;
  worm: { x: number; y: number; angle: number };
  lastSeen: number;
}

export function serialize(s: GameState, now: number): string {
  const p = s.planet;
  const inPlay = s.phase === 'eating';
  const file: SaveFile = {
    v: 1,
    seed: s.seed,
    time: s.time,
    biomass: s.biomass,
    runBiomass: s.runBiomass,
    lifetimeBiomass: s.lifetimeBiomass,
    chitin: s.chitin,
    molts: s.molts,
    planetIndex: s.planetIndex,
    runBestPlanet: s.runBestPlanet,
    bestPlanet: s.bestPlanet,
    planetsEaten: s.planetsEaten,
    upgrades: s.upgrades,
    perks: s.perks,
    mutations: s.mutations,
    mutationPicks: s.mutationPicks,
    mutationOffer: s.mutationOffer,
    planetSeed: p.seed,
    kind: inPlay ? Array.from(p.cells, (i) => p.kind[i]) : [],
    hp: inPlay ? Array.from(p.cells, (i) => Number(p.hp[i].toPrecision(5))) : [],
    frenzyCharge: s.frenzyCharge,
    rate: s.rate,
    worm: { x: s.worm.x, y: s.worm.y, angle: s.worm.angle },
    lastSeen: now,
  };
  return JSON.stringify(file);
}

/** Rebuilds a game from save text. Returns null if the text is unusable. */
export function deserialize(text: string): GameState | null {
  let f: SaveFile;
  try {
    f = JSON.parse(text) as SaveFile;
  } catch {
    return null;
  }
  if (!f || f.v !== 1 || typeof f.seed !== 'number' || typeof f.planetSeed !== 'number') return null;

  const s = newGame(f.seed);
  s.time = f.time;
  s.biomass = f.biomass;
  s.runBiomass = f.runBiomass;
  s.lifetimeBiomass = f.lifetimeBiomass;
  s.chitin = f.chitin;
  s.molts = f.molts;
  s.planetIndex = f.planetIndex;
  s.runBestPlanet = f.runBestPlanet;
  s.bestPlanet = f.bestPlanet;
  s.planetsEaten = f.planetsEaten;
  // Spreading over zeroes means upgrades added in later versions start at 0.
  s.upgrades = { ...zeroUpgrades(), ...f.upgrades };
  s.perks = { ...zeroPerks(), ...f.perks };
  s.mutations = { ...zeroMutations(), ...f.mutations };
  s.mutationPicks = f.mutationPicks ?? 0;
  s.mutationOffer = f.mutationOffer ?? null;
  s.frenzyCharge = f.frenzyCharge;
  s.rate = f.rate;
  s.lastSeen = f.lastSeen;

  const p = makePlanet(f.planetIndex, f.planetSeed);
  s.planet = p;
  s.worm = makeWorm();
  if (f.kind.length === p.cells.length) {
    p.remaining = 0;
    p.cells.forEach((cell, n) => {
      p.kind[cell] = f.kind[n];
      p.hp[cell] = f.hp[n];
      if (f.kind[n] !== 0) p.remaining += 1;
    });
    s.worm.x = f.worm.x;
    s.worm.y = f.worm.y;
    s.worm.angle = f.worm.angle;
    resetTrail(s.worm);
  } else {
    placeWorm(s.worm, p, f.planetSeed);
  }
  return s;
}

export function saveToStorage(s: GameState): void {
  try {
    localStorage.setItem(SAVE_KEY, serialize(s, Date.now()));
  } catch {
    // Storage can be full or blocked. The game keeps running either way.
  }
}

export function loadFromStorage(): GameState | null {
  try {
    const text = localStorage.getItem(SAVE_KEY);
    return text ? deserialize(text) : null;
  } catch {
    return null;
  }
}

export function clearStorage(): void {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    // Nothing to do.
  }
}
