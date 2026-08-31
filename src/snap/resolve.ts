/**
 * Choosing where a piece goes.
 *
 * The cursor is the intent signal. A raycast tells us which brick the pointer is over,
 * where on it, and which face — three filters that together cut the whole spatial index
 * down to a handful of candidates. Ranking is then by proximity to the cursor, not by
 * strength of connection: scoring on mate count would slide a piece toward wherever the
 * most studs engage, away from where it was aimed, which is the difference between a
 * tool that helps and one that argues.
 *
 * `findMates` still runs, but afterwards — to record what engaged, not to decide where
 * the piece lands.
 *
 * The weights below are the product. They are meant to be tuned by using the tool.
 */

import { positionOf } from '../math';
import type { BrickId, Mat4, Vec3 } from '../types';
import { isCompatible } from './compat';
import { findMates, solveMating } from './mating';
import type {
  BrickLookup,
  IndexedPoint,
  MateGroup,
  PartDef,
  SnapCandidate,
  SnapQuery,
  SpatialIndex,
} from './types';

export interface ResolveOptions {
  /**
   * How far from the hit point to look for target connectors, in LDU. Slightly under
   * one stud pitch: far enough that a cursor between two studs still sees both, close
   * enough that it never reaches across a whole brick.
   */
  searchRadius?: number;
  /** How strongly to prefer staying near the previous ghost position. */
  continuityWeight?: number;
  maxCandidates?: number;
}

const DEFAULTS = {
  searchRadius: 16,
  continuityWeight: 0.35,
  maxCandidates: 8,
} as const;

/**
 * How closely a connector's axis must align with the hit face's normal to count as
 * belonging to that face. A connector on the face is perpendicular to it, so the two are
 * near-parallel; one on an adjacent face is near-perpendicular. 0.7 is a 45 degree cone,
 * wide enough for recessed connectors like 4070's and narrow enough to exclude the faces
 * you are not pointing at.
 *
 * Sign is ignored: a stud on the top face points along -normal and a socket on the bottom
 * face along +normal, and both belong to the face they sit on.
 */
const FACE_ALIGNMENT = 0.7;

const distance = (a: Vec3, b: Vec3): number =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

const onHitFace = (p: IndexedPoint, normal: Vec3): boolean =>
  Math.abs(p.axis[0] * normal[0] + p.axis[1] * normal[1] + p.axis[2] * normal[2]) >= FACE_ALIGNMENT;

/**
 * Rank one pairing.
 *
 * Two terms, and the balance between them is the whole feel of placement:
 *
 * - **Cursor proximity** dominates. The user pointed somewhere; the connector nearest
 *   that point is what they meant.
 * - **Continuity** breaks ties. Which of the moving part's own points mates to the
 *   target is genuinely ambiguous — stud 1 and stud 8 of a 2x4 land the brick 60 LDU
 *   apart on the same target stud — and without this the ghost teleports between
 *   equally-valid answers as the pointer moves a pixel.
 */
function scoreOf(
  targetWorldPos: Vec3,
  cursor: Vec3,
  placed: Mat4,
  previous: Mat4 | undefined,
  weight: number,
  searchRadius: number,
): number {
  const proximity = distance(targetWorldPos, cursor);
  // Proximity is bounded by the search radius, so drift must be bounded too. Left
  // unbounded it grows without limit as the ghost travels and swamps the cursor signal
  // it is only meant to break ties on — the piece would start preferring where it
  // already was over where you are pointing.
  const raw = previous ? distance(positionOf(placed), positionOf(previous)) : 0;
  const drift = Math.min(raw, searchRadius);
  // Higher is better, so both penalties are negative.
  return -(proximity + weight * drift);
}

/**
 * Candidates for the current pointer position, best first.
 *
 * Returns empty when the cursor is over nothing, or over a brick with no compatible
 * connector in reach. An empty result is a normal state, not an error — it is what the
 * interaction layer shows as "no placement here".
 */
export function resolveSnap(
  query: SnapQuery,
  index: SpatialIndex,
  lookup: BrickLookup,
  options: ResolveOptions = {},
): SnapCandidate[] {
  const searchRadius = options.searchRadius ?? DEFAULTS.searchRadius;
  const continuityWeight = options.continuityWeight ?? DEFAULTS.continuityWeight;
  const maxCandidates = options.maxCandidates ?? DEFAULTS.maxCandidates;

  const { hit } = query;
  if (!hit) return [];

  const host = lookup(hit.brick);
  if (!host) return [];

  // Three filters, from the one raycast: which brick, where on it, and which face. The
  // face filter is what makes studs-not-on-top placement feel deliberate — hover a
  // brick's side and you are offered its side connectors, not the studs on its top.
  const nearby: IndexedPoint[] = index
    .near(hit.point, searchRadius)
    .filter((p) => p.brick === hit.brick && onHitFace(p, hit.normal));
  if (nearby.length === 0) return [];

  const targetsById = new Map(host.part.connections.map((c) => [c.id, c]));
  const exclude = new Set<BrickId>();

  const candidates: SnapCandidate[] = [];

  for (const near of nearby) {
    const target = targetsById.get(near.point);
    if (!target) continue;

    for (const moving of query.part.connections) {
      if (!isCompatible(moving, target)) continue;

      const placed = solveMating(query.part, moving, target, host.transform, query.roll);
      candidates.push({
        movingPoint: moving.id,
        target: { brick: hit.brick, point: target.id },
        transform: placed,
        mates: [],
        score: scoreOf(
          near.position,
          hit.point,
          placed,
          query.previous,
          continuityWeight,
          searchRadius,
        ),
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  const top = candidates.slice(0, maxCandidates);

  // Mates are a consequence of the placement, so they are filled in only for the
  // candidates that survive ranking — never used to produce it.
  return top.map((c) => ({
    ...c,
    mates: flatten(findMates(query.part, c.transform, index, exclude)),
  }));
}

const flatten = (groups: readonly MateGroup[]): SnapCandidate['mates'] =>
  groups.flatMap((g) => g.mates);

/** Grouped by neighbour, for writing the connection graph on commit. */
export function matesForCommit(
  part: PartDef,
  transform: Mat4,
  index: SpatialIndex,
  exclude?: ReadonlySet<BrickId>,
): readonly MateGroup[] {
  return findMates(part, transform, index, exclude);
}

/**
 * Where a free-floating piece sits when the cursor is over empty space: on the ground
 * plane under the pointer. LDraw's ground is y = 0 with +Y down, and a part's own origin
 * is not its base, so the part is lifted by its lowest extent.
 */
export function groundPlacement(part: PartDef, origin: Vec3, direction: Vec3): Mat4 | null {
  if (Math.abs(direction[1]) < 1e-6) return null;
  const t = -origin[1] / direction[1];
  if (t <= 0) return null;
  const x = origin[0] + direction[0] * t;
  const z = origin[2] + direction[2] * t;
  // bounds.max[1] is the lowest point, because +Y is down.
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, -part.bounds.max[1], z, 1];
}
