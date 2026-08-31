/**
 * Collision against real parts, resolved and voxelised from the captured corpus.
 *
 * Every assertion here is physical: a squarely stacked pair of 2x4 bricks is exactly
 * what LEGO bricks do all day, so if it reads as a collision the mask is wrong, not the
 * test.
 *
 * The suite is deliberately table-driven across five parts rather than leaning on 3001
 * alone. 3001's connectors are a small fraction of its volume, so a bug that erases
 * connector volume from the mask barely moves its numbers — that is exactly how the
 * unconditional bake-time clearance survived review. `4070` (1x1 with headlight),
 * `3700` (Technic, a sideways pin hole) and `2335` (a clip, not a stud) are connector-
 * dense or use connector kinds a stud never exercises, so a regression there shows up
 * immediately.
 */

import { describe, expect, it } from 'vitest';

import { boundsFromTriangles, partTriangles } from '../ldraw/bounds';
import { fromBasis, fromTranslation, multiply, IDENTITY } from '../math';
import type { BrickId, Mat3, Mat4, Vec3 } from '../types';
import { fixtureReader } from './__fixtures__/reader';
import { buildOccupancy, collides, connectorAt, isExemptOverlap, OCC_CELL } from './collision';
import { isCompatible } from './compat';
import { resolvePart } from './resolvePart';
import { HashSpatialIndex } from './spatialIndex';
import type { ConnectionPoint, PartDef } from './types';

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

function fillFraction(p: PartDef): number {
  const total = p.occupancy.dims[0] * p.occupancy.dims[1] * p.occupancy.dims[2];
  return occupiedCount(p.occupancy.bits) / total;
}

function rotY(deg: number): Mat4 {
  const t = (deg * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  const basis: Mat3 = [c, 0, -s, 0, 1, 0, s, 0, c];
  return fromBasis(basis, [0, 0, 0]);
}

function rotX(deg: number): Mat4 {
  const t = (deg * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  const basis: Mat3 = [1, 0, 0, 0, c, s, 0, -s, c];
  return fromBasis(basis, [0, 0, 0]);
}

const findByGender = (
  connections: readonly ConnectionPoint[],
  gender: 'M' | 'F',
  radiusBucket?: number,
): ConnectionPoint => {
  const found = connections.find(
    (c) => c.gender === gender && (radiusBucket === undefined || (c.key >> 7 & 0xff) === radiusBucket),
  );
  expect(found).toBeDefined();
  return found as ConnectionPoint;
};

// ---------------------------------------------------------------------------
// buildOccupancy: unconditional solid fill, no erosion, across the corpus
// ---------------------------------------------------------------------------

describe('buildOccupancy, across the corpus', () => {
  // Measured against the fixture corpus. `buildOccupancy` no longer erases connector
  // volume, so these sit well above the old post-erosion numbers (4070 was 14.3%) and
  // close to the pre-erosion fill each part actually has.
  const expected: Record<string, number> = {
    '3001': 0.74,
    '4070': 0.8,
    '3700': 0.843,
    '3818': 0.67,
    '2335': 0.631,
  };

  it.each(Object.entries(expected))('%s occupancy fill is unconditional (measured %f)', async (id, exp) => {
    const p = await part(id);
    const fill = fillFraction(p);
    // eslint-disable-next-line no-console
    console.log(`${id} occupancy: dims=${p.occupancy.dims} fill=${(fill * 100).toFixed(1)}%`);
    // A sane band around the measured value: solid enough to be a real part, not so
    // solid that open sockets and stud gaps would have to be lies.
    expect(fill).toBeGreaterThan(exp - 0.05);
    expect(fill).toBeLessThan(exp + 0.05);
    expect(fill).toBeGreaterThan(0.5); // nowhere near the old eroded 14.3%
    expect(fill).toBeLessThan(1);
  });

  it('4070 in particular is nowhere near its old post-erosion 14.3%', async () => {
    const p = await part('4070');
    expect(fillFraction(p)).toBeGreaterThan(0.7);
  });
});

// ---------------------------------------------------------------------------
// collides: table-driven across the corpus
// ---------------------------------------------------------------------------

describe('collides, self-stacked at [0,-24,0], across the corpus', () => {
  // 3001, 4070 and 3700 all have a compatible stud/socket pair on the mating axis, so a
  // squarely stacked pair does not collide. 3818 does not: per the correction below,
  // its shoulder (M, radius 5) and hand socket (F, radius 2.5) are different radius
  // buckets, so there is no self-mate and a stack is a genuine collision.
  const expected: Record<string, boolean> = {
    '3001': false,
    '4070': false,
    '3700': false,
    '3818': true,
  };

  it.each(Object.entries(expected))('%s stacked at [0,-24,0] collides=%s', async (id, exp) => {
    const p = await part(id);
    const index = new HashSpatialIndex();
    index.insert(brick(1), p, IDENTITY);
    const hit = collides(p, fromTranslation([0, -24, 0]), index);
    expect(hit).toBe(exp);
  });
});

describe('collides, exact self-overlap at IDENTITY, across the corpus', () => {
  // Placing a part exactly on top of itself is never a mate — every connector on the
  // moving part faces the same point on the other, which fails the co-directional axis
  // check even where the profiles are compatible. It must always read as a collision.
  it.each(['3001', '4070', '3700', '3818', '2335'])('%s at IDENTITY collides with itself', async (id) => {
    const p = await part(id);
    const index = new HashSpatialIndex();
    index.insert(brick(1), p, IDENTITY);
    expect(collides(p, IDENTITY, index)).toBe(true);
  });
});

describe('collides, real 4070 deep overlap', () => {
  it.each([
    [3, 3, 3],
    [4, 4, 4],
    [5, 5, 5],
  ])('detects overlap at [%d,%d,%d]', async (x, y, z) => {
    const p = await part('4070');
    const index = new HashSpatialIndex();
    index.insert(brick(1), p, IDENTITY);
    const hit = collides(p, fromTranslation([x, y, z]), index);
    expect(hit).toBe(true);
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

// ---------------------------------------------------------------------------
// Rotation: submodels and other assemblies are placed at arbitrary angles, not just
// identity and 90-degree steps.
// ---------------------------------------------------------------------------

describe('collides, rotated placements', () => {
  it('a whole assembly rotated 30 degrees about Y is still a valid stack', async () => {
    // The kind of rotation a published model's submodel actually carries: the base
    // brick and the one stacked on it are rotated together, rigidly, so the relative
    // offset between them — and therefore the mate — is unchanged.
    const p = await part('3001');
    const index = new HashSpatialIndex();
    const base = rotY(30);
    index.insert(brick(1), p, base);
    const stacked = multiply(base, fromTranslation([0, -24, 0]));
    expect(collides(p, stacked, index)).toBe(false);
  });

  it('a 30 degree tilt that breaks axis alignment is a real collision', async () => {
    // Here only the top brick tilts, about an axis perpendicular to the mating axis,
    // so the stud and the socket it drops into no longer point the same way. The
    // bodies still overlap deeply — this must not read as an exempt mate.
    const p = await part('3001');
    const index = new HashSpatialIndex();
    index.insert(brick(1), p, IDENTITY);
    const tilted = multiply(fromTranslation([0, -24, 0]), rotX(30));
    expect(collides(p, tilted, index)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// connectorAt: classifying connector volume at query time, including non-stud kinds.
// ---------------------------------------------------------------------------

describe('connectorAt', () => {
  it('classifies a point at a Technic pin hole (3700) as connector volume', async () => {
    // 3700's pin hole runs sideways, along local -Z, not -Y like every stud in the
    // corpus — a path a stud never exercises.
    const connections = await resolvePart('3700', fixtureReader);
    const hole = connections.find((c) => c.source.includes('connhole'));
    expect(hole).toBeDefined();
    const h = hole as ConnectionPoint;
    expect(h.sections.length).toBeGreaterThan(1); // stepped: R8x2, R6x16, R8x2

    // The hole's own position is always inside its own capsule (t=0, on-axis).
    expect(connectorAt(connections, h.position)).toBe(h);

    // A point far outside every connector's capsule is body material, or nothing.
    const far: Vec3 = [h.position[0] + 1000, h.position[1] + 1000, h.position[2] + 1000];
    expect(connectorAt(connections, far)).toBeUndefined();
  });

  it('classifies a point at a clip (2335) as connector volume', async () => {
    const connections = await resolvePart('2335', fixtureReader);
    const clip = connections.find((c) => c.kind === 'clip');
    expect(clip).toBeDefined();
    const c = clip as ConnectionPoint;
    expect(connectorAt(connections, c.position)).toBe(c);
  });

  it('does not classify a point well outside every capsule', async () => {
    const connections = await resolvePart('3001', fixtureReader);
    expect(connectorAt(connections, [1000, 1000, 1000])).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// isExemptOverlap: the full gate — connector volume on both sides, compatible
// profiles, co-directional axes.
// ---------------------------------------------------------------------------

describe('isExemptOverlap', () => {
  it('excuses a compatible stud/socket pair with matching world axes', async () => {
    const p = await part('3700');
    const stud = findByGender(p.connections, 'M', 12); // p/stud2.dat, radius 6
    const socket = p.connections.find((c) => c.source.includes('3700.dat') && c.gender === 'F');
    expect(socket).toBeDefined();
    const s = socket as ConnectionPoint;
    expect(isCompatible(stud, s)).toBe(true);

    expect(isExemptOverlap(p, IDENTITY, stud.position, p, IDENTITY, s.position)).toBe(true);
  });

  it('does not excuse a compatible profile whose axes disagree', async () => {
    // The Technic pin hole (axis local -Z) and a stud (axis local -Y) on the very same
    // 3700 share a radius bucket and both are cyl/round, so `isCompatible` alone would
    // wave this through. The axis check is what a stud alone never has to prove.
    const p = await part('3700');
    const hole = p.connections.find((c) => c.source.includes('connhole'));
    const stud = findByGender(p.connections, 'M', 12);
    expect(hole).toBeDefined();
    const h = hole as ConnectionPoint;
    expect(isCompatible(h, stud)).toBe(true); // profiles match...

    // ...but placed at the same identity transform, their world axes are perpendicular.
    expect(isExemptOverlap(p, IDENTITY, h.position, p, IDENTITY, stud.position)).toBe(false);
  });

  it('does not excuse two incompatible connectors even when both are connector volume', async () => {
    // 2335's two clip points are both female — clips grip a male bar, they never mate
    // each other — so this must not be excused regardless of geometry.
    const p = await part('2335');
    const clips = p.connections.filter((c) => c.kind === 'clip');
    expect(clips.length).toBeGreaterThanOrEqual(2);
    const [a, b] = clips;
    expect(isCompatible(a, b)).toBe(false);
    expect(isExemptOverlap(p, IDENTITY, a.position, p, IDENTITY, b.position)).toBe(false);
  });

  it('does not excuse an overlap that is not connector volume on both sides', async () => {
    const p = await part('3001');
    const stud = findByGender(p.connections, 'M');
    // The far corner of the bounding box is body material, not a connector.
    const bodyPoint: Vec3 = [p.bounds.max[0] - 1, p.bounds.min[1] + 1, p.bounds.max[2] - 1];
    expect(connectorAt(p.connections, bodyPoint)).toBeUndefined();
    expect(isExemptOverlap(p, IDENTITY, stud.position, p, IDENTITY, bodyPoint)).toBe(false);
  });
});

describe('OCC_CELL', () => {
  it('matches the 4 LDU cell size from docs/ARCHITECTURE.md', () => {
    expect(OCC_CELL).toBe(4);
  });
});
