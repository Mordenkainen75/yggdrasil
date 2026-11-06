import type { RuneId } from '../game/config.ts';

// The Elder Futhark shapes as straight strokes, on a 10 by 12 grid. They were
// made to be carved, so they suit line art and need no special font, which
// keeps them safe on phones that lack a runic typeface.
const STROKES: Record<RuneId, string[]> = {
  fehu: ['3 0 3 12', '3 4 8 1', '3 7 8 4'],
  uruz: ['2 12 2 0 8 5 8 12'],
  thurisaz: ['3 0 3 12', '3 3 7 6 3 9'],
  ansuz: ['3 0 3 12', '3 1 8 4', '3 4 8 7'],
  kenaz: ['7 1 3 6 7 11'],
  wunjo: ['3 0 3 12', '3 0 7 3 3 6'],
  hagalaz: ['2 0 2 12', '8 0 8 12', '2 4 8 8'],
  jera: ['5 1 2 4 5 7', '5 5 8 8 5 11'],
  sowilo: ['7 0 3 5 7 7 3 12'],
  tiwaz: ['5 0 5 12', '1 4 5 0 9 4'],
};

/** Inline SVG for a rune, for use inside HTML strings. */
export function runeGlyph(id: RuneId): string {
  const lines = STROKES[id].map((points) => `<polyline points="${points}"/>`).join('');
  return `<svg class="rune-glyph" viewBox="-1 -1 12 14" aria-hidden="true">${lines}</svg>`;
}
