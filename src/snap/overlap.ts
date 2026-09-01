/**
 * Where two parts overlap, not merely whether they do.
 *
 * `collision.ts`'s `collides` walks the intersection of two occupancy masks and stops at
 * the first non-exempt hit — a boolean is all it needs. That walk already visits every
 * voxel the answer to "where" would need; this module runs the same walk without the
 * early exit and keeps every hit's world-space position, so a caller can show the
 * colliding volume instead of just a colour change.
 *
 * Reuses `collision.ts`'s exported `OCC_CELL` and `isExemptOverlap` rather than
 * restating the cell size or the mated-connector exemption — `collision.ts` itself is
 * not modified here.
 *
 * Pure: no three.js, no DOM. Safe inside a worker.
 */

import { invert, transformPoint } from '../math';
import type { Bounds, Mat4, Vec3 } from '../types';
import { OCC_CELL, isExemptOverlap } from './collision';
import { worldBounds } from './spatialIndex';
import type { OccupancyMask, PartDef } from './types';

const voxelIndex = (dims: readonly [number, number, number], ix: number, iy: number, iz: number): number =>
  ix + dims[0] * (iy + dims[1] * iz);

function getBit(bits: Uint8Array, i: number): boolean {
  return ((bits[i >> 3] >> (i & 7)) & 1) === 1;
}

/** True if `local` falls inside an occupied cell of `mask`/`bounds`. Mirrors `collision.ts`. */
function isOccupiedAt(mask: OccupancyMask, bounds: Bounds, local: Vec3): boolean {
  const dims = mask.dims;
  const ix = Math.floor((local[0] - bounds.min[0]) / OCC_CELL);
  const iy = Math.floor((local[1] - bounds.min[1]) / OCC_CELL);
  const iz = Math.floor((local[2] - bounds.min[2]) / OCC_CELL);
  if (ix < 0 || iy < 0 || iz < 0 || ix >= dims[0] || iy >= dims[1] || iz >= dims[2]) return false;
  return getBit(mask.bits, voxelIndex(dims, ix, iy, iz));
}

/**
 * Voxel index range of `part` covering the region where `other` could possibly reach.
 * Identical in spirit to `collision.ts`'s private `overlapVoxelRange` — restated here
 * because that one isn't exported, not because the logic differs.
 */
function reachRange(
  part: PartDef,
  partInverse: Mat4,
  other: PartDef,
  otherTransform: Mat4,
): { lo: [number, number, number]; hi: [number, number, number] } | null {
  const dims = part.occupancy.dims;
  const reach = worldBounds(worldBounds(other.bounds, otherTransform), partInverse);
  const lo: [number, number, number] = [0, 0, 0];
  const hi: [number, number, number] = [0, 0, 0];
  for (let a = 0; a < 3; a++) {
    const from = Math.floor((reach.min[a] - part.bounds.min[a]) / OCC_CELL) - 1;
    const to = Math.floor((reach.max[a] - part.bounds.min[a]) / OCC_CELL) + 1;
    lo[a] = Math.max(0, from);
    hi[a] = Math.min(dims[a] - 1, to);
    if (lo[a] > hi[a]) return null;
  }
  return { lo, hi };
}

/**
 * Every occupied voxel of `part` (world space, via `transform`) that lands inside an
 * occupied, non-exempt voxel of `other` (world space, via `otherTransform`), as
 * world-space cell centers. One-directional — see `findOverlapVoxels` for why running
 * both directions is what the exported function does.
 */
function occupiedVoxelsInside(
  part: PartDef,
  transform: Mat4,
  partInverse: Mat4,
  other: PartDef,
  otherTransform: Mat4,
  otherInverse: Mat4,
  out: Vec3[],
  limit: number,
): void {
  const { dims, bits } = part.occupancy;
  const range = reachRange(part, partInverse, other, otherTransform);
  if (!range) return;
  const { lo, hi } = range;
  for (let iz = lo[2]; iz <= hi[2] && out.length < limit; iz++) {
    for (let iy = lo[1]; iy <= hi[1] && out.length < limit; iy++) {
      for (let ix = lo[0]; ix <= hi[0] && out.length < limit; ix++) {
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
        out.push(world);
      }
    }
  }
}

/**
 * Default cap on returned voxel centers. Measured against the fixture corpus: a real
 * 4070-on-4070 deep overlap (`[4,4,4]`) is 120 voxels; a 2x4 (3001) pushed half its own
 * height into another is in the hundreds, since half of a ~1,000-voxel brick body is
 * genuinely occupied volume, not a token handful. Both stay well under this cap and
 * both resolve in low single-digit milliseconds (see `overlap.test.ts`), so the cap
 * exists only to bound the pathological case — the moving part's own occupied-cell
 * count is the real bound on cost (`reachRange` clips the larger side to the overlap
 * region, so a small part sunk into a huge baseplate never walks the baseplate's full
 * grid), and this guards the remaining case where both sides are themselves huge and
 * mostly coincident. Callers that want every voxel regardless of count can pass
 * `Infinity`.
 */
export const DEFAULT_OVERLAP_LIMIT = 4096;

/**
 * World-space centers of every voxel where `partA` (at `transformA`) and `partB` (at
 * `transformB`) genuinely collide — occupied on both sides, and not excused by
 * `isExemptOverlap` as a mated connection. This is the same test `collides` (in
 * `collision.ts`) runs to produce its boolean; this keeps the positions instead of
 * stopping at the first one.
 *
 * Runs both directions, exactly as `collides` does: `collides` checks A's voxels against
 * B and B's voxels against A because either grid can have a thin feature whose voxel
 * center the other grid's sampling narrowly misses (see `collision.ts`'s
 * `anyOccupiedVoxelInside`). The same asymmetry applies here — skipping a direction would
 * silently drop real overlap the boolean check would have caught. No de-duplication
 * between the two passes: a cell reported from both sides only means both parts' own
 * grids resolved a hit there, which is a stronger signal, not a bug, and callers
 * rendering small markers can safely ignore near-duplicate positions.
 *
 * `limit` caps the total voxels returned across both passes (see `DEFAULT_OVERLAP_LIMIT`).
 */
export function findOverlapVoxels(
  partA: PartDef,
  transformA: Mat4,
  partB: PartDef,
  transformB: Mat4,
  limit: number = DEFAULT_OVERLAP_LIMIT,
): readonly Vec3[] {
  const inverseA = invert(transformA);
  const inverseB = invert(transformB);
  const out: Vec3[] = [];
  occupiedVoxelsInside(partA, transformA, inverseA, partB, transformB, inverseB, out, limit);
  occupiedVoxelsInside(partB, transformB, inverseB, partA, transformA, inverseA, out, limit);
  return out;
}
