/**
 * `HashSpatialIndex`'s broad phase.
 *
 * `nearBricks` used to be a linear scan over every indexed brick's bounds, correct but
 * O(n) per query — over half the 2 ms collision budget on its own at 500 bricks (see
 * `collision.ts`'s narrow phase and `docs/ARCHITECTURE.md`'s performance budget). It now
 * gathers candidates from the same 20 LDU cell grid `near()` already uses for connection
 * points, registering each brick in every cell its world bounds overlap rather than one.
 *
 * A test that only checks the *result* of `nearBricks` cannot tell a working grid from a
 * linear scan wearing a grid's clothes — both return the same bricks, correctly, just at
 * different cost. So this asserts exact candidate sets against bricks placed specifically
 * to exercise multi-cell registration: one that straddles a cell boundary, and one that
 * spans several cells outright.
 */

import { describe, expect, it } from 'vitest';

import { fromTranslation } from '../math';
import type { BrickId, Bounds } from '../types';
import { HashSpatialIndex, worldBounds } from './spatialIndex';
import type { PartDef } from './types';

/** A synthetic part with the given part-local bounds and no connectivity — this suite
 * tests the spatial data structure itself, not LDraw connectivity, so real fixture
 * geometry has nothing to add here. */
function partWithBounds(bounds: Bounds): PartDef {
  return {
    id: 'synthetic',
    title: 'synthetic',
    connections: [],
    bounds,
    occupancy: { dims: [1, 1, 1], bits: new Uint8Array(1) },
  };
}

const smallPart = partWithBounds({ min: [-2, -2, -2], max: [2, 2, 2] }); // 4 LDU cube
// Wider than one cell (20 LDU) but narrower than two — straddles a boundary once placed
// across one.
const straddlingPart = partWithBounds({ min: [-15, -2, -2], max: [15, 2, 2] }); // 30 LDU wide
// Wide enough to span several cells outright.
const wideParts = partWithBounds({ min: [-50, -2, -2], max: [50, 2, 2] }); // 100 LDU wide

const brick = (n: number) => `brick${n}` as BrickId;

describe('HashSpatialIndex.nearBricks', () => {
  it('returns exactly the bricks whose bounds overlap the query, not more, not fewer', () => {
    const index = new HashSpatialIndex();

    // A small brick at the origin.
    index.insert(brick(1), smallPart, fromTranslation([0, 0, 0]));
    // A small brick far away in its own, otherwise-empty cell — must never appear.
    index.insert(brick(2), smallPart, fromTranslation([500, 500, 500]));
    // A brick straddling the cell boundary at x=20 (its world bounds run roughly
    // x in [5,35]), registered under both the x=0 and x=20 cell columns.
    index.insert(brick(3), straddlingPart, fromTranslation([20, 0, 0]));
    // A brick spanning several cells outright (world bounds x in [-50,50], five cells
    // wide), centered far from the query.
    index.insert(brick(4), wideParts, fromTranslation([200, 0, 0]));

    // Query near the origin: brick 1 is inside it, brick 3's low end (x~5) also
    // reaches in, bricks 2 and 4 do not.
    const hits = new Set(index.nearBricks({ min: [-5, -5, -5], max: [10, 10, 10] }));
    expect(hits).toEqual(new Set([brick(1), brick(3)]));
  });

  it('finds a brick via the far cell of its span, not only the cell containing its origin', () => {
    const index = new HashSpatialIndex();
    // wideParts placed at x=200 spans world x in [150, 250] — five 20 LDU cells. Its own
    // "origin" cell (the one containing the placement transform's translation) is the
    // x=200 cell; query only the far end, at x=240, which is a different cell entirely.
    index.insert(brick(1), wideParts, fromTranslation([200, 0, 0]));
    const hits = index.nearBricks({ min: [238, -1, -1], max: [242, 1, 1] });
    expect(hits).toEqual([brick(1)]);
  });

  it('a query touching no populated cell returns nothing', () => {
    const index = new HashSpatialIndex();
    index.insert(brick(1), smallPart, fromTranslation([0, 0, 0]));
    expect(index.nearBricks({ min: [1000, 1000, 1000], max: [1001, 1001, 1001] })).toEqual([]);
  });

  it('removing a brick that spans several cells clears it from every one of them', () => {
    const index = new HashSpatialIndex();
    index.insert(brick(1), wideParts, fromTranslation([200, 0, 0]));
    // Confirmed present at both ends of its span before removal.
    expect(index.nearBricks({ min: [148, -1, -1], max: [152, 1, 1] })).toEqual([brick(1)]);
    expect(index.nearBricks({ min: [238, -1, -1], max: [242, 1, 1] })).toEqual([brick(1)]);

    index.remove(brick(1));

    expect(index.nearBricks({ min: [148, -1, -1], max: [152, 1, 1] })).toEqual([]);
    expect(index.nearBricks({ min: [238, -1, -1], max: [242, 1, 1] })).toEqual([]);
  });

  it('re-inserting at a new position updates which cells the brick is found in', () => {
    const index = new HashSpatialIndex();
    index.insert(brick(1), smallPart, fromTranslation([0, 0, 0]));
    expect(index.nearBricks({ min: [-1, -1, -1], max: [1, 1, 1] })).toEqual([brick(1)]);

    // insert() on an already-present id removes the old entry first (see the
    // implementation), so the stale cell must not keep returning it.
    index.insert(brick(1), smallPart, fromTranslation([500, 0, 0]));
    expect(index.nearBricks({ min: [-1, -1, -1], max: [1, 1, 1] })).toEqual([]);
    expect(index.nearBricks({ min: [499, -1, -1], max: [501, 1, 1] })).toEqual([brick(1)]);
  });
});

describe('nearBricks broad-phase performance', () => {
  // Not a strict pass/fail gate — CI hardware varies — but logs the measurement the
  // grid rewrite exists to fix, at the two scales it was reported against.
  it.each([500, 2000])('averages well under the 2 ms frame budget at %d bricks', (count) => {
    const index = new HashSpatialIndex();
    // Spread bricks across a wide volume so most grid cells hold at most a few bricks,
    // matching a real sparse build rather than a single dense cluster.
    for (let i = 0; i < count; i++) {
      const x = (i % 50) * 40;
      const y = (Math.floor(i / 50) % 50) * 40;
      const z = Math.floor(i / 2500) * 40;
      index.insert(brick(i), smallPart, fromTranslation([x, y, z]));
    }
    const queryBounds = worldBounds(smallPart.bounds, fromTranslation([0, 0, 0]));

    const iterations = 200;
    const timings: number[] = [];
    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      index.nearBricks(queryBounds);
      timings.push(performance.now() - start);
    }
    timings.sort((a, b) => a - b);
    const avg = timings.reduce((s, t) => s + t, 0) / timings.length;
    const p95 = timings[Math.floor(timings.length * 0.95)];
    // eslint-disable-next-line no-console
    console.log(`nearBricks at ${count} bricks: avg=${avg.toFixed(3)}ms p95=${p95.toFixed(3)}ms`);
    expect(avg).toBeLessThan(2);
  });
});

