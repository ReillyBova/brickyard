/**
 * Solving placements, and discovering what a placement engaged.
 *
 * Two distinct jobs that are easy to conflate:
 *
 * `solveMating` answers "where does the piece go if I join *these two* points?" — the
 * primary connection, chosen from the cursor.
 *
 * `findMates` answers "given the piece is now here, what else lines up?" — the
 * incidental connections, which are a consequence of the placement rather than an input
 * to choosing it. Lay a plate across two bricks and you aimed at one stud; the rest is
 * something you get.
 */

import { fromBasis, fromYRotation, invert, multiply, transformDirection, transformPoint } from '../math.ts';
import type { BrickId, Mat3, Mat4, Vec3 } from '../types.ts';
import { keysCompatible, polarityOf, unpackKey } from './compat.ts';
import type { ConnectionPoint, Mate, MateGroup, PartDef, SpatialIndex } from './types.ts';

/**
 * How close two connection points must be to count as mated, in LDU. Generous enough to
 * absorb float drift down a deep reference chain, far tighter than the 20 LDU stud pitch
 * so neighbouring studs can never be confused.
 */
export const MATE_TOLERANCE = 0.35;

/**
 * Axes must agree within about two degrees.
 *
 * Mating connectors are **co-directional**, not opposed. LDraw draws both a stud and a
 * socket bore extending along -Y from their own position, so a brick stacked on another
 * has its sockets pointing the same way as the studs they receive — the socket slides
 * onto the stud rather than facing into it. Verified against 3001: studs sit at y=0 and
 * sockets at y=24, both with axis [0,1,0].
 */
const AXIS_TOLERANCE = 0.999;

/** Determinant of a column-major 3x3. */
function det3(m: Mat3): number {
  return (
    m[0] * (m[4] * m[8] - m[5] * m[7]) -
    m[3] * (m[1] * m[8] - m[2] * m[7]) +
    m[6] * (m[1] * m[5] - m[2] * m[4])
  );
}

/**
 * A connection point's own frame, in the part's local space, forced right-handed.
 *
 * LDraw redirects radially-symmetric primitives with reflections: `4070` places its
 * sideways stud through a reference whose determinant is -1, which is invisible in the
 * geometry because a stud looks the same mirrored. It is not invisible here. Mating
 * composes the target frame with the inverse of the moving frame, so one left-handed
 * basis among the two makes the whole placed part a reflection of itself — with its
 * mated point still in exactly the right place, pointing exactly the right way, which is
 * why position-and-axis assertions sail straight past it.
 *
 * Negating the first basis column restores handedness while leaving +Y — the connector
 * axis, and the only direction that carries meaning — untouched. Cylindrical connectors
 * are radially symmetric, so the column choice is arbitrary anyway; roll about the axis
 * is the user's to set.
 */
export function pointMatrix(p: ConnectionPoint): Mat4 {
  const o = p.orientation;
  const basis: Mat3 = det3(o) < 0 ? [-o[0], -o[1], -o[2], o[3], o[4], o[5], o[6], o[7], o[8]] : o;
  return fromBasis(basis, p.position);
}

/** Where a connection point sits once its part is placed at `transform`. */
export function worldPoint(p: ConnectionPoint, transform: Mat4): { position: Vec3; axis: Vec3 } {
  const m = multiply(transform, pointMatrix(p));
  return { position: transformPoint(m, [0, 0, 0]), axis: transformDirection(m, [0, 1, 0]) };
}

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const dist2 = (a: Vec3, b: Vec3): number =>
  (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

/**
 * World transform placing `movingPart` so `movingPoint` mates `targetPoint`.
 *
 * Mating means the two points share a position *and* an axis direction: the moving
 * point's frame becomes the target's frame, spun by `roll` about their shared axis.
 * There is no flip, because connectors mate co-directionally (see AXIS_TOLERANCE).
 *
 * `roll` is in quarter turns, so a brick rotates in the 90 degree steps a person expects
 * while the underlying maths stays continuous.
 */
export function solveMating(
  movingPart: PartDef,
  movingPoint: ConnectionPoint,
  targetPoint: ConnectionPoint,
  targetWorld: Mat4,
  roll: number,
): Mat4 {
  void movingPart; // The part's own frame is carried entirely by movingPoint.
  const targetFrame = multiply(targetWorld, pointMatrix(targetPoint));
  const rolled = multiply(targetFrame, fromYRotation((roll * Math.PI) / 2));
  return multiply(rolled, invert(pointMatrix(movingPoint)));
}

/**
 * Every point pair that coincides once `transform` is applied, grouped by the brick each
 * pair joins. `aPoint` is on the moving part, `bPoint` on the neighbour.
 */
export function findMates(
  movingPart: PartDef,
  transform: Mat4,
  index: SpatialIndex,
  exclude?: ReadonlySet<BrickId>,
): readonly MateGroup[] {
  const byBrick = new Map<BrickId, Mate[]>();

  for (const mp of movingPart.connections) {
    const { position, axis } = worldPoint(mp, transform);
    const mine = unpackKey(mp.key);
    if (mine.gender === null || mine.kind === null) continue;

    for (const other of index.near(position, MATE_TOLERANCE)) {
      if (exclude?.has(other.brick)) continue;
      if (dist2(position, other.position) > MATE_TOLERANCE ** 2) continue;
      // Co-directional. Gender, not direction, is what stops two studs from mating.
      if (dot(axis, other.axis) < AXIS_TOLERANCE) continue;
      if (!keysCompatible(mp.key, other.key, mp.group, other.group)) continue;

      const mates = byBrick.get(other.brick) ?? [];
      mates.push({
        aPoint: mp.id,
        bPoint: other.point,
        kind: mine.kind,
        polarity: polarityOf(mine.gender, other.gender, mine.kind),
      });
      byBrick.set(other.brick, mates);
    }
  }

  return [...byBrick].map(([brick, mates]) => ({ brick, mates }));
}

/** Total mates across every neighbour — the placement's engagement, for feedback. */
export const mateCount = (groups: readonly MateGroup[]): number =>
  groups.reduce((n, g) => n + g.mates.length, 0);
