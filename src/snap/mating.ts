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
 * How close two connection points must be to count as mated, in LDU. Far tighter than
 * the 20 LDU stud pitch so neighbouring studs can never be confused, but generous enough
 * to absorb the real precision loss down a deep, angled reference chain — not just
 * float drift from our own arithmetic, but the coordinates published models actually
 * ship with.
 *
 * Measured directly: minifig limb joints sit at 45 degrees (arms, hips), and every
 * shipped `.mpd` writes their transforms to six decimal places. That truncation, carried
 * through a rotated multi-level reference chain, lands a limb's connector consistently
 * about 0.496 LDU from its true position — confirmed by comparing the arm-to-hand wrist
 * joint's *axis* (correct to 15 significant digits on both sides, proving the maths
 * itself is exact) against its *position* (off by exactly the amount the source file's
 * truncated coordinates predict). 0.35 rejected every minifig arm and hand in the
 * bundled models for this reason alone; 0.6 clears the measured case with real headroom
 * while staying two orders of magnitude under the stud pitch.
 */
export const MATE_TOLERANCE = 0.6;

/**
 * How far a slide connector's centred point may sit from a mate's, measured *along*
 * their shared axis, in LDU. A Technic pin or an axle is collapsed to one point at the
 * centre of its whole shaft; pushed only partway into a single hole — the ordinary case,
 * since most holes are shorter than the pin that goes through them — its centre lands
 * well past `MATE_TOLERANCE` from the hole's own centre, along the axis they share.
 * Bounded rather than unbounded so two merely-parallel, unrelated shafts several studs
 * apart can never be confused: this widens reach along the line only, never off it —
 * `MATE_TOLERANCE` still gates the perpendicular offset.
 */
const SLIDE_REACH = 40;

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

    // A slide connector's one point stands for its whole shaft, positioned at its
    // geometric centre (`resolvePart` collapses a Technic pin or an axle's full length
    // into a single centred point). Pushed only partway into one hole — the ordinary
    // case, since most holes are shorter than the pin — its centre sits well away from
    // the hole's own centre, along the shared axis. `MATE_TOLERANCE` alone would never
    // find it, so the search widens for slide connectors specifically.
    const radius = mine.slide ? SLIDE_REACH : MATE_TOLERANCE;

    for (const other of index.near(position, radius)) {
      if (exclude?.has(other.brick)) continue;
      const otherKey = unpackKey(other.key);
      const slides = mine.slide || otherKey.slide;

      // Co-directional, *unless* the pair is genuinely bidirectional — a Technic pin or
      // an axle has no "one true end": p/axlehole.dat and p/connhole.dat are both drawn
      // open at both faces (`caps=none`), and their full profiles read the same forwards
      // and backwards, so a hole threaded from the opposite direction is exactly as valid
      // a mate as one threaded from the modelled direction, and its axis reads as the
      // exact negation rather than a near match. Measured on the bundled models: every
      // isolated Technic axle and friction pin had its true mate sitting at distance 0
      // with dot -1 — rejected by this check alone, nothing else wrong.
      //
      // Bidirectional needs both `slides` and `symmetric`, not either alone. `slides` on
      // its own is too broad: `6141`'s decorative stud slides too (`R 10 3 · R 6 4`, a
      // flared base narrowing to a tip) but is not symmetric — flared end first, narrow
      // end second, no reverse reading — so it has one true direction like any ordinary
      // stud. Once the search below started reaching along the axis for slide connectors
      // in general, that stud matched a real neighbour's socket 15 LDU away pointing the
      // wrong way entirely. `symmetric` on its own is too broad the other way: a
      // single-section profile — a plain stud, `R 6 4` — is trivially a palindrome, so
      // every ordinary connector reads as symmetric too, and the strict, load-bearing
      // check for stud-on-stud stacking (an upside-down brick whose sockets face away)
      // must stay strict for them.
      const bidirectional = slides && mine.symmetric && otherKey.symmetric;
      const aligned = bidirectional ? Math.abs(dot(axis, other.axis)) : dot(axis, other.axis);
      if (aligned < AXIS_TOLERANCE) continue;

      if (slides) {
        // Coaxial, not coincident: perpendicular distance from the line through
        // `position` along `axis`, since a partial insertion moves the two centres
        // apart *along* that line but never off it. `axis` is unit length, so the
        // standard point-line formula needs no extra normalisation.
        const dx = other.position[0] - position[0];
        const dy = other.position[1] - position[1];
        const dz = other.position[2] - position[2];
        const along = dx * axis[0] + dy * axis[1] + dz * axis[2];
        const perp2 = dx * dx + dy * dy + dz * dz - along * along;
        if (perp2 > MATE_TOLERANCE ** 2) continue;
      } else if (dist2(position, other.position) > MATE_TOLERANCE ** 2) {
        continue;
      }
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
