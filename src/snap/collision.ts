/**
 * Collision between the active (moving) piece and the rest of the scene.
 *
 * Distinct from mating (`mating.ts`): mating finds where two points coincide on
 * purpose, collision finds where two *bodies* overlap by accident. The two overlap in a
 * way that matters — a correctly stacked pair of bricks shares real volume at every stud
 * that mates, and that sharing is not a bug. See `hasClearance` below for how the
 * occupancy mask accounts for it.
 *
 * Pure: no three.js, no DOM. Safe inside a worker.
 */

import { invert, transformPoint } from '../math';
import type { BrickId, Bounds, Mat4, Vec3 } from '../types';
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

function clearBit(bits: Uint8Array, i: number): void {
  bits[i >> 3] &= ~(1 << (i & 7));
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
 * Clears voxels inside a connection point's own connector volume — the capsule swept by
 * its section radius along its local +Y axis, padded by one cell.
 *
 * This is *the* answer to "a correct connection is not a collision": a stacked pair of
 * 2x4 bricks has brick B's studs occupying brick A's socket volume by design. Rather than
 * detect that at query time (which would need to know which two points are meant to
 * mate), the mask is built with a standing exemption at every point capable of mating,
 * on both the male and the female side. A stud's own plastic and a socket's open mouth
 * both stop reading as solid within this capsule — narrow enough (radius + 4 LDU) that it
 * only ever swallows the connector itself, never the body around it.
 */
function eraseConnectionClearance(
  connections: readonly ConnectionPoint[],
  bounds: Bounds,
  dims: readonly [number, number, number],
  bits: Uint8Array,
): void {
  const MARGIN = OCC_CELL;
  for (const p of connections) {
    const axis: Vec3 = [p.orientation[3], p.orientation[4], p.orientation[5]];
    const maxRadius = p.sections.reduce((m, s) => Math.max(m, s.radius), 0);
    const totalLength = p.sections.reduce((s, sec) => s + sec.length, 0);
    if (maxRadius <= 0 && totalLength <= 0) continue;
    const radius = maxRadius + MARGIN;
    const lo = -MARGIN;
    const hi = totalLength + MARGIN;

    // Voxel-space AABB of the capsule's own bounding box, clamped to the grid.
    const capsuleMin: Vec3 = [
      p.position[0] - radius - Math.abs(axis[0]) * Math.max(Math.abs(lo), Math.abs(hi)),
      p.position[1] - radius - Math.abs(axis[1]) * Math.max(Math.abs(lo), Math.abs(hi)),
      p.position[2] - radius - Math.abs(axis[2]) * Math.max(Math.abs(lo), Math.abs(hi)),
    ];
    const capsuleMax: Vec3 = [
      p.position[0] + radius + Math.abs(axis[0]) * Math.max(Math.abs(lo), Math.abs(hi)),
      p.position[1] + radius + Math.abs(axis[1]) * Math.max(Math.abs(lo), Math.abs(hi)),
      p.position[2] + radius + Math.abs(axis[2]) * Math.max(Math.abs(lo), Math.abs(hi)),
    ];

    const i0 = [0, 1, 2].map((a) =>
      Math.max(0, Math.floor((capsuleMin[a] - bounds.min[a]) / OCC_CELL)),
    );
    const i1 = [0, 1, 2].map((a) =>
      Math.min(dims[a] - 1, Math.floor((capsuleMax[a] - bounds.min[a]) / OCC_CELL)),
    );

    for (let iz = i0[2]; iz <= i1[2]; iz++) {
      for (let iy = i0[1]; iy <= i1[1]; iy++) {
        for (let ix = i0[0]; ix <= i1[0]; ix++) {
          const center: Vec3 = [
            bounds.min[0] + (ix + 0.5) * OCC_CELL,
            bounds.min[1] + (iy + 0.5) * OCC_CELL,
            bounds.min[2] + (iz + 0.5) * OCC_CELL,
          ];
          const d: Vec3 = [
            center[0] - p.position[0],
            center[1] - p.position[1],
            center[2] - p.position[2],
          ];
          const t = d[0] * axis[0] + d[1] * axis[1] + d[2] * axis[2];
          if (t < lo || t > hi) continue;
          const perp2 =
            (d[0] - t * axis[0]) ** 2 + (d[1] - t * axis[1]) ** 2 + (d[2] - t * axis[2]) ** 2;
          if (perp2 <= radius * radius) clearBit(bits, voxelIndex(dims, ix, iy, iz));
        }
      }
    }
  }
}

/**
 * Builds a part's occupancy mask from its triangulated geometry (part-local LDU) and its
 * connection points. Solid-ish fill: a surface pass (triangle-vs-voxel AABB overlap)
 * plus an interior pass (ray-parity from each remaining voxel's center), then a
 * clearance pass that exempts every connection point's own connector volume. See
 * `eraseConnectionClearance` for why the last step exists.
 */
export function buildOccupancy(
  triangles: readonly Triangle[],
  bounds: Bounds,
  connections: readonly ConnectionPoint[] = [],
): OccupancyMask {
  const dims = dimsOf(bounds);
  const bits = new Uint8Array(Math.ceil((dims[0] * dims[1] * dims[2]) / 8));
  markSurface(triangles, bounds, dims, bits);
  markInterior(triangles, bounds, dims, bits);
  eraseConnectionClearance(connections, bounds, dims, bits);
  return { dims, bits };
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
        if (isOccupiedAt(other.occupancy, other.bounds, otherLocal)) return true;
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
 * parts' occupancy masks, sampled both directions. A part's own studs and sockets are
 * exempt from their own mask (see `eraseConnectionClearance`), so a properly mated pair
 * — even one mating many points at once — reads as no collision; genuine
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
    if (anyOccupiedVoxelInside(part, transform, entry.part, otherInverse)) return true;
    if (anyOccupiedVoxelInside(entry.part, entry.transform, part, inverseTransform)) return true;
  }
  return false;
};
