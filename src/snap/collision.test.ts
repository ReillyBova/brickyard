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
import { buildOccupancy, collides, connectorsAt, isExemptOverlap, OCC_CELL } from './collision';
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
// connectorsAt: classifying connector volume at query time, including non-stud kinds.
// ---------------------------------------------------------------------------

describe('connectorsAt', () => {
  it('classifies a point at a Technic pin hole (3700) as connector volume', async () => {
    // 3700's pin hole runs sideways, along local -Z, not -Y like every stud in the
    // corpus — a path a stud never exercises.
    const connections = await resolvePart('3700', fixtureReader);
    const hole = connections.find((c) => c.source.includes('connhole'));
    expect(hole).toBeDefined();
    const h = hole as ConnectionPoint;
    expect(h.sections.length).toBeGreaterThan(1); // stepped: R8x2, R6x16, R8x2

    // The hole's own position is always inside its own capsule (t=0, on-axis). It may
    // not be the *only* connector classified there (see the ambiguity test below), so
    // this asserts inclusion rather than an exact single match.
    expect(connectorsAt(connections, h.position)).toContain(h);

    // A point far outside every connector's capsule is body material: nothing at all.
    const far: Vec3 = [h.position[0] + 1000, h.position[1] + 1000, h.position[2] + 1000];
    expect(connectorsAt(connections, far)).toEqual([]);
  });

  it('classifies a point at a clip (2335) as connector volume', async () => {
    const connections = await resolvePart('2335', fixtureReader);
    const clip = connections.find((c) => c.kind === 'clip');
    expect(clip).toBeDefined();
    const c = clip as ConnectionPoint;
    expect(connectorsAt(connections, c.position)).toContain(c);
  });

  it('does not classify a point well outside every capsule', async () => {
    const connections = await resolvePart('3001', fixtureReader);
    expect(connectorsAt(connections, [1000, 1000, 1000])).toEqual([]);
  });

  it('pins the capsule to local -Y, not +Y — a sign flip must fail this', async () => {
    // CONNECTOR_EPS pads both ends of the capsule's interval, so near t=0 — the mating
    // interface, where a correctly-stacked pair's real contact sits — a capsule pointing
    // either direction covers the same shared boundary region. Every other test in this
    // file probes near that interface (self-mates, deep overlaps close to the connector),
    // which is exactly why a -Y/+Y sign flip previously passed the whole suite unnoticed.
    // This test probes deep along the *stepped* pin hole on 3700 (total length 20, far
    // longer than any stud's 4 LDU), well past the padded region on either end, so the
    // two orientations disagree.
    const connections = await resolvePart('3700', fixtureReader);
    const hole = connections.find((c) => c.source.includes('connhole'));
    expect(hole).toBeDefined();
    const h = hole as ConnectionPoint;
    const totalLength = h.sections.reduce((s, sec) => s + sec.length, 0);
    expect(totalLength).toBe(20);
    const axis: Vec3 = [h.orientation[3], h.orientation[4], h.orientation[5]];
    const along = (t: number): Vec3 => [
      h.position[0] + axis[0] * t,
      h.position[1] + axis[1] * t,
      h.position[2] + axis[2] * t,
    ];

    // 15 LDU back along -axis: inside the real (-Y) capsule ([-24, 4]), well outside
    // where a flipped (+Y) capsule would reach ([-4, 24] cannot see -15).
    expect(connectorsAt(connections, along(-15))).toContain(h);
    // 15 LDU forward along +axis: outside the real capsule, but exactly where a flipped
    // capsule would wrongly classify it as connector volume.
    expect(connectorsAt(connections, along(15))).not.toContain(h);
  });

  it('returns every connector whose capsule contains the point, not just the first', async () => {
    // The structural ambiguity this exists to handle: a squarely-stacked 3001's stud
    // (position y=0, length 4) and the socket it mates (position y=24, length 20) have
    // padded capsules that overlap at y in [0,4] — which includes the stud's own
    // position. A single-match classifier picks whichever sorts first in `connections`
    // (measured: a socket, not the stud, since sockets are listed before studs on the
    // real fixture) and that pick is not necessarily the connector the caller meant.
    const connections = await resolvePart('3001', fixtureReader);
    const stud = connections.find((c) => c.gender === 'M');
    expect(stud).toBeDefined();
    const m = stud as ConnectionPoint;

    const found = connectorsAt(connections, m.position);
    // The stud itself must be among the results...
    expect(found).toContain(m);
    // ...and, measured against the real fixture, so must at least one socket whose
    // padded capsule reaches down to the stud's position. If this ever drops to just
    // the stud, `CONNECTOR_EPS` or the fixture geometry changed enough that the
    // ambiguity this test exists to cover may no longer apply — worth re-checking
    // `isExemptOverlap`'s cross-product logic still has something to do.
    expect(found.some((c) => c.gender === 'F')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isExemptOverlap: the full gate — connector volume on both sides, compatible
// profiles, co-directional axes.
// ---------------------------------------------------------------------------

describe('isExemptOverlap', () => {
  it('excuses a compatible stud/socket pair whose own centers coincide, with matching world axes', async () => {
    const p = await part('3700');
    const stud = findByGender(p.connections, 'M', 12); // p/stud2.dat, radius 6, local [-10 or 10, 0, 0]
    // The socket directly above this particular stud — 3700 has one at each end, and
    // only the one sharing its x actually lands on this stud once stacked.
    const socket = p.connections.find(
      (c) => c.source.includes('3700.dat') && c.gender === 'F' && c.position[0] === stud.position[0],
    );
    expect(socket).toBeDefined();
    const s = socket as ConnectionPoint;
    expect(isCompatible(stud, s)).toBe(true);
    // The classifier must actually see both intended connectors at their own centers —
    // otherwise a `true` result below could be coming from some other pairing entirely.
    expect(connectorsAt(p.connections, stud.position)).toContain(stud);
    expect(connectorsAt(p.connections, s.position)).toContain(s);

    // A real stack: the base part at IDENTITY, the one on top offset by one brick
    // height along -Y (up, since +Y is down). The top's underside socket (local y=24)
    // then lands exactly on the base's top stud (local y=0) in world space — the same
    // offset the table-driven stacking tests above use.
    const onTop = fromTranslation([0, -24, 0]);
    expect(isExemptOverlap(p, IDENTITY, stud.position, p, onTop, s.position)).toBe(true);
  });

  it('does not excuse a compatible, coincident profile whose axes disagree', async () => {
    // The Technic pin hole (axis local -Z) and a stud (axis local -Y) on the very same
    // 3700 share a radius bucket and both are cyl/round, so `isCompatible` alone would
    // wave this through, and placing them so their own centers coincide clears the
    // position check too. Only the axis check catches this — a path a stud alone,
    // whose axis is always local Y, never has to prove.
    const p = await part('3700');
    const hole = p.connections.find((c) => c.source.includes('connhole'));
    const stud = findByGender(p.connections, 'M', 12);
    expect(hole).toBeDefined();
    const h = hole as ConnectionPoint;
    expect(isCompatible(h, stud)).toBe(true); // profiles match...
    expect(connectorsAt(p.connections, h.position)).toContain(h);
    expect(connectorsAt(p.connections, stud.position)).toContain(stud);

    // ...and translating the stud's part so the stud's own center lands exactly on the
    // hole's own center clears the coincidence check too...
    const toHole = fromTranslation([
      h.position[0] - stud.position[0],
      h.position[1] - stud.position[1],
      h.position[2] - stud.position[2],
    ]);
    // ...but translation alone cannot rotate the stud's local-Y axis onto the hole's
    // local-Z one, so they remain perpendicular in world space.
    expect(isExemptOverlap(p, IDENTITY, h.position, p, toHole, stud.position)).toBe(false);
  });

  it('does not excuse two coincident, incompatible connectors', async () => {
    // 2335's two clip points are both female — clips grip a male bar, they never mate
    // each other — so this must not be excused regardless of geometry. Translating one
    // clip's part so its own center lands on the other's clears the position check,
    // isolating the incompatibility as the reason this is rejected.
    const p = await part('2335');
    const clips = p.connections.filter((c) => c.kind === 'clip');
    expect(clips.length).toBeGreaterThanOrEqual(2);
    const [a, b] = clips;
    expect(isCompatible(a, b)).toBe(false);
    expect(connectorsAt(p.connections, a.position)).toContain(a);
    expect(connectorsAt(p.connections, b.position)).toContain(b);
    const toA = fromTranslation([
      a.position[0] - b.position[0],
      a.position[1] - b.position[1],
      a.position[2] - b.position[2],
    ]);
    expect(isExemptOverlap(p, IDENTITY, a.position, p, toA, b.position)).toBe(false);
  });

  it('does not excuse an overlap that is not connector volume on both sides', async () => {
    const p = await part('3001');
    const stud = findByGender(p.connections, 'M');
    // The far corner of the bounding box is body material, not a connector.
    const bodyPoint: Vec3 = [p.bounds.max[0] - 1, p.bounds.min[1] + 1, p.bounds.max[2] - 1];
    expect(connectorsAt(p.connections, bodyPoint)).toEqual([]);
    expect(isExemptOverlap(p, IDENTITY, stud.position, p, IDENTITY, bodyPoint)).toBe(false);
  });

  it('does not excuse two compatible, co-directional connectors that are not the same joint', async () => {
    // The reviewed hole: a compatible, co-directional, but unrelated connector pair
    // pulled 8 LDU apart — far outside MATE_TOLERANCE — was being waved
    // through because nothing checked the two connectors' own centers coincided.
    //
    // A single-match `connectorAt` made this test pass for the wrong reason: querying
    // at the stud's own position returned a *socket* first (3001's sockets sort before
    // its studs, and the socket's padded capsule reaches the stud's position — see
    // `connectorsAt`'s own ambiguity test above), so `isCompatible` rejected two
    // same-gender sockets before the coincidence check below ever ran. Measured on the
    // pre-fix branch: the assertions immediately below this comment — pinning which
    // connectors the classifier actually returns — failed, proving the old test never
    // reached its target.
    const p = await part('3001');
    const stud = findByGender(p.connections, 'M'); // radius 6, axis [0,1,0]
    const socket = p.connections.find((c) => c.gender === 'F');
    expect(socket).toBeDefined();
    const s = socket as ConnectionPoint;
    expect(isCompatible(stud, s)).toBe(true);

    // Pin exactly what a fixed `isExemptOverlap` must see: both intended connectors
    // present among the candidates at their own positions. `connectorsAt` may also
    // return other connectors at either point (the ambiguity above) — that's expected
    // and does not weaken this test, since `isExemptOverlap` must reject every pairing,
    // not just avoid the one this test is naming.
    expect(connectorsAt(p.connections, stud.position)).toContain(stud);
    expect(connectorsAt(p.connections, s.position)).toContain(s);

    // Offset the socket's part sideways by 8 LDU from where it would need to be to
    // actually coincide with the stud — well past both MATE_TOLERANCE and the
    // connector's own capsule radius.
    const wouldCoincide = fromTranslation([
      stud.position[0] - s.position[0],
      stud.position[1] - s.position[1],
      stud.position[2] - s.position[2],
    ]);
    const eightOff = multiply(wouldCoincide, fromTranslation([8, 0, 0]));
    expect(isExemptOverlap(p, IDENTITY, stud.position, p, eightOff, s.position)).toBe(false);
  });
});

describe('OCC_CELL', () => {
  it('matches the 4 LDU cell size from docs/ARCHITECTURE.md', () => {
    expect(OCC_CELL).toBe(4);
  });
});
