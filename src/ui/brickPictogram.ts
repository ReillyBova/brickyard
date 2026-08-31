/** Pure helpers for `AxonBrick`, split out so that file exports only the component. */

export type BrickTone = 'clay' | 'deepClay' | 'sage' | 'neutral';

/** How many studs to paint, and which face geometry reads best at that count. */
export type StudCount = 1 | 2 | 4;

const TONE_CYCLE: readonly BrickTone[] = ['clay', 'sage', 'neutral', 'deepClay'];

/** Deterministic tone per part id, so a tile doesn't change colour on re-render. */
export function toneForId(id: string): BrickTone {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return TONE_CYCLE[hash % TONE_CYCLE.length];
}

/** Reads "N x M" out of an LDraw title to pick a plausible stud count, capped at 4. */
export function studsForTitle(title: string): StudCount {
  const match = /(\d+)\s*x\s*(\d+)/i.exec(title);
  if (match === null) return 1;
  const product = Number(match[1]) * Number(match[2]);
  if (product <= 1) return 1;
  if (product === 2) return 2;
  return 4;
}
