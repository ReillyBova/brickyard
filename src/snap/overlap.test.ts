/**
 * `findOverlapVoxels` against real, resolved-and-voxelised parts from the captured
 * corpus — same fixture harness `collision.test.ts` uses (`fixtureReader`,
 * `resolvePart`, `buildOccupancy`), because this module exists to answer the same
 * question `collides` does, just with positions instead of a boolean.
 */

import { describe, expect, it } from 'vitest';

import { boundsFromTriangles, partTriangles } from '../ldraw/bounds';
import { collides } from './collision';
import { fromTranslation, IDENTITY, multiply } from '../math';
import type { BrickId, Mat4, Vec3 } from '../types';
import { fixtureReader } from './__fixtures__/reader';
import { buildOccupancy, OCC_CELL } from './collision';
import { findOverlapVoxels, DEFAULT_OVERLAP_LIMIT } from './overlap';
import { HashSpatialIndex } from './spatialIndex';
import { resolvePart } from './resolvePart';
import type { PartDef } from './types';

const cache = new Map<string, Promise<PartDef>>();

function part(id: string): Promise<PartDef> {
  let p = cache.get(id);
  if (!p) {
    p = (async () => {
      const [connections, triangles] = await Promise.all([
        resolvePart(id, fixtureReader),
        partTriangles(id, fixtureReader),
      ]);
      const bounds = boundsFromTriangles(triangles);
      const occupancy = buildOccupancy(triangles, bounds, connections);
      return { id, title: id, connections, bounds, occupancy };
    })();
    cache.set(id, p);
  }
  return p;
}

describe('findOverlapVoxels, real 3001 pairs', () => {
  it('a squarely stacked pair (mated) reports no overlap voxels', async () => {
    const p = await part('3001');
    const stacked: Mat4 = multiply(IDENTITY, fromTranslation([0, -24, 0]));
    expect(collides(p, stacked, indexOf(p))).toBe(false);
    expect(findOverlapVoxels(p, IDENTITY, p, stacked)).toEqual([]);
  });

  it('half-height overlap (a real collision) reports a non-empty, plausible region', async () => {
    const p = await part('3001');
    const halfOverlap: Mat4 = multiply(IDENTITY, fromTranslation([0, -12, 0]));
    expect(collides(p, halfOverlap, indexOf(p))).toBe(true);

    const voxels = findOverlapVoxels(p, IDENTITY, p, halfOverlap);
    expect(voxels.length).toBeGreaterThan(0);

    // Every reported voxel must actually sit inside both parts' world-space bounds —
    // a sanity check that the positions are real geometry, not garbage indices.
    const boundsA = worldBoundsOf(p, IDENTITY);
    const boundsB = worldBoundsOf(p, halfOverlap);
    for (const v of voxels) {
      expect(insideBounds(v, boundsA, OCC_CELL)).toBe(true);
      expect(insideBounds(v, boundsB, OCC_CELL)).toBe(true);
    }
  });

  it('touching but not overlapping (80 LDU apart) reports nothing', async () => {
    const p = await part('3001');
    const sideBySide: Mat4 = multiply(IDENTITY, fromTranslation([80, 0, 0]));
    expect(collides(p, sideBySide, indexOf(p))).toBe(false);
    expect(findOverlapVoxels(p, IDENTITY, p, sideBySide)).toEqual([]);
  });

  it('exact self-overlap at IDENTITY reports the whole shared volume, not a token handful', async () => {
    const p = await part('3001');
    // A part dropped exactly on top of an identical one overlaps its entire volume in
    // both directions — the largest overlap the part can ever produce against itself —
    // and still resolves under the default cap.
    const voxels = findOverlapVoxels(p, IDENTITY, p, IDENTITY);
    expect(voxels.length).toBeGreaterThan(500);
    expect(voxels.length).toBeLessThan(DEFAULT_OVERLAP_LIMIT);
  });

  it('a real 4070 deep overlap reports voxels near the overlap, cheaply', async () => {
    const p = await part('4070');
    const offset: Mat4 = fromTranslation([4, 4, 4]);
    expect(collides(p, offset, indexOf(p))).toBe(true);

    const start = performance.now();
    const voxels = findOverlapVoxels(p, IDENTITY, p, offset);
    const elapsed = performance.now() - start;
    // eslint-disable-next-line no-console
    console.log(`findOverlapVoxels(4070 deep overlap): ${voxels.length} voxels, ${elapsed.toFixed(3)} ms`);

    expect(voxels.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(10); // frame-budget headroom; see docs/ARCHITECTURE.md
  });

  it('respects the limit parameter', async () => {
    const p = await part('3001');
    const voxels = findOverlapVoxels(p, IDENTITY, p, IDENTITY, 3);
    expect(voxels.length).toBeLessThanOrEqual(3);
  });

  it('default limit is generous relative to a real dragging-style overlap', async () => {
    // Half the brick sunk into another, the kind of overlap a drag actually produces.
    // No wall-clock assertion here: timing measures the machine as much as the code, so
    // budgets live in *.perf.test.ts under vitest.perf.config.ts. Asserting elapsed time
    // in the unit suite made this fail intermittently whenever the box was busy.
    const p = await part('3001');
    const halfOverlap: Mat4 = multiply(IDENTITY, fromTranslation([0, -12, 0]));
    const voxels = findOverlapVoxels(p, IDENTITY, p, halfOverlap);

    expect(voxels.length).toBeLessThan(DEFAULT_OVERLAP_LIMIT);
  });
});

function indexOf(p: PartDef): HashSpatialIndex {
  const index = new HashSpatialIndex();
  index.insert('brick1' as BrickId, p, IDENTITY);
  return index;
}

function worldBoundsOf(p: PartDef, transform: Mat4): { min: Vec3; max: Vec3 } {
  const corners: Vec3[] = [];
  const { min, max } = p.bounds;
  for (const x of [min[0], max[0]]) {
    for (const y of [min[1], max[1]]) {
      for (const z of [min[2], max[2]]) {
        corners.push([
          transform[0] * x + transform[4] * y + transform[8] * z + transform[12],
          transform[1] * x + transform[5] * y + transform[9] * z + transform[13],
          transform[2] * x + transform[6] * y + transform[10] * z + transform[14],
        ]);
      }
    }
  }
  const lo: [number, number, number] = [Infinity, Infinity, Infinity];
  const hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const c of corners) {
    for (let a = 0; a < 3; a++) {
      lo[a] = Math.min(lo[a], c[a]);
      hi[a] = Math.max(hi[a], c[a]);
    }
  }
  return { min: lo, max: hi };
}

function insideBounds(v: Vec3, b: { min: Vec3; max: Vec3 }, pad: number): boolean {
  return (
    v[0] >= b.min[0] - pad &&
    v[0] <= b.max[0] + pad &&
    v[1] >= b.min[1] - pad &&
    v[1] <= b.max[1] + pad &&
    v[2] >= b.min[2] - pad &&
    v[2] <= b.max[2] + pad
  );
}

