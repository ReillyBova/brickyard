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

import { invert, transformPoint } from '../math.ts';
import type { BrickId, Bounds, Mat4, Vec3 } from '../types.ts';
import { isCompatible } from './compat.ts';
import { MATE_TOLERANCE, worldPoint } from './mating.ts';
import { worldBounds } from './spatialIndex.ts';
import type { Collides, ConnectionPoint, OccupancyMask, PartDef, SpatialIndex } from './types.ts';
import type { Triangle } from '../ldraw/bounds.ts';

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
 * Buckets triangles by the voxel rows their AABB spans, as CSR: `starts[r]`..`starts[r+1]`
 * indexes `items`, which holds triangle indices, for row `r = iy + dims[1] * iz`.
 *
 * A row is a line running the full X extent through one (iy, iz) cell, so a triangle can
 * only be hit by that row's ray if its own Y/Z extent covers the cell — which is exactly
 * what its voxel range records. Bucketing is therefore conservative, not approximate: no
 * crossing is lost, the ray simply stops being tested against the ~99% of a big part's
 * triangles that lie in other rows entirely.
 */
/**
 * The two axes that make up a row when casting rays along `axis` — e.g. `axis === 0`
 * (cast along X) buckets by (Y, Z), matching the original single-axis implementation.
 */
function rowAxes(axis: 0 | 1 | 2): readonly [0 | 1 | 2, 0 | 1 | 2] {
  return axis === 0 ? [1, 2] : axis === 1 ? [0, 2] : [0, 1];
}

function bucketByRow(
  triangles: readonly Triangle[],
  bounds: Bounds,
  dims: readonly [number, number, number],
  axis: 0 | 1 | 2,
): { starts: Int32Array; items: Int32Array } {
  const [a, b] = rowAxes(axis);
  const rows = dims[a] * dims[b];
  const counts = new Int32Array(rows + 1);
  const ranges: Array<[number, number, number, number]> = new Array(triangles.length);

  for (let t = 0; t < triangles.length; t++) {
    const { lo, hi } = triangleVoxelRange(triangles[t], bounds, dims);
    ranges[t] = [lo[a], hi[a], lo[b], hi[b]];
    for (let ib = lo[b]; ib <= hi[b]; ib++) {
      for (let ia = lo[a]; ia <= hi[a]; ia++) counts[ia + dims[a] * ib + 1]++;
    }
  }
  for (let r = 0; r < rows; r++) counts[r + 1] += counts[r];

  const starts = counts;
  const items = new Int32Array(starts[rows]);
  const cursor = Int32Array.from(starts.subarray(0, rows));
  for (let t = 0; t < triangles.length; t++) {
    const [a0, a1, b0, b1] = ranges[t];
    for (let ib = b0; ib <= b1; ib++) {
      for (let ia = a0; ia <= a1; ia++) items[cursor[ia + dims[a] * ib]++] = t;
    }
  }
  return { starts, items };
}

/**
 * Quantises a vertex to a shared-vertex key. LDraw primitives that are meant to touch
 * (a neck meeting a barrel, a wall meeting a cap) carry matching coordinates down to
 * floating-point noise from matrix transforms — far finer than 1e-4 LDU — so this
 * merges real shared vertices without merging two vertices that only happen to be close.
 */
function vertexKey(v: Vec3): string {
  const q = (x: number) => Math.round(x * 10000);
  return `${q(v[0])},${q(v[1])},${q(v[2])}`;
}

/**
 * Union-find over triangle indices, grouped by shared vertices, so each group is one
 * connected piece of geometry — a single lump — regardless of how many LDraw primitives
 * contributed to it.
 */
class UnionFind {
  private readonly parent: Int32Array;
  constructor(n: number) {
    this.parent = new Int32Array(n);
    for (let i = 0; i < n; i++) this.parent[i] = i;
  }
  find(x: number): number {
    let root = x;
    while (this.parent[root] !== root) root = this.parent[root];
    while (this.parent[x] !== root) {
      const next = this.parent[x];
      this.parent[x] = root;
      x = next;
    }
    return root;
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[ra] = rb;
  }
}

/**
 * Splits a part's merged triangle soup into its connected components — the "lumps" a
 * clip or bracket is really made of (a 1x1 plate body and a separate clip barrel, joined
 * only by a thin neck, or not joined at all). Two triangles are in the same component
 * when they share a vertex, transitively, so a part built from many welded LDraw
 * primitives still comes out as however many *physically* connected pieces it has.
 *
 * A single molded brick (or the baseplate) is one component and this is a pass-through:
 * every triangle groups together, so callers see exactly the triangle list they passed
 * in, unpartitioned.
 */
function connectedComponents(triangles: readonly Triangle[]): Triangle[][] {
  if (triangles.length === 0) return [];
  const vertexId = new Map<string, number>();
  const triVerts: [number, number, number][] = new Array(triangles.length);
  for (let t = 0; t < triangles.length; t++) {
    const ids: [number, number, number] = [0, 0, 0];
    for (let v = 0; v < 3; v++) {
      const key = vertexKey(triangles[t][v]);
      let id = vertexId.get(key);
      if (id === undefined) {
        id = vertexId.size;
        vertexId.set(key, id);
      }
      ids[v] = id;
    }
    triVerts[t] = ids;
  }

  const uf = new UnionFind(vertexId.size);
  for (const [a, b, c] of triVerts) {
    uf.union(a, b);
    uf.union(b, c);
  }

  const groupOfRoot = new Map<number, Triangle[]>();
  for (let t = 0; t < triangles.length; t++) {
    const root = uf.find(triVerts[t][0]);
    let group = groupOfRoot.get(root);
    if (!group) {
      group = [];
      groupOfRoot.set(root, group);
    }
    group.push(triangles[t]);
  }
  return [...groupOfRoot.values()];
}

/**
 * Interior fill along one axis: a voxel is inside the mesh when a ray cast from its
 * center, parallel to `axis`, crosses the surface an odd number of times.
 *
 * Cast one ray per voxel *row* rather than one per voxel. Every voxel in a row shares a
 * single line through the row's cell centers, so one pass over that row's triangles
 * yields every crossing on it; sorting those crossings then gives each voxel on the row
 * its own parity — the count of crossings still ahead of it — for free. Combined with
 * `bucketByRow`, the cost is triangles + rows x (triangles per row) rather than voxels x
 * triangles, which is what keeps large, high-poly parts tractable: part `3947` (a 32x32
 * crater baseplate: 384,000 voxels, 39,304 triangles) voxelises in about 15ms per axis;
 * testing every voxel against every triangle takes minutes.
 *
 * The ray is axis-aligned so that one line serves the whole row, with its origin nudged
 * off the exact cell center by an irrational-looking fraction of a cell so it rarely
 * grazes a shared edge or a vertex, where parity would double-count. The nudge stays far
 * inside the cell, which keeps the row's bucket correct. Triangles parallel to the ray (a
 * face lying in the row's own plane) are rejected by `rayTriangle`'s determinant test and
 * contribute no crossing, which is the right answer for parity.
 *
 * Sets bits directly into `bits` (an OR, never a clear) — callers combining more than one
 * axis's vote are expected to accumulate into separate arrays and combine afterwards.
 */
function markInteriorAxis(
  triangles: readonly Triangle[],
  bounds: Bounds,
  dims: readonly [number, number, number],
  axis: 0 | 1 | 2,
  bits: Uint8Array,
): void {
  if (triangles.length === 0) return;
  const { starts, items } = bucketByRow(triangles, bounds, dims, axis);
  const dir: Vec3 = [0, 0, 0];
  (dir as [number, number, number])[axis] = 1;
  const [a, b] = rowAxes(axis);
  const nudgeA = axis === 0 ? 0.0137 : axis === 1 ? 0.0231 : 0.0119;
  const nudgeB = axis === 0 ? 0.0231 : axis === 1 ? 0.0119 : 0.0137;
  const ts: number[] = [];

  for (let ib = 0; ib < dims[b]; ib++) {
    for (let ia = 0; ia < dims[a]; ia++) {
      const row = ia + dims[a] * ib;
      const from = starts[row];
      const to = starts[row + 1];
      if (from === to) continue;

      // Start a cell before the grid so a face sitting exactly on the low bound still
      // registers a crossing rather than being swallowed by `rayTriangle`'s t > eps.
      const origin: Vec3 = [0, 0, 0];
      (origin as [number, number, number])[axis] = bounds.min[axis] - OCC_CELL;
      (origin as [number, number, number])[a] = bounds.min[a] + (ia + 0.5) * OCC_CELL + nudgeA;
      (origin as [number, number, number])[b] = bounds.min[b] + (ib + 0.5) * OCC_CELL + nudgeB;

      ts.length = 0;
      for (let k = from; k < to; k++) {
        const t = rayTriangle(origin, dir, triangles[items[k]]);
        if (t !== null) ts.push(t);
      }
      if (ts.length === 0) continue;
      ts.sort((x, y) => x - y);

      // `dir` is the unit axis from `origin`, so a crossing's ray parameter is just its
      // offset along the row. Walking the row in order lets one cursor retire the
      // crossings already behind each voxel; an odd number remaining ahead means inside.
      let cursor = 0;
      for (let ic = 0; ic < dims[axis]; ic++) {
        const dc = (ic + 1.5) * OCC_CELL;
        while (cursor < ts.length && ts[cursor] <= dc) cursor++;
        if ((ts.length - cursor) % 2 === 1) {
          const idx: [number, number, number] = [0, 0, 0];
          idx[axis] = ic;
          idx[a] = ia;
          idx[b] = ib;
          setBit(bits, voxelIndex(dims, idx[0], idx[1], idx[2]));
        }
      }
    }
  }
}

/**
 * Interior fill for one connected lump of geometry: a voxel counts as inside only when a
 * *majority* of the three axis-aligned ray-parity passes (`markInteriorAxis` along X, Y
 * and Z) agree, rather than trusting a single axis.
 *
 * Single-axis ray-parity assumes the surface it crosses is closed. A watertight,
 * reasonably convex lump — the overwhelming majority of real parts — gives the same
 * answer on every axis, so voting changes nothing for them. But a lump with a genuinely
 * open boundary (an unclosed end cap, a stud's open bottom rim) or non-manifold seams can
 * make one axis's ray graze exactly the wrong edge and misclassify everything further
 * along that row; a *different* axis's rays very rarely share the same blind spot, since
 * they cross the surface at a different angle entirely. Requiring two of three axes to
 * agree keeps a real interior solid (all three normally agree) while refusing to invent
 * volume that only one axis's ray-parity, alone, would have guessed at.
 *
 * Three passes over the same triangle list is still the same complexity class as one —
 * triangles + rows x (triangles per row), just paid three times — so it stays well inside
 * the performance budget that made row-based ray-parity necessary in the first place.
 */
function markInteriorVoting(
  triangles: readonly Triangle[],
  bounds: Bounds,
  dims: readonly [number, number, number],
  bits: Uint8Array,
): void {
  if (triangles.length === 0) return;
  const total = dims[0] * dims[1] * dims[2];
  const nbytes = Math.ceil(total / 8);
  // `votes` tracks "at least one axis has voted inside"; `atLeastTwo` is set the moment a
  // second axis votes for a bit already in `votes` — with only 3 axes total, "set on a
  // second (or third) vote" is exactly "at least 2 of 3 agree".
  const votes = new Uint8Array(nbytes);
  const atLeastTwo = new Uint8Array(nbytes);

  for (const axis of [0, 1, 2] as const) {
    const axisBits = new Uint8Array(nbytes);
    markInteriorAxis(triangles, bounds, dims, axis, axisBits);
    for (let i = 0; i < nbytes; i++) {
      atLeastTwo[i] |= votes[i] & axisBits[i];
      votes[i] |= axisBits[i];
    }
  }
  for (let i = 0; i < nbytes; i++) bits[i] |= atLeastTwo[i];
}

/**
 * Builds a part's occupancy mask from its triangulated geometry (part-local LDU).
 * Unconditionally solid-ish fill: a surface pass (triangle-vs-voxel AABB overlap) plus
 * an interior pass (three-axis ray-parity voting, `markInteriorVoting`) — run per
 * connected component. Nothing is erased — an unmated connector is ordinary solid
 * material. `connections` is accepted for call compatibility but plays no part in
 * building the mask; connector exemptions are evaluated at query time, in
 * `isExemptOverlap`, where both parts and their transforms are available to check that a
 * mating actually occurred.
 *
 * A clip or bracket is frequently two (or more) lumps that never touch — a plate body
 * and a separate clip barrel, joined by nothing wider than a thin neck, or joined by
 * nothing at all (verified against `4085c`, `6019`: each really is two disconnected
 * triangle groups, not one mesh with an odd shape). Running a single ray-parity pass over
 * the whole triangle soup treats that as one mesh: a ray happening to cross both lumps in
 * the same row toggles parity across the empty span between them, and a lump whose own
 * surface isn't closed can corrupt every crossing further along its row. Splitting into
 * `connectedComponents` first means a gap between two lumps is never bridged — no ray is
 * ever cast across geometry from two different lumps at once — and running each
 * component through 3-axis voting (`markInteriorVoting`) means a single axis's blind spot
 * on an imperfectly-closed lump can no longer manufacture solid volume on its own.
 *
 * A single molded part (a plain brick, the 32x32 baseplate) is one component, so the
 * component split is a pass-through for it — same triangles, same rows, same voxels. The
 * three-axis vote still runs, at three times the cost of the original single-axis pass;
 * `test:perf`'s budgets are set with headroom for that.
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
  for (const component of connectedComponents(triangles)) {
    markInteriorVoting(component, bounds, dims, bits);
  }
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
 * Voxel index range of `part` covering the region where `other` could possibly reach,
 * or null when the two cannot touch at all.
 *
 * `other`'s world AABB, pulled back into `part`'s local frame, bounds every point of
 * `other` that exists — so a `part` voxel outside it cannot map onto `other`'s occupancy
 * grid, and testing it is wasted work. Both AABBs are conservative (an AABB of a
 * transformed AABB only grows), and the range is padded by one cell because a mask's
 * dims round up: `other`'s grid can extend up to a cell past its own bounds. Nothing
 * inside the true overlap is skipped — the clip is an early-out, not an approximation.
 */
function overlapVoxelRange(
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
 * True if any occupied voxel of `part` (world space, via `transform`) lands inside an
 * occupied voxel of `other` (world space, via `otherTransform`). Sampled at voxel
 * centers, so it is a coarse test in both directions — callers run it both ways round to
 * catch a solid `other` voxel whose center a `part` voxel narrowly missed.
 *
 * Only the voxels `other` can actually reach are visited (`overlapVoxelRange`). A part's
 * grid is its whole bounding box — a 32x32 baseplate is 384,000 voxels — while two placed
 * parts touch over a small fraction of that, and this runs per candidate brick, both ways
 * round, on every frame of a drag.
 */
function anyOccupiedVoxelInside(
  part: PartDef,
  transform: Mat4,
  partInverse: Mat4,
  other: PartDef,
  otherTransform: Mat4,
  otherInverse: Mat4,
): boolean {
  const { dims, bits } = part.occupancy;
  const range = overlapVoxelRange(part, partInverse, other, otherTransform);
  if (!range) return false;
  const { lo, hi } = range;
  for (let iz = lo[2]; iz <= hi[2]; iz++) {
    for (let iy = lo[1]; iy <= hi[1]; iy++) {
      for (let ix = lo[0]; ix <= hi[0]; ix++) {
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
    if (
      anyOccupiedVoxelInside(part, transform, inverseTransform, entry.part, entry.transform, otherInverse)
    ) {
      return true;
    }
    if (
      anyOccupiedVoxelInside(entry.part, entry.transform, otherInverse, part, transform, inverseTransform)
    ) {
      return true;
    }
  }
  return false;
};
