import { SAVE_KEY } from './config.ts';
import { makeRegion, regionSeed } from './region.ts';
import { makeShip, newGame, placeShip, resetTrail, startUpgrades, zeroRunes, zeroPerks, type GameState } from './state.ts';
import type { RuneId, UpgradeId } from './config.ts';

interface SaveFile {
  v: 2;
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
  firstChoice: Record<string, UpgradeId>;
  perks: Record<string, number>;
  runes: Record<string, number>;
  runePicks: number;
  runeOffer: RuneId[] | null;
  regionSeed: number;
  regionDone: boolean; // saved during a collapse, so load the next region
  kind: number[]; // sparse: only cells that started solid, in p.cells order
  hp: number[];
  seen: string; // one 0 or 1 per cell, same order
  berserkCharge: number;
  rate: number;
  ship: { x: number; y: number; angle: number };
  lastSeen: number;
}

export function serialize(s: GameState, now: number): string {
  const p = s.region;
  const inPlay = s.phase === 'mining';
  const file: SaveFile = {
    v: 2,
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
    firstChoice: s.firstChoice,
    perks: s.perks,
    runes: s.runes,
    runePicks: s.runePicks,
    runeOffer: s.runeOffer,
    regionSeed: p.seed,
    regionDone: !inPlay,
    kind: inPlay ? Array.from(p.cells, (i) => p.kind[i]) : [],
    hp: inPlay ? Array.from(p.cells, (i) => Number(p.hp[i].toPrecision(5))) : [],
    seen: inPlay ? Array.from(p.cells, (i) => p.seen[i]).join('') : '',
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
  if (!f || f.v !== 2 || typeof f.seed !== 'number' || typeof f.regionSeed !== 'number') return null;

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
  s.upgrades = { ...startUpgrades(), ...f.upgrades };
  s.firstChoice = f.firstChoice ?? {};
  s.perks = { ...zeroPerks(), ...f.perks };
  s.runes = { ...zeroRunes(), ...f.runes };
  s.runePicks = f.runePicks ?? 0;
  s.runeOffer = f.runeOffer ?? null;
  s.berserkCharge = f.berserkCharge;
  s.rate = f.rate;
  s.lastSeen = f.lastSeen;

  if (f.regionDone) {
    s.regionIndex += 1;
    s.runBestRegion = Math.max(s.runBestRegion, s.regionIndex);
    s.bestRegion = Math.max(s.bestRegion, s.regionIndex);
  }
  const p = makeRegion(s.regionIndex, f.regionDone ? regionSeed(f.seed, s.regionIndex) : f.regionSeed);
  s.region = p;
  s.ship = makeShip();
  if (f.kind.length === p.cells.length) {
    p.remaining = 0;
    p.cells.forEach((cell, n) => {
      p.kind[cell] = f.kind[n];
      p.hp[cell] = f.hp[n];
      p.seen[cell] = f.seen.charCodeAt(n) === 49 ? 1 : 0;
      if (f.kind[n] !== 0) p.remaining += 1;
    });
    s.ship.x = f.ship.x;
    s.ship.y = f.ship.y;
    s.ship.angle = f.ship.angle;
    resetTrail(s.ship);
  } else {
    placeShip(s.ship, p, p.seed);
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
