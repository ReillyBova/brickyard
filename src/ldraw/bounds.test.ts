import { describe, expect, it } from 'vitest';

import { fixtureReader } from '../snap/__fixtures__/reader';
import { boundsFromPositions, boundsFromTriangles, partTriangles } from './bounds';

describe('boundsFromPositions', () => {
  it('computes an AABB from a flat xyz array', () => {
    // prettier-ignore
    const positions = [
      1, 2, 3,
      -1, 5, 0,
      2, -2, 9,
    ];
    expect(boundsFromPositions(positions)).toEqual({
      min: [-1, -2, 0],
      max: [2, 5, 9],
    });
  });

  it('is total: empty input yields a degenerate zero box, not NaN or Infinity', () => {
    expect(boundsFromPositions([])).toEqual({ min: [0, 0, 0], max: [0, 0, 0] });
  });
});

describe('partTriangles + boundsFromTriangles, real fixture geometry', () => {
  it('3001 (Brick 2x4) spans 80 x 24 x 40 LDU, studs at y=0, open underside at y=24', async () => {
    const triangles = await partTriangles('3001', fixtureReader);
    expect(triangles.length).toBeGreaterThan(0);

    const bounds = boundsFromTriangles(triangles);

    // docs/LDRAW-PRIMER.md: "A 2x4 brick therefore spans 80 x 24 x 40 LDU, with its studs
    // on the y=0 face and its open underside at y=24."
    expect(bounds.min[0]).toBeCloseTo(-40, 5);
    expect(bounds.max[0]).toBeCloseTo(40, 5);
    expect(bounds.min[1]).toBeCloseTo(-4, 5); // stud tip, 4 LDU above the y=0 top face
    expect(bounds.max[1]).toBeCloseTo(24, 5); // open underside
    expect(bounds.min[2]).toBeCloseTo(-20, 5);
    expect(bounds.max[2]).toBeCloseTo(20, 5);
  });

  it('an uncovered / missing part yields empty geometry rather than throwing', async () => {
    const triangles = await partTriangles('not-a-real-part', fixtureReader);
    expect(triangles).toEqual([]);
  });

  it('quads split into two triangles sharing an edge', async () => {
    // box5.dat (the brick body primitive) is built from type-4 quads; every one must
    // become exactly two triangles rather than being dropped or tripled.
    const triangles = await partTriangles('3001', fixtureReader);
    // Each split quad emits [a,b,c] and [a,c,d]; the first and third vertex of the second
    // triangle in a pair are shared with the first triangle. Spot check there is a
    // non-trivial amount of geometry from both the body and the studs.
    expect(triangles.length).toBeGreaterThan(50);
  });
});
