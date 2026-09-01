/**
 * Shared constructors for document-level test values.
 *
 * These are document values — ids, color codes, transforms, mates — not part
 * geometry. Parser fixtures use real captured part data; nothing here stands in for
 * that.
 *
 * Production code never fabricates a `BrickId`/`GroupId`: it mints one
 * (`mintBrickId`/`mintGroupId`) or validates one arriving from outside
 * (`asBrickId`/`asGroupId`). Tests want short, readable, deterministic ids instead —
 * `testBrickId`/`testGroupId` cast a plain label directly, and every constructor
 * below takes plain string labels and casts internally, so call sites never need
 * their own cast.
 */

import type { BrickId, EdgeId, GroupId, Mat4 } from '../types.ts';
import type { Mate, SnapKind } from '../snap/types.ts';
import type { MateLink } from './graph.ts';
import { edgeIdFor } from './graph.ts';
import { fromTranslation } from '../math.ts';
import type { BrickInstance, ConnectionEdge, GroupDef } from './types.ts';

export const testBrickId = (label: string): BrickId => label as BrickId;
export const testGroupId = (label: string): GroupId => label as GroupId;

/** The id a pair of test labels would derive, without a caller reaching for `edgeIdFor` directly. */
export const testEdgeId = (a: string, b: string): EdgeId =>
  edgeIdFor(testBrickId(a), testBrickId(b));

export const brick = (
  id: string,
  overrides: Partial<Omit<BrickInstance, 'id' | 'groupId'>> & { groupId?: string } = {},
): BrickInstance => {
  const value: BrickInstance = {
    id: testBrickId(id),
    partId: overrides.partId ?? '3001',
    colorCode: overrides.colorCode ?? 4,
    transform: overrides.transform ?? fromTranslation([0, 0, 0]),
  };
  if (overrides.groupId !== undefined) value.groupId = testGroupId(overrides.groupId);
  return value;
};

export const group = (id: string, name = id, parentId?: string): GroupDef => {
  const value: GroupDef = { id: testGroupId(id), name };
  if (parentId !== undefined) value.parentId = testGroupId(parentId);
  return value;
};

/** A stud mate: `a` carries the male half unless told otherwise. */
export const mate = (
  aPoint: string,
  bPoint: string,
  polarity: Mate['polarity'] = 'a',
  kind: SnapKind = 'cyl',
): Mate => ({ aPoint, bPoint, kind, polarity });

export const link = (a: string, b: string, mates: readonly Mate[]): MateLink => ({
  a: testBrickId(a),
  b: testBrickId(b),
  mates,
});

/** A whole edge, with the id the contract derives from the brick pair. */
export const edge = (a: string, b: string, mates: readonly Mate[]): ConnectionEdge => ({
  id: testEdgeId(a, b),
  a: testBrickId(a),
  b: testBrickId(b),
  mates,
});

/**
 * Studs pitch 20 LDU, a plate is 8 LDU, and +Y points down, so stacking upward is
 * negative Y. Written as `0 - n` so that zero never comes out as -0, which compares
 * unequal to the 0 a matrix round trip produces.
 */
export const studOffset = (x: number, plates: number, z: number): Mat4 =>
  fromTranslation([x * 20, 0 - plates * 8, z * 20]);
