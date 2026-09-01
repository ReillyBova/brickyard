/**
 * Which connection points can mate with which.
 *
 * Pure integer work on the packed key from `parseMeta.packKey`, because this runs
 * once per candidate pair on the pointer-move path.
 */

import type { ConnectionPoint, Gender, SectionVariant, SnapKind } from './types.ts';

const KIND_NAME: readonly (SnapKind | null)[] = [null, 'cyl', 'clip', 'finger', 'general'];
const VARIANT_NAME: readonly (SectionVariant | null)[] = [null, 'R', 'S', 'A'];

export interface UnpackedKey {
  kind: SnapKind | null;
  gender: Gender | null;
  variant: SectionVariant | null;
  /** Half-LDU steps; 0 means the point carries no section profile. */
  radiusBucket: number;
  slide: boolean;
}

export function unpackKey(key: number): UnpackedKey {
  return {
    kind: KIND_NAME[key & 0b111] ?? null,
    gender: ((key >> 3) & 0b11) === 1 ? 'M' : ((key >> 3) & 0b11) === 2 ? 'F' : null,
    variant: VARIANT_NAME[(key >> 5) & 0b11] ?? null,
    radiusBucket: (key >> 7) & 0xff,
    slide: ((key >> 15) & 1) === 1,
  };
}

/**
 * Cross-section compatibility.
 *
 * An axle is cross-shaped: it only mates an axle hole, and an axle hole only accepts an
 * axle. That distinction is the whole point of the variant field — a round pin dropped
 * into an axle hole would spin, which is precisely what Technic uses the difference for.
 *
 * Round and square are interchangeable at equal radius. LDraw models a 1x1 brick's
 * underside as a square section (`S 6 4`) while a stud is round (`R 6 4`), and those
 * genuinely do connect.
 */
function variantsMate(a: SectionVariant | null, b: SectionVariant | null): boolean {
  if (a === null || b === null) return a === b;
  if (a === 'A' || b === 'A') return a === b;
  return true; // R and S, in either order
}

/**
 * Compatibility is profile matching, not merely kind and gender.
 *
 * - Cylinders mate cylinders of the opposite gender.
 * - A clip is female by nature and grips a male cylinder — that is how bars, bar-ended
 *   parts and minifig hands holding accessories work.
 * - Hinge fingers mate only each other. LDCad tests SNAP_FGR exclusively among fingers,
 *   and they interlock symmetrically rather than one entering the other.
 * - General points match only within their declared group, which is what the group is for.
 */
export function isCompatible(a: ConnectionPoint, b: ConnectionPoint): boolean {
  return keysCompatible(a.key, b.key, a.group, b.group);
}

/**
 * The single implementation. Takes keys and groups rather than whole points so the
 * spatial index, which stores only those, uses exactly the same rules as everything
 * else — two copies of this logic would agree today and drift later.
 *
 * `group` is compared separately because it does not fit in the packed key.
 */
export function keysCompatible(
  aKey: number,
  bKey: number,
  aGroup: string | undefined,
  bGroup: string | undefined,
): boolean {
  const ka = unpackKey(aKey);
  const kb = unpackKey(bKey);
  if (ka.kind === null || kb.kind === null) return false;
  if (ka.radiusBucket !== kb.radiusBucket) return false;
  if (!variantsMate(ka.variant, kb.variant)) return false;

  const opposed = ka.gender !== null && kb.gender !== null && ka.gender !== kb.gender;

  if (ka.kind === 'finger' || kb.kind === 'finger') {
    // Symmetric, and only among themselves.
    return ka.kind === 'finger' && kb.kind === 'finger' && aGroup === bGroup;
  }
  if (ka.kind === 'general' || kb.kind === 'general') {
    return ka.kind === 'general' && kb.kind === 'general' && aGroup === bGroup && opposed;
  }
  // cyl and clip, in any combination.
  return opposed;
}

/** Hinge fingers have no male half; everything else records which side carries it. */
export function polarityOf(aGender: Gender, bGender: Gender, kind: SnapKind): 'a' | 'b' | 'symmetric' {
  if (kind === 'finger') return 'symmetric';
  if (aGender === 'M' && bGender === 'F') return 'a';
  if (aGender === 'F' && bGender === 'M') return 'b';
  return 'symmetric';
}
