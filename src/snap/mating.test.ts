/**
 * Mating tested against real parts, resolved from the captured corpus.
 *
 * The point of this suite is that the numbers are physical. Two 2x4 bricks stacked
 * squarely engage eight studs — not because we decided so, but because that is what
 * bricks do. If the maths is wrong the count moves, and no amount of plausible-looking
 * geometry hides it.
 */

import { describe, expect, it } from 'vitest';

import { IDENTITY, fromTranslation, multiply, transformPoint } from '../math';
import type { BrickId, Mat4 } from '../types';
import { fixtureReader } from './__fixtures__/reader';
import { isCompatible, unpackKey } from './compat';
import { MATE_TOLERANCE, findMates, mateCount, solveMating, worldPoint } from './mating';
import { resolvePart } from './resolvePart';
import { HashSpatialIndex } from './spatialIndex';
import type { ConnectionPoint, PartDef } from './types';

const brick = (n: number) => `brick${n}` as BrickId;

async function part(id: string): Promise<PartDef> {
  const connections = await resolvePart(id, fixtureReader);
  return {
    id,
    title: id,
    connections,
    bounds: { min: [-1000, -1000, -1000], max: [1000, 1000, 1000] },
    occupancy: { dims: [1, 1, 1], bits: new Uint8Array(1) },
  };
}

const studsUp = (p: PartDef) => p.connections.filter((c) => unpackKey(c.key).gender === 'M');
const socketsDown = (p: PartDef) => p.connections.filter((c) => unpackKey(c.key).gender === 'F');

describe('compatibility', () => {
  it('mates a stud with a socket and refuses two studs', async () => {
    const p = await part('3001');
    const [stud] = studsUp(p);
    const [socket] = socketsDown(p);
    expect(isCompatible(stud, socket)).toBe(true);
    expect(isCompatible(stud, stud)).toBe(false);
    expect(isCompatible(socket, socket)).toBe(false);
  });

  it('mates a round stud with the square socket of a 1x1 brick', async () => {
    // 4070's underside is `S 6 4` while a stud is `R 6 4`. Real bricks connect here,
    // so a variant mismatch at equal radius must not block it.
    const headlight = await part('4070');
    const socket = headlight.connections.find(
      (c) => unpackKey(c.key).variant === 'S' && unpackKey(c.key).gender === 'F',
    );
    const stud = studsUp(headlight)[0];
    expect(socket).toBeDefined();
    expect(isCompatible(stud, socket as ConnectionPoint)).toBe(true);
  });

  it('refuses connectors of different radius', async () => {
    const p3001 = await part('3001');
    const arm = await part('3818');
    const stud = studsUp(p3001)[0]; // radius 6
    const shoulder = socketsDown(arm).find((c) => unpackKey(c.key).radiusBucket === 5); // radius 2.5
    expect(shoulder).toBeDefined();
    expect(isCompatible(stud, shoulder as ConnectionPoint)).toBe(false);
  });
});

describe('solveMating', () => {
  it('brings the two points together on a shared axis', async () => {
    const p = await part('3001');
    const stud = studsUp(p)[0];
    const socket = socketsDown(p)[0];

    const targetWorld = IDENTITY;
    const placed = solveMating(p, socket, stud, targetWorld, 0);

    const a = worldPoint(socket, placed);
    const b = worldPoint(stud, targetWorld);
    for (let i = 0; i < 3; i++) expect(a.position[i]).toBeCloseTo(b.position[i], 6);
    // Co-directional: the socket slides onto the stud along a shared axis.
    const d = a.axis[0] * b.axis[0] + a.axis[1] * b.axis[1] + a.axis[2] * b.axis[2];
    expect(d).toBeCloseTo(1, 6);
  });

  it('roll rotates about the shared axis and leaves the joint intact', async () => {
    const p = await part('3001');
    const stud = studsUp(p)[0];
    const socket = socketsDown(p)[0];

    for (const roll of [0, 1, 2, 3]) {
      const placed = solveMating(p, socket, stud, IDENTITY, roll);
      const a = worldPoint(socket, placed);
      const b = worldPoint(stud, IDENTITY);
      for (let i = 0; i < 3; i++) expect(a.position[i]).toBeCloseTo(b.position[i], 6);
    }

    // A quarter turn must actually move the rest of the brick.
    const straight = transformPoint(solveMating(p, socket, stud, IDENTITY, 0), [0, 0, 0]);
    const turned = transformPoint(solveMating(p, socket, stud, IDENTITY, 1), [0, 0, 0]);
    expect(straight).not.toEqual(turned);
  });
});

describe('findMates on real bricks', () => {
  const index = new HashSpatialIndex();

  it('a 2x4 squarely on a 2x4 engages eight studs', async () => {
    const p = await part('3001');
    index.insert(brick(1), p, IDENTITY);

    // A brick is 24 LDU tall and +Y is down, so the one on top sits at y = -24.
    const above: Mat4 = fromTranslation([0, -24, 0]);
    const groups = findMates(p, above, index);

    expect(groups).toHaveLength(1);
    expect(groups[0].brick).toBe(brick(1));
    expect(groups[0].mates).toHaveLength(8);
    // The upper brick's sockets take the lower brick's studs.
    expect(new Set(groups[0].mates.map((m) => m.polarity))).toEqual(new Set(['b']));
    index.remove(brick(1));
  });

  it('a half-overlapped 2x4 engages four studs', async () => {
    const p = await part('3001');
    index.insert(brick(1), p, IDENTITY);

    const offset: Mat4 = fromTranslation([40, -24, 0]); // two studs along
    expect(mateCount(findMates(p, offset, index))).toBe(4);
    index.remove(brick(1));
  });

  it('finds nothing when the bricks do not touch', async () => {
    const p = await part('3001');
    index.insert(brick(1), p, IDENTITY);
    expect(findMates(p, fromTranslation([0, -48, 0]), index)).toHaveLength(0);
    index.remove(brick(1));
  });

  it('refuses two bricks stacked the same way up, studs against studs', async () => {
    const p = await part('3001');
    index.insert(brick(1), p, IDENTITY);
    // Same orientation, translated so studs coincide with studs rather than sockets.
    expect(findMates(p, fromTranslation([0, 0, 0]), index)).toHaveLength(0);
    index.remove(brick(1));
  });

  it('refuses an upside-down brick whose sockets face away', async () => {
    // The discriminating case for direction. Turn a brick over and translate it so its
    // sockets land exactly on the lower brick's studs: positions coincide and genders
    // oppose, but the axes are anti-parallel because the sockets now open upward. A
    // real brick cannot connect this way, and only the axis test rejects it.
    const p = await part('3001');
    index.insert(brick(1), p, IDENTITY);

    const turnedOver: Mat4 = [1, 0, 0, 0, 0, -1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1];
    const flipped = multiply(fromTranslation([0, 24, 0]), turnedOver);

    // Sanity: a socket really has landed on a stud, so only direction can reject it.
    const socket = socketsDown(p)[0];
    const landed = worldPoint(socket, flipped);
    const coincident = index
      .near(landed.position, MATE_TOLERANCE)
      .filter((o) => unpackKey(o.key).gender === 'M');
    expect(coincident.length).toBeGreaterThan(0);

    expect(findMates(p, flipped, index)).toHaveLength(0);
    index.remove(brick(1));
  });

  it('spans two bricks, reporting each neighbour separately', async () => {
    const p = await part('3001');
    index.insert(brick(1), p, IDENTITY);
    index.insert(brick(2), p, fromTranslation([80, 0, 0])); // end to end

    // Centred across the seam: four studs on each.
    const groups = findMates(p, fromTranslation([40, -24, 0]), index);
    expect(groups).toHaveLength(2);
    expect(mateCount(groups)).toBe(8);
    expect(groups.every((g) => g.mates.length === 4)).toBe(true);

    index.remove(brick(1));
    index.remove(brick(2));
  });

  it('honours the exclude set', async () => {
    const p = await part('3001');
    index.insert(brick(1), p, IDENTITY);
    const above = fromTranslation([0, -24, 0]);
    expect(findMates(p, above, index, new Set([brick(1)]))).toHaveLength(0);
    index.remove(brick(1));
  });

  it('a placement solved by solveMating is confirmed by findMates', async () => {
    // The two halves must agree: solve a joint, then discover it.
    const p = await part('3001');
    index.insert(brick(1), p, IDENTITY);

    const target = studsUp(p)[0];
    const moving = socketsDown(p)[0];
    const placed = solveMating(p, moving, target, IDENTITY, 0);

    const groups = findMates(p, placed, index);
    expect(groups).toHaveLength(1);
    const found = groups[0].mates.find(
      (m) => m.aPoint === moving.id && m.bPoint === target.id,
    );
    expect(found).toBeDefined();
    index.remove(brick(1));
  });
});

describe('spatial index', () => {
  it('inserts, finds, and removes', async () => {
    const p = await part('3001');
    const index = new HashSpatialIndex();
    index.insert(brick(1), p, IDENTITY);
    expect(index.size).toBe(p.connections.length);
    expect(index.bricks()).toEqual([brick(1)]);

    const stud = studsUp(p)[0];
    const at = worldPoint(stud, IDENTITY).position;
    expect(index.near(at, MATE_TOLERANCE).length).toBeGreaterThan(0);

    index.remove(brick(1));
    expect(index.size).toBe(0);
    expect(index.near(at, MATE_TOLERANCE)).toHaveLength(0);
  });

  it('re-inserting the same brick replaces rather than duplicates', async () => {
    const p = await part('3001');
    const index = new HashSpatialIndex();
    index.insert(brick(1), p, IDENTITY);
    index.insert(brick(1), p, fromTranslation([100, 0, 0]));
    expect(index.size).toBe(p.connections.length);
  });

  it('finds points across a cell boundary', async () => {
    const p = await part('3001');
    const index = new HashSpatialIndex();
    // Place so studs land exactly on multiples of the 20 LDU cell size.
    index.insert(brick(1), p, fromTranslation([20, 0, 20]));
    const stud = studsUp(p)[0];
    const at = worldPoint(stud, multiply(fromTranslation([20, 0, 20]), IDENTITY)).position;
    expect(index.near(at, MATE_TOLERANCE).length).toBeGreaterThan(0);
  });
});
