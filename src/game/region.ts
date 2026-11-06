import { BLOCK, REGION } from './config.ts';
import { hexDistance, hexToWorldX, hexToWorldY, NEIGHBOURS, worldToHex } from './hex.ts';
import { makeRng, type Rng } from './rng.ts';

export interface Region {
  index: number;
  seed: number;
  name: string;
  hue: number;
  radius: number; // rings
  worldRadius: number;
  size: number; // grid width, 2 * radius + 1
  kind: Uint8Array;
  hp: Float64Array;
  maxHp: Float64Array;
  value: Float64Array;
  wx: Float32Array;
  wy: Float32Array;
  depth: Float32Array; // 1 at the surface, 0 at the core
  seen: Uint8Array; // 1 once revealed; everything else is under fog
  cells: Int32Array; // grid indices of every cell that started solid
  total: number;
  remaining: number;
  core: number; // grid index
  coreOpen: boolean; // sealed until enough of the region is mined
}

const NAME_A = ['Skarn', 'Jarn', 'Grim', 'Ulf', 'Hrafn', 'Stein', 'Kol', 'Myrk', 'Thorn', 'Bjorn', 'Vig', 'Eld', 'Frost', 'Sig'];
const NAME_B = ['holt', 'fell', 'gard', 'vik', 'dal', 'mark', 'fjord', 'berg', 'nes', 'stad', 'haug', 'heim'];
const NAME_C = ['Deep', 'Reach', 'Hollow', 'Shaft', 'Seam', 'Barrow', 'Cut', '', '', ''];

// Midgard's stone: slate, rust, moss, iron and so on. The renderer keeps these muted.
const STONE_HUES = [215, 28, 150, 200, 8, 265, 45];

function regionName(rng: Rng): string {
  const pick = (list: string[]) => list[Math.floor(rng() * list.length)];
  return `${pick(NAME_A)}${pick(NAME_B)} ${pick(NAME_C)}`.trim();
}

const idx = (p: { radius: number; size: number }, q: number, r: number) => q + p.radius + (r + p.radius) * p.size;

export function regionRadius(index: number): number {
  return Math.min(REGION.maxRadius, REGION.baseRadius + index * REGION.radiusPerRegion);
}

/** Each region's map comes from the generation's seed, so a reload rebuilds the same one. */
export function regionSeed(seed: number, index: number): number {
  return (seed + index * 104729) | 0;
}

export function regionHpScale(index: number): number {
  return REGION.hpBase * REGION.hpGrowth ** index;
}

export function regionValueScale(index: number): number {
  return REGION.valueBase * REGION.valueGrowth ** index;
}

export function makeRegion(index: number, seed: number): Region {
  const rng = makeRng(seed);
  const radius = regionRadius(index);
  const size = radius * 2 + 1;
  const n = size * size;
  const p: Region = {
    index,
    seed,
    name: regionName(rng),
    hue: STONE_HUES[index % STONE_HUES.length],
    radius,
    worldRadius: 0,
    size,
    kind: new Uint8Array(n),
    hp: new Float64Array(n),
    maxHp: new Float64Array(n),
    value: new Float64Array(n),
    wx: new Float32Array(n),
    wy: new Float32Array(n),
    depth: new Float32Array(n),
    seen: new Uint8Array(n),
    cells: new Int32Array(0),
    total: 0,
    remaining: 0,
    core: 0,
    coreOpen: false,
  };

  // Lumpy outline: a disc pushed in and out by a few slow waves.
  const phase = [rng() * 6.28, rng() * 6.28, rng() * 6.28];
  const edgeAt = (angle: number) =>
    radius * (0.9 + 0.07 * Math.sin(angle * 2 + phase[0]) + 0.05 * Math.sin(angle * 3 + phase[1]) + 0.03 * Math.sin(angle * 5 + phase[2]));

  const cells: number[] = [];
  for (let r = -radius; r <= radius; r++) {
    for (let q = -radius; q <= radius; q++) {
      const d = hexDistance(q, r);
      if (d > radius) continue;
      const i = idx(p, q, r);
      p.wx[i] = hexToWorldX(q, r);
      p.wy[i] = hexToWorldY(r);
      const angle = Math.atan2(p.wy[i], p.wx[i]);
      if (d > edgeAt(angle) + 0.5) continue;
      p.kind[i] = BLOCK.ROCK;
      p.depth[i] = d / radius;
      cells.push(i);
    }
  }

  // Veins of gold wander through the rock.
  const veins = Math.round(cells.length / REGION.hexesPerGoldVein);
  const [minSteps, maxSteps] = REGION.goldVeinSteps;
  for (let v = 0; v < veins; v++) {
    let q = Math.floor(rng() * size) - radius;
    let r = Math.floor(rng() * size) - radius;
    const steps = minSteps + Math.floor(rng() * (maxSteps - minSteps + 1));
    for (let s = 0; s < steps; s++) {
      if (hexDistance(q, r) <= radius) {
        const i = idx(p, q, r);
        if (p.kind[i] === BLOCK.ROCK) p.kind[i] = BLOCK.GOLD;
      }
      const [dq, dr] = NEIGHBOURS[Math.floor(rng() * 6)];
      q += dq;
      r += dr;
    }
  }

  for (const i of cells) {
    if (p.kind[i] !== BLOCK.ROCK) continue;
    const roll = rng();
    if (roll < REGION.meadChance) p.kind[i] = BLOCK.MEAD;
    else if (roll < REGION.meadChance + REGION.gasChance) p.kind[i] = BLOCK.GAS;
  }

  const hpScale = regionHpScale(index);
  const valueScale = regionValueScale(index);
  let totalHp = 0;
  let totalValue = 0;
  for (const i of cells) {
    const depthMul = 1 + REGION.depthBonus * (1 - p.depth[i]) ** 1.5;
    const gold = p.kind[i] === BLOCK.GOLD;
    p.maxHp[i] = hpScale * depthMul * (gold ? REGION.goldHp : 1);
    p.hp[i] = p.maxHp[i];
    p.value[i] = valueScale * depthMul * (gold ? REGION.goldValue : 1);
    totalHp += p.maxHp[i];
    totalValue += p.value[i];
  }

  const core = idx(p, 0, 0);
  p.core = core;
  p.kind[core] = BLOCK.CORE;
  p.maxHp[core] = totalHp * REGION.coreHpShare;
  p.hp[core] = p.maxHp[core];
  p.value[core] = totalValue * REGION.coreValueShare;

  p.cells = Int32Array.from(cells);
  p.total = cells.length;
  p.remaining = cells.length;
  p.worldRadius = hexToWorldX(radius, 0) + 10;
  return p;
}

const scratch = { q: 0, r: 0 };

/** Grid index of the region cell at a world position, or -1 outside the grid. */
export function cellAt(p: Region, x: number, y: number): number {
  worldToHex(x, y, scratch);
  const { q, r } = scratch;
  if (hexDistance(q, r) > p.radius) return -1;
  return idx(p, q, r);
}

/** Grid index of a neighbouring cell, or -1 outside the grid. */
export function neighbourOf(p: Region, i: number, dir: number): number {
  const q = (i % p.size) - p.radius + NEIGHBOURS[dir][0];
  const r = Math.floor(i / p.size) - p.radius + NEIGHBOURS[dir][1];
  if (hexDistance(q, r) > p.radius) return -1;
  return idx(p, q, r);
}

/** Calls fn for every cell within `rings` of the centre cell, including the centre. */
export function forEachInRange(p: Region, i: number, rings: number, fn: (cell: number) => void): void {
  const cq = (i % p.size) - p.radius;
  const cr = Math.floor(i / p.size) - p.radius;
  for (let dq = -rings; dq <= rings; dq++) {
    for (let dr = Math.max(-rings, -dq - rings); dr <= Math.min(rings, -dq + rings); dr++) {
      const q = cq + dq;
      const r = cr + dr;
      if (hexDistance(q, r) <= p.radius) fn(idx(p, q, r));
    }
  }
}
