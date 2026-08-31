/**
 * Shared constructors for document-level test values.
 *
 * These are document values — ids, colour codes, transforms, mates — not part
 * geometry. Parser fixtures use real captured part data; nothing here stands in for
 * that.
 */

import type { BrickId, Mat4 } from '../types';
import type { Mate, SnapKind } from '../snap/types';
import type { MateLink } from './graph';
import { fromTranslation } from './matrix';
import type { BrickInstance, GroupDef } from './types';

export const brick = (
  id: BrickId,
  overrides: Partial<Omit<BrickInstance, 'id'>> = {},
): BrickInstance => {
  const value: BrickInstance = {
    id,
    partId: overrides.partId ?? '3001',
    colorCode: overrides.colorCode ?? 4,
    transform: overrides.transform ?? fromTranslation([0, 0, 0]),
  };
  if (overrides.groupId !== undefined) value.groupId = overrides.groupId;
  return value;
};

export const group = (id: string, name = id, parentId?: string): GroupDef => {
  const value: GroupDef = { id, name };
  if (parentId !== undefined) value.parentId = parentId;
  return value;
};

/** A stud mate: `a` carries the male half unless told otherwise. */
export const mate = (
  aPoint: string,
  bPoint: string,
  polarity: Mate['polarity'] = 'a',
  kind: SnapKind = 'cyl',
): Mate => ({ aPoint, bPoint, kind, polarity });

export const link = (a: BrickId, b: BrickId, mates: readonly Mate[]): MateLink => ({ a, b, mates });

/**
 * Studs pitch 20 LDU, a plate is 8 LDU, and +Y points down, so stacking upward is
 * negative Y. Written as `0 - n` so that zero never comes out as -0, which compares
 * unequal to the 0 a matrix round trip produces.
 */
export const studOffset = (x: number, plates: number, z: number): Mat4 =>
  fromTranslation([x * 20, 0 - plates * 8, z * 20]);
