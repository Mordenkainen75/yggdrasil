import { SAVE_KEY } from './config.ts';
import { makeRegion } from './region.ts';
import { makeShip, newGame, placeShip, resetTrail, zeroRunes, zeroPerks, zeroUpgrades, type GameState } from './state.ts';
import type { RuneId } from './config.ts';

interface SaveFile {
  v: 1;
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
  upgrades: Record<string, number>;
  perks: Record<string, number>;
  runes: Record<string, number>;
  runePicks: number;
  runeOffer: RuneId[] | null;
  regionSeed: number;
  kind: number[]; // sparse: only cells that started solid, in p.cells order
  hp: number[];
  berserkCharge: number;
  rate: number;
  ship: { x: number; y: number; angle: number };
  lastSeen: number;
}

export function serialize(s: GameState, now: number): string {
  const p = s.region;
  const inPlay = s.phase === 'mining';
  const file: SaveFile = {
    v: 1,
    seed: s.seed,
    time: s.time,
    silver: s.silver,
    runSilver: s.runSilver,
    lifetimeSilver: s.lifetimeSilver,
    glory: s.glory,
    sagas: s.sagas,
    regionIndex: s.regionIndex,
    runBestRegion: s.runBestRegion,
    bestRegion: s.bestRegion,
    regionsMined: s.regionsMined,
    upgrades: s.upgrades,
    perks: s.perks,
    runes: s.runes,
    runePicks: s.runePicks,
    runeOffer: s.runeOffer,
    regionSeed: p.seed,
    kind: inPlay ? Array.from(p.cells, (i) => p.kind[i]) : [],
    hp: inPlay ? Array.from(p.cells, (i) => Number(p.hp[i].toPrecision(5))) : [],
    berserkCharge: s.berserkCharge,
    rate: s.rate,
    ship: { x: s.ship.x, y: s.ship.y, angle: s.ship.angle },
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
  if (!f || f.v !== 1 || typeof f.seed !== 'number' || typeof f.regionSeed !== 'number') return null;

  const s = newGame(f.seed);
  s.time = f.time;
  s.silver = f.silver;
  s.runSilver = f.runSilver;
  s.lifetimeSilver = f.lifetimeSilver;
  s.glory = f.glory;
  s.sagas = f.sagas;
  s.regionIndex = f.regionIndex;
  s.runBestRegion = f.runBestRegion;
  s.bestRegion = f.bestRegion;
  s.regionsMined = f.regionsMined;
  // Spreading over zeroes means upgrades added in later versions start at 0.
  s.upgrades = { ...zeroUpgrades(), ...f.upgrades };
  s.perks = { ...zeroPerks(), ...f.perks };
  s.runes = { ...zeroRunes(), ...f.runes };
  s.runePicks = f.runePicks ?? 0;
  s.runeOffer = f.runeOffer ?? null;
  s.berserkCharge = f.berserkCharge;
  s.rate = f.rate;
  s.lastSeen = f.lastSeen;

  const p = makeRegion(f.regionIndex, f.regionSeed);
  s.region = p;
  s.ship = makeShip();
  if (f.kind.length === p.cells.length) {
    p.remaining = 0;
    p.cells.forEach((cell, n) => {
      p.kind[cell] = f.kind[n];
      p.hp[cell] = f.hp[n];
      if (f.kind[n] !== 0) p.remaining += 1;
    });
    s.ship.x = f.ship.x;
    s.ship.y = f.ship.y;
    s.ship.angle = f.ship.angle;
    resetTrail(s.ship);
  } else {
    placeShip(s.ship, p, f.regionSeed);
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
