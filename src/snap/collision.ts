/**
 * Collision between the active (moving) piece and the rest of the scene.
 *
 * Distinct from mating (`mating.ts`): mating finds where two points coincide on
 * purpose, collision finds where two *bodies* overlap by accident. The two overlap in a
 * way that matters — a correctly stacked pair of bricks shares real volume at every stud
 * that mates, and that sharing is not a bug. `isExemptOverlap` below is how the collision
 * query accounts for it.
 *
 * The occupancy mask itself is unconditionally solid: `buildOccupancy` erases nothing.
 * An earlier version cleared every connection point's own connector capsule out of the
 * mask at bake time, unconditionally — whether or not anything was ever connected there.
 * That made small, connector-dense parts mostly holes (a 1×1 with headlight dropped from
 * 80% fill to 14.3% and stopped detecting collisions at all) and it excused the wrong
 * thing: an *unmated* stud is solid plastic and must collide like any other material.
 * Only an actually mated connection — compatible connectors, facing the same way, both
 * sides recognisably connector volume — should be excused, and that can only be known at
 * query time, once both parts and their transforms are in hand.
 *
 * Pure: no three.js, no DOM. Safe inside a worker.
 */

import { invert, transformPoint } from '../math';
import type { BrickId, Bounds, Mat4, Vec3 } from '../types';
import { isCompatible } from './compat';
import { MATE_TOLERANCE, worldPoint } from './mating';
import { worldBounds } from './spatialIndex';
import type { Collides, ConnectionPoint, OccupancyMask, PartDef, SpatialIndex } from './types';
import type { Triangle } from '../ldraw/bounds';

// ---------------------------------------------------------------------------
// Occupancy mask construction
// ---------------------------------------------------------------------------

/** Cell size for the coarse collision mask, per `docs/ARCHITECTURE.md`. */
export const OCC_CELL = 4;

function dimsOf(bounds: Bounds): readonly [number, number, number] {
  const span = (a: number, b: number) => Math.max(1, Math.ceil((b - a) / OCC_CELL));
  return [
    span(bounds.min[0], bounds.max[0]),
    span(bounds.min[1], bounds.max[1]),
    span(bounds.min[2], bounds.max[2]),
  ];
}

const voxelIndex = (dims: readonly [number, number, number], ix: number, iy: number, iz: number): number =>
  ix + dims[0] * (iy + dims[1] * iz);

function getBit(bits: Uint8Array, i: number): boolean {
  return ((bits[i >> 3] >> (i & 7)) & 1) === 1;
}

function setBit(bits: Uint8Array, i: number): void {
  bits[i >> 3] |= 1 << (i & 7);
}

/** Voxel-space AABB of a triangle, clamped to the grid. */
function triangleVoxelRange(
  tri: Triangle,
  bounds: Bounds,
  dims: readonly [number, number, number],
): { lo: [number, number, number]; hi: [number, number, number] } {
  const lo: [number, number, number] = [0, 0, 0];
  const hi: [number, number, number] = [0, 0, 0];
  for (let a = 0; a < 3; a++) {
    const vs = [tri[0][a], tri[1][a], tri[2][a]];
    const min = Math.min(...vs);
    const max = Math.max(...vs);
    const i0 = Math.floor((min - bounds.min[a]) / OCC_CELL);
    const i1 = Math.floor((max - bounds.min[a]) / OCC_CELL);
    lo[a] = Math.max(0, Math.min(i0, i1));
    hi[a] = Math.min(dims[a] - 1, Math.max(i0, i1));
  }
  return { lo, hi };
}

/**
 * Surface fill: every voxel whose axis-aligned box overlaps a triangle's own AABB.
 * Coarse — a triangle that clips a voxel's corner fills the whole voxel — which is the
 * "solid-ish fill" the architecture doc asks for: better to over-include a shell voxel
 * than to leave a gap a moving part could poke through undetected.
 */
function markSurface(
  triangles: readonly Triangle[],
  bounds: Bounds,
  dims: readonly [number, number, number],
  bits: Uint8Array,
): void {
  for (const tri of triangles) {
    const { lo, hi } = triangleVoxelRange(tri, bounds, dims);
    for (let iz = lo[2]; iz <= hi[2]; iz++) {
      for (let iy = lo[1]; iy <= hi[1]; iy++) {
        for (let ix = lo[0]; ix <= hi[0]; ix++) {
          setBit(bits, voxelIndex(dims, ix, iy, iz));
        }
      }
    }
  }
}

/** Möller–Trumbore, returns the ray parameter `t > eps` or null. */
function rayTriangle(origin: Vec3, dir: Vec3, tri: Triangle): number | null {
  const EPS = 1e-9;
  const [v0, v1, v2] = tri;
  const e1: Vec3 = [v1[0] - v0[0], v1[1] - v0[1], v1[2] - v0[2]];
  const e2: Vec3 = [v2[0] - v0[0], v2[1] - v0[1], v2[2] - v0[2]];
  const p: Vec3 = [
    dir[1] * e2[2] - dir[2] * e2[1],
    dir[2] * e2[0] - dir[0] * e2[2],
    dir[0] * e2[1] - dir[1] * e2[0],
  ];
  const det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2];
  if (Math.abs(det) < EPS) return null;
  const invDet = 1 / det;
  const t0: Vec3 = [origin[0] - v0[0], origin[1] - v0[1], origin[2] - v0[2]];
  const u = (t0[0] * p[0] + t0[1] * p[1] + t0[2] * p[2]) * invDet;
  if (u < 0 || u > 1) return null;
  const q: Vec3 = [
    t0[1] * e1[2] - t0[2] * e1[1],
    t0[2] * e1[0] - t0[0] * e1[2],
    t0[0] * e1[1] - t0[1] * e1[0],
  ];
  const v = (dir[0] * q[0] + dir[1] * q[1] + dir[2] * q[2]) * invDet;
  if (v < 0 || u + v > 1) return null;
  const t = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) * invDet;
  return t > EPS ? t : null;
}

/**
 * Interior fill: a voxel center is inside the mesh when a ray cast from it crosses the
 * surface an odd number of times. The cast direction is fixed and slightly off-axis so
 * it rarely grazes an edge or a coplanar face exactly.
 *
 * Relies on the merged geometry being reasonably watertight. It mostly is — bricks are
 * built from closed primitives — except where a part is deliberately open (a stud
 * socket's mouth, a technic hole), which is exactly where `hasClearance` below already
 * excludes the mask from mattering.
 */
function markInterior(
  triangles: readonly Triangle[],
  bounds: Bounds,
  dims: readonly [number, number, number],
  bits: Uint8Array,
): void {
  const dir: Vec3 = [1, 0.0021, 0.0037];
  for (let iz = 0; iz < dims[2]; iz++) {
    for (let iy = 0; iy < dims[1]; iy++) {
      for (let ix = 0; ix < dims[0]; ix++) {
        const idx = voxelIndex(dims, ix, iy, iz);
        if (getBit(bits, idx)) continue; // already solid from the surface pass
        const center: Vec3 = [
          bounds.min[0] + (ix + 0.5) * OCC_CELL,
          bounds.min[1] + (iy + 0.5) * OCC_CELL,
          bounds.min[2] + (iz + 0.5) * OCC_CELL,
        ];
        let crossings = 0;
        for (const tri of triangles) {
          if (rayTriangle(center, dir, tri) !== null) crossings++;
        }
        if (crossings % 2 === 1) setBit(bits, idx);
      }
    }
  }
}

/**
 * Builds a part's occupancy mask from its triangulated geometry (part-local LDU).
 * Unconditionally solid-ish fill: a surface pass (triangle-vs-voxel AABB overlap) plus
 * an interior pass (ray-parity from each remaining voxel's center). Nothing is erased —
 * an unmated connector is ordinary solid material. `connections` is accepted for call
 * compatibility but plays no part in building the mask; connector exemptions are
 * evaluated at query time, in `isExemptOverlap`, where both parts and their transforms
 * are available to check that a mating actually occurred.
 */
export function buildOccupancy(
  triangles: readonly Triangle[],
  bounds: Bounds,
  connections: readonly ConnectionPoint[] = [],
): OccupancyMask {
  void connections;
  const dims = dimsOf(bounds);
  const bits = new Uint8Array(Math.ceil((dims[0] * dims[1] * dims[2]) / 8));
  markSurface(triangles, bounds, dims, bits);
  markInterior(triangles, bounds, dims, bits);
  return { dims, bits };
}

// ---------------------------------------------------------------------------
// Query-time connector exemption
// ---------------------------------------------------------------------------

/**
 * Query-time tolerance, in voxels: one `OCC_CELL`. `markSurface` over-fills — a triangle
 * that merely clips a voxel's corner fills the whole voxel — so a connector capsule
 * tested against exact geometry would miss occupied voxels near its own rounded edges.
 * Padding the capsule by one cell in `connectorsAt` absorbs that bleed.
 *
 * This is deliberately *not* the old bake-time `MARGIN`: that erased volume from the
 * mask itself, unconditionally, whether or not the connector was ever mated. This
 * tolerance only widens which voxels are *classified* as connector volume when checking
 * an already-detected overlap — the erasure it replaces happened regardless of mating,
 * this only ever excuses volume that also passed `isCompatible` and the axis check
 * below. Do not fold this back into `buildOccupancy`.
 *
 * This padding is also exactly what makes a stud's own capsule overlap the socket it
 * mates (see `connectorsAt`) — a stud's position sits inside both, once padded. That
 * looks like it is destroying classification, but it is not: `connectorsAt` no longer
 * picks one connector to trust, it returns every candidate, and `isExemptOverlap` still
 * requires the *actual* pair — compatible, coincident within `MATE_TOLERANCE`, co-
 * directional — before excusing anything. A connector that only qualifies because of
 * this padding still has to clear that full gate on its own to matter; it cannot borrow
 * legitimacy from a neighbour that happens to share the query point. So the padding
 * trades a wider candidate list for correct classification, not a wider exemption.
 */
export const CONNECTOR_EPS = OCC_CELL;

/**
 * Classifies a part-local point against every connector capable of claiming it as
 * connector volume — every connection point whose capsule (the swept section radius
 * along its axis) contains it — rather than picking one.
 *
 * Multiple, not first-match, because the capsules genuinely overlap in exactly the
 * region a real mate occupies. On a squarely-stacked 3001, a stud (position y=0, axis
 * [0,1,0], length 4) has capsule range y in [-8, 4] once padded by `CONNECTOR_EPS`; the
 * socket it mates (position y=24, length 20) has padded range y in [0, 28]. Those
 * overlap at y in [0, 4] — which includes the stud's own position, y=0. A first-match
 * classifier returns whichever connector happens to sort first in `connections` there,
 * which was measured to be the *socket*, not the stud, on the real 3001 fixture: a test
 * built to exercise the coincidence check in `isExemptOverlap` below was handed a stud's
 * position and got a socket back, so it was rejected by `isCompatible` (two sockets are
 * never opposed-gender) before the coincidence check it existed to test ever ran. The
 * caller cannot fix that by picking a better point — the ambiguity is structural, not a
 * bad query.
 *
 * Returning every match pushes the actual decision to `isExemptOverlap`, which knows
 * both sides and can check every pairing rather than guessing at one in isolation.
 *
 * The capsule extends along local **-Y**, not +Y: LDraw draws both a stud and a socket
 * bore extending backward from their own position along -Y (see `mating.ts`, verified
 * against 3001). Getting this backwards was a real regression during development — it
 * pointed the capsule into the body of the part instead of along the connector, and the
 * stacked-3001 test caught it because the erased region no longer lined up with where
 * the two bricks actually overlap.
 */
export function connectorsAt(
  connections: readonly ConnectionPoint[],
  local: Vec3,
): readonly ConnectionPoint[] {
  const found: ConnectionPoint[] = [];
  for (const p of connections) {
    const axis: Vec3 = [p.orientation[3], p.orientation[4], p.orientation[5]];
    const maxRadius = p.sections.reduce((m, s) => Math.max(m, s.radius), 0);
    const totalLength = p.sections.reduce((s, sec) => s + sec.length, 0);
    if (maxRadius <= 0 && totalLength <= 0) continue;
    const radius = maxRadius + CONNECTOR_EPS;

    const d: Vec3 = [local[0] - p.position[0], local[1] - p.position[1], local[2] - p.position[2]];
    const t = d[0] * axis[0] + d[1] * axis[1] + d[2] * axis[2];
    // The capsule runs from the position back to -(length), along -axis, padded by
    // CONNECTOR_EPS at both ends.
    if (t < -(totalLength + CONNECTOR_EPS) || t > CONNECTOR_EPS) continue;
    const perp2 = (d[0] - t * axis[0]) ** 2 + (d[1] - t * axis[1]) ** 2 + (d[2] - t * axis[2]) ** 2;
    if (perp2 <= radius * radius) found.push(p);
  }
  return found;
}

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const dist2 = (a: Vec3, b: Vec3): number =>
  (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

/**
 * Axes must agree within about two degrees, mirroring `mating.ts`'s `AXIS_TOLERANCE`.
 * Mated connectors are co-directional (a socket slides onto a stud pointing the same
 * way it does), not opposed, so this checks the dot product is close to +1.
 */
const EXEMPT_AXIS_TOLERANCE = 0.999;

/**
 * How close two connectors' own centers must land, in world space, to count as the
 * same seated joint rather than two connectors that merely happen to be nearby,
 * compatible, and pointing the same way. Reuses `mating.ts`'s `MATE_TOLERANCE`
 * exactly (0.35 LDU) rather than inventing a second number: an exemption is supposed
 * to represent an actual mate, so it should require what a mate requires. No extra
 * slack is added for voxel quantisation here — that slack already lives in
 * `CONNECTOR_EPS`, which widens which voxels classify as connector volume in the first
 * place; padding this distance too would let two connectors up to a full cell apart
 * both claim to be "the" mate, which is the exact hole a review of this file found:
 * two compatible, co-directional connectors 8 LDU apart — far outside any stud's own
 * capsule radius, let alone this tolerance — were being waved through because nothing
 * checked they were the same joint.
 */
const EXEMPT_POSITION_TOLERANCE = MATE_TOLERANCE;

/**
 * True only when an overlap between `localA` (in `partA`, placed at `transformA`) and
 * `localB` (in `partB`, placed at `transformB`) is exactly the shape of a mated
 * stud-in-socket: connector volume on both sides, whose connectors are `isCompatible`,
 * whose own centers coincide in world space (the same joint, not merely two nearby
 * compatible connectors), and whose world-space axes point the same way. Anything else
 * — an unmated stud pressed into a wall, two studs crossing at an angle, a connector
 * overlapping plain body material, two unrelated compatible connectors that happen to
 * sit near each other — is a real collision and this returns false.
 */
export function isExemptOverlap(
  partA: PartDef,
  transformA: Mat4,
  localA: Vec3,
  partB: PartDef,
  transformB: Mat4,
  localB: Vec3,
): boolean {
  const as = connectorsAt(partA.connections, localA);
  if (as.length === 0) return false;
  const bs = connectorsAt(partB.connections, localB);
  if (bs.length === 0) return false;
  // Either side's query point can land inside more than one connector's capsule (see
  // `connectorsAt`), so no single pairing can be assumed correct in isolation. Excuse
  // the overlap if *any* pairing across the two candidate sets is a real mate — the
  // rest being present and disqualified is expected, not a problem.
  for (const a of as) {
    const worldA = worldPoint(a, transformA);
    for (const b of bs) {
      if (!isCompatible(a, b)) continue;
      const worldB = worldPoint(b, transformB);
      if (dist2(worldA.position, worldB.position) > EXEMPT_POSITION_TOLERANCE ** 2) continue;
      if (dot(worldA.axis, worldB.axis) >= EXEMPT_AXIS_TOLERANCE) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Narrow phase
// ---------------------------------------------------------------------------

/** True if `local` falls inside an occupied cell of `mask`/`bounds`. */
function isOccupiedAt(mask: OccupancyMask, bounds: Bounds, local: Vec3): boolean {
  const dims = mask.dims;
  const ix = Math.floor((local[0] - bounds.min[0]) / OCC_CELL);
  const iy = Math.floor((local[1] - bounds.min[1]) / OCC_CELL);
  const iz = Math.floor((local[2] - bounds.min[2]) / OCC_CELL);
  if (ix < 0 || iy < 0 || iz < 0 || ix >= dims[0] || iy >= dims[1] || iz >= dims[2]) return false;
  return getBit(mask.bits, voxelIndex(dims, ix, iy, iz));
}

/**
 * True if any occupied voxel of `part` (world space, via `transform`) lands inside an
 * occupied voxel of `other` (world space, via `otherTransform`). Sampled at voxel
 * centers, so it is a coarse test in both directions — callers run it both ways round to
 * catch a solid `other` voxel whose center a `part` voxel narrowly missed.
 */
function anyOccupiedVoxelInside(
  part: PartDef,
  transform: Mat4,
  other: PartDef,
  otherTransform: Mat4,
  otherInverse: Mat4,
): boolean {
  const { dims, bits } = part.occupancy;
  const [nx, ny, nz] = dims;
  for (let iz = 0; iz < nz; iz++) {
    for (let iy = 0; iy < ny; iy++) {
      for (let ix = 0; ix < nx; ix++) {
        const idx = voxelIndex(dims, ix, iy, iz);
        if (!getBit(bits, idx)) continue;
        const local: Vec3 = [
          part.bounds.min[0] + (ix + 0.5) * OCC_CELL,
          part.bounds.min[1] + (iy + 0.5) * OCC_CELL,
          part.bounds.min[2] + (iz + 0.5) * OCC_CELL,
        ];
        const world = transformPoint(transform, local);
        const otherLocal = transformPoint(otherInverse, world);
        if (!isOccupiedAt(other.occupancy, other.bounds, otherLocal)) continue;
        if (isExemptOverlap(part, transform, local, other, otherTransform, otherLocal)) continue;
        return true;
      }
    }
  }
  return false;
}

/**
 * `SpatialIndex` (frozen, `src/snap/types.ts`) only returns brick ids from `nearBricks` —
 * enough for the broad phase, not enough for the narrow one, which needs each candidate
 * brick's `PartDef` and world transform to test its occupancy mask. `HashSpatialIndex`
 * (the only implementation, `spatialIndex.ts`) additionally implements this — a purely
 * additive method outside the contract, not a change to it. Any other `SpatialIndex`
 * used for collision needs the same. Flagged in the collision slice's report as an
 * interpretation of an underspecified contract, for review.
 */
interface OccupancyLookup {
  partAt(brick: BrickId): { part: PartDef; transform: Mat4 } | undefined;
}

/**
 * Broad phase: world-space bounds via `SpatialIndex.nearBricks`. Narrow phase: the two
 * parts' occupancy masks, sampled both directions, with an overlap excused only when
 * `isExemptOverlap` recognises it as a mated connection (see above) — so a properly
 * mated pair, even one mating many points at once, reads as no collision, while genuine
 * interpenetration elsewhere on the body still does.
 */
export const collides: Collides = (part, transform, index, ignore) => {
  const worldB = worldBounds(part.bounds, transform);
  const candidates = index.nearBricks(worldB);
  if (candidates.length === 0) return false;

  const lookup = index as SpatialIndex & OccupancyLookup;
  const inverseTransform = invert(transform);

  for (const brick of candidates) {
    if (ignore?.has(brick)) continue;
    const entry = lookup.partAt(brick);
    if (!entry) continue; // index without narrow-phase data: broad phase only
    const otherInverse = invert(entry.transform);
    if (anyOccupiedVoxelInside(part, transform, entry.part, entry.transform, otherInverse)) {
      return true;
    }
    if (anyOccupiedVoxelInside(entry.part, entry.transform, part, transform, inverseTransform)) {
      return true;
    }
  }
  return false;
};
