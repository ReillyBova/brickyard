/**
 * Performance budgets for collision, against the part that exposed them.
 *
 * `3947` is a 32x32 baseplate with craters: 640 LDU square, so a 160x15x160 occupancy
 * grid — 384,000 voxels — over 39,304 triangles. Both numbers are ordinary for a large
 * moulded part and pathological for anything that pairs every voxel with every triangle,
 * or walks a whole grid per collision query. Occupancy is built the first time a part
 * resolves, today on the main thread, so a regression here is a visibly hung tab rather
 * than a slow test.
 *
 * The budgets are deliberately loose — roughly an order of magnitude above what the
 * current implementations measure, and two or more below the versions they replaced — so
 * they read as "the complexity class changed", not as a benchmark of the machine.
 *
 * Run with `npm run test:perf` (see `vitest.perf.config.ts`); excluded from the unit
 * suite and from CI, which should not gate on wall clock.
 */

import { describe, expect, it } from 'vitest';

import { boundsFromTriangles, partTriangles } from '../ldraw/bounds';
import { fromTranslation, IDENTITY } from '../math';
import type { BrickId, Vec3 } from '../types';
import { fixtureReader } from './__fixtures__/reader';
import { buildOccupancy, collides } from './collision';
import { resolvePart } from './resolvePart';
import { HashSpatialIndex, worldBounds } from './spatialIndex';
import type { PartDef } from './types';

async function geometry(id: string) {
  const triangles = await partTriangles(id, fixtureReader);
  return { triangles, bounds: boundsFromTriangles(triangles) };
}

async function part(id: string): Promise<PartDef> {
  const [connections, { triangles, bounds }] = await Promise.all([
    resolvePart(id, fixtureReader),
    geometry(id),
  ]);
  return { id, title: id, connections, bounds, occupancy: buildOccupancy(triangles, bounds, connections) };
}

/** Mean wall clock over `runs`, after one untimed warm-up. */
function mean(runs: number, fn: () => unknown): number {
  fn();
  const started = performance.now();
  for (let i = 0; i < runs; i++) fn();
  return (performance.now() - started) / runs;
}

describe('collision performance', () => {
  it('voxelises a 32x32 baseplate in well under a second', async () => {
    const { triangles, bounds } = await geometry('3947');
    const connections = await resolvePart('3947', fixtureReader);
    const started = performance.now();
    const mask = buildOccupancy(triangles, bounds, connections);
    const elapsed = performance.now() - started;

    // 384,000 voxels x 39,304 triangles measured at 187 seconds. One ray per voxel row
    // measures ~15ms; anything past a second means the interior pass is pairing voxels
    // with triangles again.
    expect(mask.dims).toEqual([160, 15, 160]);
    expect(elapsed).toBeLessThan(1000);
  });

  it('answers a collision query against a baseplate in a few milliseconds', async () => {
    const [plate, brick] = await Promise.all([part('3947'), part('3001')]);
    const index = new HashSpatialIndex();
    index.insert('plate' as BrickId, plate, IDENTITY);

    // A near miss is the worst case: no occupied voxel pair is ever found, so nothing
    // short-circuits and the query pays for every voxel it decides to visit. Assert the
    // broad phase still offers the plate — a miss the broad phase rejects outright would
    // make the budget below vacuous.
    const miss = fromTranslation([40, -40, 40] as Vec3);
    expect(index.nearBricks(worldBounds(brick.bounds, miss))).toContain('plate' as BrickId);
    expect(collides(brick, miss, index)).toBe(false);
    expect(mean(20, () => collides(brick, miss, index))).toBeLessThan(10);

    // And a hit, which should be no worse.
    const hit = fromTranslation([0, -8, 0] as Vec3);
    expect(collides(brick, hit, index)).toBe(true);
    expect(mean(20, () => collides(brick, hit, index))).toBeLessThan(10);
  });
});
