import { BLOCK, PLANET } from './config.ts';
import { hexDistance, hexToWorldX, hexToWorldY, NEIGHBOURS, worldToHex } from './hex.ts';
import { makeRng, type Rng } from './rng.ts';

export interface Planet {
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
  cells: Int32Array; // grid indices of every cell that started solid
  total: number;
  remaining: number;
  heart: number; // grid index
}

const NAME_A = ['Ossa', 'Vel', 'Mir', 'Kho', 'Thessa', 'Ul', 'Nyx', 'Bara', 'Sol', 'Quor', 'Ae', 'Zhen', 'Ira', 'Dun'];
const NAME_B = ['thar', 'ion', 'ara', 'mos', 'ite', 'ula', 'esh', 'oma', 'ith', 'ek', 'une', 'axis'];
const NAME_C = ['Prime', 'Minor', 'Major', 'IV', 'VII', 'Deep', 'Reach', 'Hollow', 'Rest', ''];

function planetName(rng: Rng): string {
  const pick = (list: string[]) => list[Math.floor(rng() * list.length)];
  return `${pick(NAME_A)}${pick(NAME_B)} ${pick(NAME_C)}`.trim();
}

const idx = (p: { radius: number; size: number }, q: number, r: number) => q + p.radius + (r + p.radius) * p.size;

export function planetRadius(index: number): number {
  return Math.min(PLANET.maxRadius, PLANET.baseRadius + Math.floor(index / PLANET.radiusEvery));
}

export function planetHpScale(index: number): number {
  return PLANET.hpBase * PLANET.hpGrowth ** index;
}

export function planetValueScale(index: number): number {
  return PLANET.valueBase * PLANET.valueGrowth ** index;
}

export function makePlanet(index: number, seed: number): Planet {
  const rng = makeRng(seed);
  const radius = planetRadius(index);
  const size = radius * 2 + 1;
  const n = size * size;
  const p: Planet = {
    index,
    seed,
    name: planetName(rng),
    hue: 150 + ((index * 47) % 170),
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
    cells: new Int32Array(0),
    total: 0,
    remaining: 0,
    heart: 0,
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
      p.kind[i] = BLOCK.CRUST;
      p.depth[i] = d / radius;
      cells.push(i);
    }
  }

  // Veins of nectar wander through the crust.
  const veins = PLANET.nectarVeins + Math.floor(radius * PLANET.nectarVeinsPerRing);
  for (let v = 0; v < veins; v++) {
    let q = Math.floor(rng() * size) - radius;
    let r = Math.floor(rng() * size) - radius;
    const steps = 3 + Math.floor(rng() * 5);
    for (let s = 0; s < steps; s++) {
      if (hexDistance(q, r) <= radius) {
        const i = idx(p, q, r);
        if (p.kind[i] === BLOCK.CRUST) p.kind[i] = BLOCK.NECTAR;
      }
      const [dq, dr] = NEIGHBOURS[Math.floor(rng() * 6)];
      q += dq;
      r += dr;
    }
  }

  for (const i of cells) {
    if (p.kind[i] !== BLOCK.CRUST) continue;
    const roll = rng();
    if (roll < PLANET.pulseChance) p.kind[i] = BLOCK.PULSE;
    else if (roll < PLANET.pulseChance + PLANET.blisterChance) p.kind[i] = BLOCK.BLISTER;
  }

  const hpScale = planetHpScale(index);
  const valueScale = planetValueScale(index);
  let totalHp = 0;
  let totalValue = 0;
  for (const i of cells) {
    const depthMul = 1 + PLANET.depthBonus * (1 - p.depth[i]) ** 1.5;
    const nectar = p.kind[i] === BLOCK.NECTAR;
    p.maxHp[i] = hpScale * depthMul * (nectar ? PLANET.nectarHp : 1);
    p.hp[i] = p.maxHp[i];
    p.value[i] = valueScale * depthMul * (nectar ? PLANET.nectarValue : 1);
    totalHp += p.maxHp[i];
    totalValue += p.value[i];
  }

  const heart = idx(p, 0, 0);
  p.heart = heart;
  p.kind[heart] = BLOCK.HEART;
  p.maxHp[heart] = totalHp * PLANET.heartHpShare;
  p.hp[heart] = p.maxHp[heart];
  p.value[heart] = totalValue * PLANET.heartValueShare;

  p.cells = Int32Array.from(cells);
  p.total = cells.length;
  p.remaining = cells.length;
  p.worldRadius = hexToWorldX(radius, 0) + 10;
  return p;
}

const scratch = { q: 0, r: 0 };

/** Grid index of the planet cell at a world position, or -1 outside the grid. */
export function cellAt(p: Planet, x: number, y: number): number {
  worldToHex(x, y, scratch);
  const { q, r } = scratch;
  if (hexDistance(q, r) > p.radius) return -1;
  return idx(p, q, r);
}

/** Grid index of a neighbouring cell, or -1 outside the grid. */
export function neighbourOf(p: Planet, i: number, dir: number): number {
  const q = (i % p.size) - p.radius + NEIGHBOURS[dir][0];
  const r = Math.floor(i / p.size) - p.radius + NEIGHBOURS[dir][1];
  if (hexDistance(q, r) > p.radius) return -1;
  return idx(p, q, r);
}

/** Calls fn for every cell within `rings` of the centre cell, including the centre. */
export function forEachInRange(p: Planet, i: number, rings: number, fn: (cell: number) => void): void {
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
