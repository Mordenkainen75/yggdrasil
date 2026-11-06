import type { UpgradeId } from '../game/config.ts';

// Upgrade icons as straight strokes on a 24 by 24 grid. The rank color comes
// from CSS, so an icon changes color as its upgrade ranks up.
const STROKES: Record<UpgradeId, string[]> = {
  drill: ['2 12 12 6 12 18 2 12', '12 8 21 8 21 16 12 16', '6 10 8 14'],
  ravens: ['2 9 8 7 12 11 16 7 22 9', '12 11 12 17', '9 19 12 17 15 19'],
  smelter: ['3 8 21 8', '5 8 7 19 17 19 19 8', '9 5 10 3', '14 5 15 3'],
  forge: ['12 2 7 10 9 13 6 16 9 21 15 21 18 16 15 12 16 9 12 2'],
  haulers: ['3 7 21 7 19 16 5 16 3 7', '7 19 10 19', '14 19 17 19', '12 7 12 16'],
  sweep: ['4 21 4 13 8 7 14 4 21 3', '10 21 10 15 13 11 17 9 21 9'],
  lance: ['3 21 15 9', '13 5 21 3 19 11 13 5'],
  thunder: ['14 2 6 13 11 13 8 22 18 10 13 10 16 2 14 2'],
  pulse: ['4 4 20 4 20 11 4 11 4 4', '12 11 12 21', '9 21 15 21'],
};

/** Inline SVG for an upgrade, for use inside HTML strings. */
export function upgradeIcon(id: UpgradeId): string {
  const lines = STROKES[id].map((points) => `<polyline points="${points}"/>`).join('');
  return `<svg class="upgrade-icon" viewBox="0 0 24 24" aria-hidden="true">${lines}</svg>`;
}
