/**
 * Mating tested against real parts, resolved from the captured corpus.
 *
 * The point of this suite is that the numbers are physical. Two 2x4 bricks stacked
 * squarely engage eight studs — not because we decided so, but because that is what
 * bricks do. If the maths is wrong the count moves, and no amount of plausible-looking
 * geometry hides it.
 */

import { describe, expect, it } from 'vitest';

import { IDENTITY, determinant, fromTranslation, invert, multiply, transformPoint } from '../math';
import type { BrickId, Mat4 } from '../types';
import { fixtureReader } from './__fixtures__/reader';
import { isCompatible, keysCompatible, unpackKey } from './compat';
import { packKey } from './parseMeta';
import { MATE_TOLERANCE, findMates, mateCount, pointMatrix, solveMating, worldPoint } from './mating';
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

describe('handedness', () => {
  // LDraw redirects radially-symmetric primitives with reflections: 4070 places its
  // sideways stud through a reference whose determinant is -1. That is invisible in the
  // geometry and very visible in the maths — mating composes the target frame with the
  // inverse of the moving frame, so one left-handed basis mirrors the whole placed part
  // while leaving the mated point exactly where it belongs, pointing exactly the right
  // way. Position-and-axis assertions cannot see it; a determinant can.
  it('4070 really does carry a left-handed connector basis', async () => {
    const headlight = await part('4070');
    const raw = headlight.connections.map((c) => c.orientation);
    const dets = raw.map(
      (o) =>
        o[0] * (o[4] * o[8] - o[5] * o[7]) -
        o[3] * (o[1] * o[8] - o[2] * o[7]) +
        o[6] * (o[1] * o[5] - o[2] * o[4]),
    );
    expect(dets.some((d) => d < 0)).toBe(true);
  });

  it('never places a mirrored part, whatever the connector handedness', async () => {
    const headlight = await part('4070');
    const brick = await part('3001');

    for (const target of headlight.connections) {
      for (const moving of brick.connections) {
        if (!isCompatible(moving, target)) continue;
        for (const roll of [0, 1, 2, 3]) {
          const placed = solveMating(brick, moving, target, IDENTITY, roll);
          expect(determinant(placed)).toBeGreaterThan(0);
        }
      }
    }
  });

  it('canonicalises every connector frame to right-handed', async () => {
    for (const id of ['3001', '4070', '3700', '3818']) {
      const p = await part(id);
      for (const c of p.connections) {
        expect(determinant(pointMatrix(c))).toBeGreaterThan(0);
      }
    }
  });
});

describe('axle exclusivity', () => {
  // A cross-section axle must not mate a round hole of the same radius: the whole point
  // of the distinction in Technic is that a round pin spins and an axle does not.
  const point = (variant: 'R' | 'S' | 'A', gender: 'M' | 'F'): ConnectionPoint => ({
    id: `${variant}${gender}`,
    kind: 'cyl',
    gender,
    sections: [{ variant, radius: 6, length: 4 }],
    position: [0, 0, 0],
    orientation: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    slide: false,
    key: packKey('cyl', gender, [{ variant, radius: 6, length: 4 }], false),
    source: 'test',
  });

  it('refuses an axle in a round hole and a round pin in an axle hole', () => {
    expect(isCompatible(point('A', 'M'), point('R', 'F'))).toBe(false);
    expect(isCompatible(point('R', 'M'), point('A', 'F'))).toBe(false);
  });

  it('accepts an axle in an axle hole', () => {
    expect(isCompatible(point('A', 'M'), point('A', 'F'))).toBe(true);
  });

  it('still treats round and square as interchangeable', () => {
    expect(isCompatible(point('R', 'M'), point('S', 'F'))).toBe(true);
    expect(isCompatible(point('S', 'M'), point('R', 'F'))).toBe(true);
  });

  it('isCompatible and keysCompatible cannot disagree', () => {
    for (const va of ['R', 'S', 'A'] as const) {
      for (const vb of ['R', 'S', 'A'] as const) {
        for (const ga of ['M', 'F'] as const) {
          for (const gb of ['M', 'F'] as const) {
            const a = point(va, ga);
            const b = point(vb, gb);
            expect(isCompatible(a, b)).toBe(keysCompatible(a.key, b.key, a.group, b.group));
          }
        }
      }
    }
  });
});

describe('hard connections, end to end on real parts', () => {
  // Each case here resolves two real captured parts, places one against the other with
  // solveMating, and confirms findMates independently discovers the same pair — proving
  // the connectivity model on the parts the project exists to handle, not just 3001.
  const index = new HashSpatialIndex();

  it('a Technic pin seats in a Technic brick hole', async () => {
    const brickPart = await part('3700');
    const pin = await part('3673');
    const hole = brickPart.connections.find((c) => c.source === 'p/connhole.dat')!;
    const peg = pin.connections.find((c) => c.gender === 'M')!;
    expect(hole).toBeDefined();
    expect(peg).toBeDefined();
    expect(isCompatible(peg, hole)).toBe(true);

    index.insert(brick(1), brickPart, IDENTITY);
    const placed = solveMating(pin, peg, hole, IDENTITY, 0);
    const groups = findMates(pin, placed, index);
    expect(groups).toHaveLength(1);
    expect(groups[0].mates.some((m) => m.aPoint === peg.id && m.bPoint === hole.id)).toBe(true);
    index.remove(brick(1));
  });

  it('a Technic pin pushed only halfway into a hole, from either end, still mates', async () => {
    // resolvePart collapses a pin's whole shaft to one centred point, and a real single
    // Technic hole is shallower than the pin that passes through it — so a pin actually
    // seated in one hole has its own centre well away from the hole's, along their
    // shared axis, with the rest of the shaft protruding freely. Measured directly
    // against the bundled models: this — not a compatibility or parsing bug — is what
    // left most real Technic connections unfound.
    const brickPart = await part('3700');
    const pin = await part('3673');
    const hole = brickPart.connections.find((c) => c.source === 'p/connhole.dat')!;
    const peg = pin.connections.find((c) => c.gender === 'M')!;
    index.insert(brick(1), brickPart, IDENTITY);

    const seated = solveMating(pin, peg, hole, IDENTITY, 0);
    const { position: holePos, axis } = worldPoint(hole, IDENTITY);

    // Slide the perfectly-seated placement 10 LDU along the shared axis — half the
    // pin's engaging shaft — so the pin's centre point no longer coincides with the
    // hole's at all, the way a pin actually pushed into one hole never does.
    const offset: Mat4 = fromTranslation([axis[0] * 10, axis[1] * 10, axis[2] * 10]);
    const halfway = multiply(offset, seated);
    const pegNow = worldPoint(peg, halfway);
    expect(Math.hypot(...pegNow.position.map((v, i) => v - holePos[i]))).toBeGreaterThan(9);

    const groups = findMates(pin, halfway, index);
    expect(groups).toHaveLength(1);
    expect(groups[0].mates.some((m) => m.aPoint === peg.id && m.bPoint === hole.id)).toBe(true);
    index.remove(brick(1));
  });

  it('a Technic pin refuses a Technic axle hole', async () => {
    const pin = await part('3673');
    const gear = await part('4716'); // Technic Worm Gear 2L — mounts on an axle
    const peg = pin.connections.find((c) => c.gender === 'M')!;
    const axleHole = gear.connections.find((c) => c.gender === 'F')!;
    expect(isCompatible(peg, axleHole)).toBe(false);
  });

  it('a Technic axle refuses a round pin hole', async () => {
    const axlePart = await part('3705');
    const brickPart = await part('3700');
    const axle = axlePart.connections.find((c) => c.source === 'parts/3705.dat')!;
    const hole = brickPart.connections.find((c) => c.source === 'p/connhole.dat')!;
    expect(isCompatible(axle, hole)).toBe(false);
  });

  it('a Technic axle seats in a worm gear, via its axle hole', async () => {
    const axlePart = await part('3705');
    const gear = await part('4716'); // Technic Worm Gear 2L — mounts on an axle
    const axle = axlePart.connections.find((c) => c.source === 'parts/3705.dat')!;
    const axleHole = gear.connections.find((c) => c.gender === 'F')!;
    expect(isCompatible(axle, axleHole)).toBe(true);

    index.insert(brick(1), gear, IDENTITY);
    const placed = solveMating(axlePart, axle, axleHole, IDENTITY, 0);
    const groups = findMates(axlePart, placed, index);
    expect(groups).toHaveLength(1);
    expect(groups[0].mates.some((m) => m.aPoint === axle.id && m.bPoint === axleHole.id)).toBe(
      true,
    );
    index.remove(brick(1));
  });

  it('an axle threaded from the opposite direction still mates — sliding connectors have no one true end', async () => {
    // p/axlehole.dat and p/connhole.dat are both drawn open at both faces (`caps=none`),
    // so an axle entering from the "wrong" side is exactly as valid as one entering from
    // the modelled direction. Its world axis reads as the exact negation, not a near
    // match — flip the seated placement 180 degrees about an axis perpendicular to the
    // connector (so the position stays put but the axle points the other way) and
    // confirm findMates still finds it. Measured directly against the bundled models,
    // this was rejecting every axle approached from that side, full stop.
    const axlePart = await part('3705');
    const gear = await part('4716');
    const axle = axlePart.connections.find((c) => c.source === 'parts/3705.dat')!;
    const axleHole = gear.connections.find((c) => c.gender === 'F')!;
    index.insert(brick(1), gear, IDENTITY);

    const seated = solveMating(axlePart, axle, axleHole, IDENTITY, 0);
    // 180 degrees about the connector's *own* local X, conjugated by its point matrix so
    // the pivot is the connector's world position regardless of its own orientation
    // quirks: flips its world +Y (the connector axis) without moving that position.
    const flipAboutX: Mat4 = [1, 0, 0, 0, 0, -1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1];
    const pm = pointMatrix(axle);
    const flipped = multiply(seated, multiply(pm, multiply(flipAboutX, invert(pm))));

    const before = worldPoint(axle, seated);
    const after = worldPoint(axle, flipped);
    expect(after.position).toEqual(before.position); // same seat, axis reversed
    const dot = after.axis[0] * before.axis[0] + after.axis[1] * before.axis[1] + after.axis[2] * before.axis[2];
    expect(dot).toBeCloseTo(-1, 6);

    const groups = findMates(axlePart, flipped, index);
    expect(groups).toHaveLength(1);
    expect(groups[0].mates.some((m) => m.aPoint === axle.id && m.bPoint === axleHole.id)).toBe(
      true,
    );
    index.remove(brick(1));
  });

  it('a real asymmetric slide connector refuses a mate approached from the opposite end', async () => {
    // 6141's own decorative stud is real, measured proof that `slide` alone does not mean
    // "no true end": `R 10 3 · R 6 4`, a flared base narrowing to a tip — reads
    // differently forwards and backwards, unlike a genuinely bidirectional Technic pin or
    // axle. Reusing the wide, slide-reaching search for its axis check as well let a real
    // neighbour's socket (98138, a round tile) match it 15 LDU away pointing the wrong
    // way entirely, in Saturn V, in the corpus this project ships. That pairing must stay
    // rejected.
    const plate = await part('6141');
    const tile = await part('98138');
    const stud = plate.connections.find((c) => c.id === 'parts/6141.dat#1')!;
    const socket = tile.connections[0];
    expect(stud.slide).toBe(true);
    expect(isCompatible(stud, socket)).toBe(true);

    index.insert(brick(1), plate, IDENTITY);

    // Seated normally (co-directional) first, as a sanity check that this pair really
    // can mate at all before checking the direction that must be refused.
    const seated = solveMating(tile, socket, stud, IDENTITY, 0);
    expect(findMates(tile, seated, index)).toHaveLength(1);

    // Flip 180 degrees about the socket's own local X, pivoting on its connector origin
    // exactly as the axle case above does: same seat, axis reversed.
    const flipAboutX: Mat4 = [1, 0, 0, 0, 0, -1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1];
    const pm = pointMatrix(socket);
    const flipped = multiply(seated, multiply(pm, multiply(flipAboutX, invert(pm))));

    const before = worldPoint(socket, seated);
    const after = worldPoint(socket, flipped);
    expect(after.position).toEqual(before.position);
    const d = after.axis[0] * before.axis[0] + after.axis[1] * before.axis[1] + after.axis[2] * before.axis[2];
    expect(d).toBeCloseTo(-1, 6);

    expect(findMates(tile, flipped, index)).toHaveLength(0);
    index.remove(brick(1));
  });

  it('a bar seats in a clip', async () => {
    const flag = await part('2335'); // Flag 2 x 2, carries two SNAP_CLP clips
    const lightsaber = await part('30374'); // Bar 4L Lightsaber Blade
    const [clip] = flag.connections;
    const [bar] = lightsaber.connections;
    expect(isCompatible(bar, clip)).toBe(true);

    index.insert(brick(1), flag, IDENTITY);
    const placed = solveMating(lightsaber, bar, clip, IDENTITY, 0);
    const groups = findMates(lightsaber, placed, index);
    expect(groups).toHaveLength(1);
    expect(groups[0].mates.some((m) => m.aPoint === bar.id && m.bPoint === clip.id)).toBe(true);
    index.remove(brick(1));
  });

  it('a sideways SNOT stud (4070) accepts a normal brick, off the lattice entirely', async () => {
    // The discriminating case for "sideways building": 4070's stud points along +Z, not
    // +Y, so the moving brick's socket has to land rotated 90 degrees to engage it —
    // exactly the geometry a lattice-based implementation could never produce.
    const headlight = await part('4070');
    const p3001 = await part('3001');
    const sidewaysStud = headlight.connections.find((c) => c.source === 'p/stud2a.dat')!;
    expect(sidewaysStud.gender).toBe('M');
    // Axis is [0, 0, 1] — sideways, not [0, ±1, 0] like every stud tested until now.
    expect([sidewaysStud.orientation[3], sidewaysStud.orientation[4], sidewaysStud.orientation[5]]).toEqual([
      0, 0, 1,
    ]);

    const socket = socketsDown(p3001)[0];
    expect(isCompatible(socket, sidewaysStud)).toBe(true);

    index.insert(brick(1), headlight, IDENTITY);
    const placed = solveMating(p3001, socket, sidewaysStud, IDENTITY, 0);
    const groups = findMates(p3001, placed, index);
    expect(groups).toHaveLength(1);
    expect(
      groups[0].mates.some((m) => m.aPoint === socket.id && m.bPoint === sidewaysStud.id),
    ).toBe(true);
    index.remove(brick(1));
  });

  it('two hinge halves interlock, fingers matching by group rather than gender alone', async () => {
    const base = await part('3937'); // Hinge Brick 1 x 2 Base
    const top = await part('3938'); // Hinge Brick 1 x 2 Top
    const baseFinger = base.connections.find((c) => c.kind === 'finger')!;
    const topFinger = top.connections.find((c) => c.kind === 'finger')!;
    expect(baseFinger.gender).toBe('F');
    expect(topFinger.gender).toBe('M');
    expect(isCompatible(baseFinger, topFinger)).toBe(true);

    // Both halves place their finger run at the same local pos/axis, so the identity
    // transform is where a real assembly puts them — the pivot line, not the mesh, is
    // what connectivity tracks.
    index.insert(brick(1), base, IDENTITY);
    const groups = findMates(top, IDENTITY, index);
    expect(groups).toHaveLength(1);
    const mate = groups[0].mates.find((m) => m.aPoint === topFinger.id && m.bPoint === baseFinger.id);
    expect(mate).toBeDefined();
    expect(mate!.kind).toBe('finger');
    expect(mate!.polarity).toBe('symmetric');
    index.remove(brick(1));
  });

  it('a minifig hand mates an arm even with real published-model imprecision', async () => {
    // Measured directly against Galaxy Explorer, Exo Suit and Saturn V: every minifig
    // arm-to-hand wrist joint in those bundled models sits about 0.496 LDU from a
    // perfectly seated placement — not drift in our own arithmetic (the two connectors'
    // *axes* agree to 15 significant digits) but the published `.mpd` files themselves,
    // whose 45-degree-rotated transforms are written to six decimal places. That
    // truncation, carried through a multi-level reference chain, reliably lands a real
    // wrist joint just past the old 0.35 LDU tolerance — rejecting essentially every
    // minifig arm and hand in the corpus for a reason that has nothing to do with
    // whether they actually belong together.
    const arm = await part('3818');
    const hand = await part('3820');
    const wrist = arm.connections.find((c) => c.id === 'parts/3818.dat#1')!; // F, shoulder-style socket
    const peg = hand.connections.find((c) => c.id === 'parts/3820.dat#0')!; // M
    expect(isCompatible(peg, wrist)).toBe(true);

    index.insert(brick(1), arm, IDENTITY);
    const seated = solveMating(hand, peg, wrist, IDENTITY, 0);

    // Perturb the seated placement by the measured real-world magnitude, in an arbitrary
    // direction unrelated to the connector's own axis — exactly the kind of offset a
    // truncated, rotated transform chain produces.
    const nudge: Mat4 = fromTranslation([0.28, -0.35, 0.15]); // magnitude ≈ 0.4736
    const nudged = multiply(nudge, seated);
    const before = worldPoint(peg, seated);
    const after = worldPoint(peg, nudged);
    const offset = Math.hypot(...after.position.map((v, i) => v - before.position[i]));
    expect(offset).toBeGreaterThan(0.35); // would have been rejected before this fix
    expect(offset).toBeLessThan(MATE_TOLERANCE);

    const groups = findMates(hand, nudged, index);
    expect(groups).toHaveLength(1);
    expect(groups[0].mates.some((m) => m.aPoint === peg.id && m.bPoint === wrist.id)).toBe(true);
    index.remove(brick(1));
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

  it('finds points at negative coordinates', async () => {
    // LDraw uses negative coordinates heavily — +Y is down, so anything stacked upward
    // has a negative Y — and integer division of negatives is a classic off-by-one.
    const p = await part('3001');
    const index = new HashSpatialIndex();
    const at = fromTranslation([-137, -240, -63]);
    index.insert(brick(1), p, at);

    for (const c of p.connections) {
      const where = worldPoint(c, at).position;
      expect(index.near(where, MATE_TOLERANCE).length).toBeGreaterThan(0);
    }
  });

  it('finds a point sitting exactly on a cell boundary, queried from either side', async () => {
    const p = await part('3001');
    const index = new HashSpatialIndex();
    // CELL_SIZE is 20 and the stud pitch is 20, so studs land on boundaries by nature.
    const at = fromTranslation([0, 0, 0]);
    index.insert(brick(1), p, at);

    for (const c of p.connections) {
      const [x, y, z] = worldPoint(c, at).position;
      const eps = 1e-4;
      expect(index.near([x - eps, y, z], MATE_TOLERANCE).length).toBeGreaterThan(0);
      expect(index.near([x + eps, y, z], MATE_TOLERANCE).length).toBeGreaterThan(0);
    }
  });

  it('a query radius wider than one cell still finds everything inside it', async () => {
    const p = await part('3001');
    const index = new HashSpatialIndex();
    index.insert(brick(1), p, IDENTITY);
    // 60 LDU spans three cells, so the neighbour scan has to widen rather than assume one.
    const found = index.near([0, 12, 0], 60);
    expect(found.length).toBe(p.connections.length);
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
