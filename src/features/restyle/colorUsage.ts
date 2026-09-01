/**
 * How many bricks use each color in a document, most-used first.
 *
 * This ordering is the point: a restyle is worth doing on the colors that dominate the
 * model, and scanning a list sorted any other way (by code, alphabetically) buries them.
 *
 * Pure: no three.js imports, no DOM.
 */
import type { BrickInstance } from '../../model/types';

export interface ColorUsage {
  /** LDraw color code, per LDConfig. */
  code: number;
  /** Bricks in the document currently carrying this color. */
  count: number;
}

/** Sorted by count descending; ties broken by color code so the order is stable. */
export function colorUsage(bricks: Iterable<BrickInstance>): ColorUsage[] {
  const counts = new Map<number, number>();
  for (const brick of bricks) {
    counts.set(brick.colorCode, (counts.get(brick.colorCode) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count || a.code - b.code);
}
