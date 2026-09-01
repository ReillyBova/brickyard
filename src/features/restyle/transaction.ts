/**
 * Turning a color mapping into the one `recolor` transaction a restyle commits.
 *
 * The `recolor` operation (`src/model/operations.ts`) already carries `from`/`to` per
 * brick, so inversion is exact and undo restores every original color in one step —
 * this module's only job is building that operation's `changes` list from a
 * source-color -> target-color mapping and giving the transaction a label that reads
 * as a user action, per docs/DESIGN.md ("Undo labels are the canonical name of every
 * operation").
 *
 * Pure: no three.js imports, no DOM.
 */
import type { BrickId } from '../../types';
import type { BrickInstance, Transaction } from '../../model/types';

/** Source LDraw color code -> target LDraw color code. Only entries that change a color belong here. */
export type ColorMapping = ReadonlyMap<number, number>;

/** One brick's recolor, matching the `recolor` operation's `changes` shape. */
export interface RestyleChange {
  id: BrickId;
  from: number;
  to: number;
}

/** Every brick whose current color is remapped to something different. */
export function restyleChanges(
  bricks: Iterable<BrickInstance>,
  mapping: ColorMapping,
): RestyleChange[] {
  const changes: RestyleChange[] = [];
  for (const brick of bricks) {
    const to = mapping.get(brick.colorCode);
    if (to !== undefined && to !== brick.colorCode) {
      changes.push({ id: brick.id, from: brick.colorCode, to });
    }
  }
  return changes;
}

/**
 * Builds the single-transaction restyle, or `null` when the mapping changes nothing —
 * an empty mapping, or one that only maps colors to themselves.
 */
export function buildRestyleTransaction(
  bricks: Iterable<BrickInstance>,
  mapping: ColorMapping,
): Transaction | null {
  const changes = restyleChanges(bricks, mapping);
  if (changes.length === 0) return null;

  return {
    label: `Restyle ${changes.length} ${changes.length === 1 ? 'brick' : 'bricks'}`,
    ops: [{ type: 'recolor', changes }],
  };
}
