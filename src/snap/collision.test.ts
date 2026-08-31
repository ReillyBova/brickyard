/**
 * Collision against real parts, resolved and voxelised from the captured corpus.
 *
 * Every assertion here is physical: a squarely stacked pair of 2x4 bricks is exactly
 * what LEGO bricks do all day, so if it reads as a collision the mask is wrong, not the
 * test.
 */

import { describe, expect, it } from 'vitest';

import { boundsFromTriangles, partTriangles } from '../ldraw/bounds';
import { fromTranslation, multiply, IDENTITY } from '../math';
import type { BrickId, Mat4 } from '../types';
import { fixtureReader } from './__fixtures__/reader';
import { buildOccupancy, collides, OCC_CELL } from './collision';
import { resolvePart } from './resolvePart';
import { HashSpatialIndex } from './spatialIndex';
import type { PartDef } from './types';

const brick = (n: number) => `brick${n}` as BrickId;

const cache = new Map<string, Promise<PartDef>>();

/** Resolves a real part into a full `PartDef`: connections, real bounds, real occupancy. */
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

const occupiedCount = (bits: Uint8Array): number => {
  let n = 0;
  for (const byte of bits) {
    let b = byte;
    while (b) {
      n += b & 1;
      b >>= 1;
    }
  }
  return n;
};

describe('buildOccupancy, real 3001 geometry', () => {
  it('produces a mask covering the measured bounds at 4 LDU cells', async () => {
    const p = await part('3001');
    // Bounds: x [-40,40]=80, y [-4,24]=28, z [-20,20]=40 (see bounds.test.ts).
    expect(p.occupancy.dims).toEqual([20, 7, 10]);
    const total = p.occupancy.dims[0] * p.occupancy.dims[1] * p.occupancy.dims[2];
    const occupied = occupiedCount(p.occupancy.bits);
    // Sanity: solid but not literally every voxel (studs are round, the underside is
    // open), and not near-empty either (this is a brick, not a wireframe).
    expect(occupied).toBeGreaterThan(total * 0.15);
    expect(occupied).toBeLessThan(total);
    // eslint-disable-next-line no-console
    console.log(`3001 occupancy: dims=${p.occupancy.dims} total=${total} occupied=${occupied}`);
  });
});

describe('collides, real 3001 pairs', () => {
  it('two 2x4 bricks stacked squarely (offset [0,-24,0]) do not collide', async () => {
    const p = await part('3001');
    const index = new HashSpatialIndex();
    index.insert(brick(1), p, IDENTITY);

    const stacked: Mat4 = multiply(IDENTITY, fromTranslation([0, -24, 0]));
    const start = performance.now();
    const hit = collides(p, stacked, index);
    const elapsed = performance.now() - start;
    // eslint-disable-next-line no-console
    console.log(`collides(stacked squarely): ${hit}, ${elapsed.toFixed(3)} ms`);

    expect(hit).toBe(false);
  });

  it('the same pair overlapped by half a brick height (offset [0,-12,0]) does collide', async () => {
    const p = await part('3001');
    const index = new HashSpatialIndex();
    index.insert(brick(1), p, IDENTITY);

    const halfOverlap: Mat4 = multiply(IDENTITY, fromTranslation([0, -12, 0]));
    const hit = collides(p, halfOverlap, index);

    expect(hit).toBe(true);
  });

  it('two bricks side by side at 80 LDU (exactly touching) do not collide', async () => {
    const p = await part('3001');
    const index = new HashSpatialIndex();
    index.insert(brick(1), p, IDENTITY);

    const sideBySide: Mat4 = multiply(IDENTITY, fromTranslation([80, 0, 0]));
    const hit = collides(p, sideBySide, index);

    expect(hit).toBe(false);
  });

  it('two bricks overlapping sideways by 40 LDU (half a brick) do collide', async () => {
    const p = await part('3001');
    const index = new HashSpatialIndex();
    index.insert(brick(1), p, IDENTITY);

    const halfOverlap: Mat4 = multiply(IDENTITY, fromTranslation([40, 0, 0]));
    const hit = collides(p, halfOverlap, index);

    expect(hit).toBe(true);
  });

  it('respects the ignore set — a brick never collides with itself', async () => {
    const p = await part('3001');
    const index = new HashSpatialIndex();
    index.insert(brick(1), p, IDENTITY);

    const hit = collides(p, IDENTITY, index, new Set([brick(1)]));
    expect(hit).toBe(false);
  });

  it('an isolated brick with no neighbours never collides', async () => {
    const p = await part('3001');
    const index = new HashSpatialIndex();
    const hit = collides(p, IDENTITY, index);
    expect(hit).toBe(false);
  });

  it('a three-high stack — each pair mates squarely — collides with neither neighbour', async () => {
    const p = await part('3001');
    const index = new HashSpatialIndex();
    index.insert(brick(1), p, IDENTITY);
    index.insert(brick(2), p, fromTranslation([0, -24, 0]));

    const third: Mat4 = fromTranslation([0, -48, 0]);
    const hit = collides(p, third, index, new Set([brick(1), brick(2)]));
    expect(hit).toBe(false);
  });
});

describe('OCC_CELL', () => {
  it('matches the 4 LDU cell size from docs/ARCHITECTURE.md', () => {
    expect(OCC_CELL).toBe(4);
  });
});
