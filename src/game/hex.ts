import { HEX_SIZE } from './config.ts';

// Pointy-top hexes in axial coordinates.
const SQRT3 = Math.sqrt(3);

export const NEIGHBOURS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1],
];

export function hexDistance(q: number, r: number): number {
  return (Math.abs(q) + Math.abs(r) + Math.abs(q + r)) / 2;
}

export function hexToWorldX(q: number, r: number): number {
  return HEX_SIZE * SQRT3 * (q + r / 2);
}

export function hexToWorldY(r: number): number {
  return HEX_SIZE * 1.5 * r;
}

/** Nearest hex to a world position. Writes into `out` to avoid allocating in the hot path. */
export function worldToHex(x: number, y: number, out: { q: number; r: number }): void {
  const fq = ((SQRT3 / 3) * x - y / 3) / HEX_SIZE;
  const fr = ((2 / 3) * y) / HEX_SIZE;
  const fs = -fq - fr;
  let q = Math.round(fq);
  let r = Math.round(fr);
  const s = Math.round(fs);
  const dq = Math.abs(q - fq);
  const dr = Math.abs(r - fr);
  const ds = Math.abs(s - fs);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  out.q = q + 0; // turns the -0 that Math.round can return into a plain 0
  out.r = r + 0;
}
