/**
 * Two kinds of test live here.
 *
 * The fixture tests resolve real parts out of `__fixtures__/`, captured from the LDraw and
 * LDCad libraries by `tools/capture-fixtures.mjs`. Their expected values are measured, not
 * invented; if the parser disagrees with them the parser is wrong.
 *
 * The rule tests below them drive tiny hand-written corpora. They exercise structure —
 * reference resolution order, SNAP_CLEAR, SNAP_INCL scaling — not geometry, and exist
 * because the shadow library has no captured example of some of those cases.
 */

import { describe, expect, it } from 'vitest';
import type { ConnectionPoint } from './types';
import { fixtureReader, geometryOnlyReader, readerFor } from './__fixtures__/reader';
import { referenceCandidates, resolvePart } from './resolvePart';

const round = (n: number) => Math.round(n * 1000) / 1000;
const pos = (p: ConnectionPoint) => p.position.map(round);
const axis = (p: ConnectionPoint) => [p.orientation[3], p.orientation[4], p.orientation[5]].map(round);
const profile = (p: ConnectionPoint) =>
  p.sections.map((s) => `${s.variant} ${s.radius} ${s.length}`).join(' · ');
const sorted = (v: number[]) => [...new Set(v)].sort((a, b) => a - b);

describe('3001 — Brick 2 x 4', () => {
  const load = () => resolvePart('3001', fixtureReader);

  it('resolves sixteen connection points', async () => {
    expect(await load()).toHaveLength(16);
  });

  it('inherits eight studs from p/stud.dat on the top face', async () => {
    const studs = (await load()).filter((p) => p.source === 'p/stud.dat');
    expect(studs).toHaveLength(8);
    for (const s of studs) {
      expect(s.kind).toBe('cyl');
      expect(s.gender).toBe('M');
      expect(profile(s)).toBe('R 6 4');
      expect(pos(s)[1]).toBe(0);
      expect(axis(s)).toEqual([0, 1, 0]);
      expect(s.slide).toBe(false);
    }
    expect(sorted(studs.map((s) => pos(s)[0]))).toEqual([-30, -10, 10, 30]);
    expect(sorted(studs.map((s) => pos(s)[2]))).toEqual([-10, 10]);
  });

  it('expands the single grid meta on parts/s/3001s01.dat into eight sockets', async () => {
    // The reference is written `s\3001s01.dat`, so this also covers backslash paths and
    // resolution into parts/.
    const sockets = (await load()).filter((p) => p.source === 'parts/s/3001s01.dat');
    expect(sockets).toHaveLength(8);
    for (const s of sockets) {
      expect(s.gender).toBe('F');
      expect(profile(s)).toBe('R 6 20');
      expect(pos(s)[1]).toBe(24);
      expect(axis(s)).toEqual([0, 1, 0]);
    }
    expect(sorted(sockets.map((s) => pos(s)[0]))).toEqual([-30, -10, 10, 30]);
    expect(sorted(sockets.map((s) => pos(s)[2]))).toEqual([-10, 10]);
  });

  it('gives every point a unique id', async () => {
    const points = await load();
    expect(new Set(points.map((p) => p.id)).size).toBe(points.length);
  });

  it('resolves identically on a second pass', async () => {
    expect(await load()).toEqual(await load());
  });
});

describe('4070 — Brick 1 x 1 with Headlight', () => {
  const load = () => resolvePart('4070', fixtureReader);

  it('resolves four connection points', async () => {
    expect(await load()).toHaveLength(4);
  });

  it('carries an upright stud, a sideways stud, a sideways socket and a square socket', async () => {
    const points = await load();
    const describe_ = points.map((p) => ({
      gender: p.gender,
      position: pos(p),
      axis: axis(p),
      sections: profile(p),
      source: p.source,
    }));

    expect(describe_).toContainEqual({
      gender: 'M',
      position: [0, 0, 0],
      axis: [0, 1, 0],
      sections: 'R 6 4',
      source: 'p/stud.dat',
    });

    // The sideways stud. Orientation is not an enum; there is no lattice.
    expect(describe_).toContainEqual({
      gender: 'M',
      position: [0, 10, -6],
      axis: [0, 0, 1],
      sections: 'R 6 4',
      source: 'p/stud2a.dat',
    });

    expect(describe_).toContainEqual({
      gender: 'F',
      position: [0, 10, 0],
      axis: [0, 0, -1],
      sections: 'R 4 8 · S 6 12',
      source: 'parts/4070.dat',
    });

    // A square section, not a round one.
    expect(describe_).toContainEqual({
      gender: 'F',
      position: [0, 24, 0],
      axis: [0, 1, 0],
      sections: 'S 6 4',
      source: 'parts/4070.dat',
    });
  });

  it('marks the sliding socket as sliding and the studs as not', async () => {
    const points = await load();
    expect(points.filter((p) => p.slide).map((p) => pos(p))).toEqual([[0, 10, 0]]);
  });
});

describe('3700 — Technic Brick 1 x 2 with Hole', () => {
  const load = () => resolvePart('3700', fixtureReader);

  it('resolves seven connection points', async () => {
    expect(await load()).toHaveLength(7);
  });

  it('reads the stepped pin hole as three sections', async () => {
    const hole = (await load()).filter((p) => p.source === 'p/connhole.dat');
    expect(hole).toHaveLength(1);
    expect(hole[0].gender).toBe('F');
    expect(profile(hole[0])).toBe('R 8 2 · R 6 16 · R 8 2');
    expect(pos(hole[0])).toEqual([0, 10, 0]);
    expect(axis(hole[0])).toEqual([0, 0, -1]);
    expect(hole[0].slide).toBe(true);
    // The bore, not the mouth, is what a pin has to match.
    expect((hole[0].key >> 7) & 0xff).toBe(12);
  });

  it('emits both genders from each p/stud2.dat reference', async () => {
    const open = (await load()).filter((p) => p.source === 'p/stud2.dat');
    expect(open).toHaveLength(4);
    for (const x of [-10, 10]) {
      expect(
        open.find((p) => p.gender === 'M' && pos(p)[0] === x && pos(p)[1] === 0),
      ).toBeDefined();
      expect(
        open.find((p) => p.gender === 'F' && pos(p)[0] === x && pos(p)[1] === -4),
      ).toBeDefined();
    }
    expect(open.filter((p) => p.gender === 'F').map((p) => axis(p))).toEqual([
      [0, -1, 0],
      [0, -1, 0],
    ]);
  });

  it('expands the underside grid, centred on X and single on Z', async () => {
    const under = (await load()).filter((p) => p.source === 'parts/3700.dat');
    expect(under).toHaveLength(2);
    expect(under.map((p) => pos(p))).toEqual([
      [-10, 24, 0],
      [10, 24, 0],
    ]);
    expect(under.every((p) => profile(p) === 'S 6 4' && p.gender === 'F')).toBe(true);
  });
});

describe('3818 — Minifig Arm Right', () => {
  const load = () => resolvePart('3818', fixtureReader);

  it('resolves three connection points', async () => {
    expect(await load()).toHaveLength(3);
  });

  it('places the shoulder socket off-lattice and off-axis', async () => {
    const socket = (await load()).find((p) => p.gender === 'F');
    expect(socket).toBeDefined();
    expect(profile(socket!)).toBe('R 2.5 15');
    expect(socket!.position[0]).toBeCloseTo(-5, 6);
    expect(socket!.position[1]).toBeCloseTo(18.8839, 6);
    expect(socket!.position[2]).toBeCloseTo(-9.8839, 6);
    expect(axis(socket!)).toEqual([0, 0.707, -0.707]);
  });

  it('inherits the hand knob from p/knob1.dat through nested subfile references', async () => {
    const knob = (await load()).find((p) => p.source === 'p/knob1.dat');
    expect(knob).toBeDefined();
    expect(knob!.gender).toBe('M');
    expect(pos(knob!)).toEqual([0, 0, 0]);
    expect(axis(knob!)).toEqual([-1, 0, 0]);
    // `R 5 2   _L 6 5`: the flexible transition keeps its radius and inherits the variant.
    expect(profile(knob!)).toBe('R 5 2 · R 6 5');
  });
});

describe('other snap kinds, from captured parts', () => {
  it('reads SNAP_CLP as a female clip (2335, Flag 2 x 2)', async () => {
    const points = await resolvePart('2335', fixtureReader);
    expect(points).toHaveLength(2);
    for (const p of points) {
      expect(p.kind).toBe('clip');
      expect(p.gender).toBe('F');
      expect(profile(p)).toBe('R 4 8');
      expect(p.source).toBe('p/clip1.dat');
    }
    expect(sorted(points.map((p) => pos(p)[1]))).toEqual([4, 36]);
  });

  it('reads SNAP_FGR as a finger run with its hinge group (3937, Hinge Brick 1 x 2 Base)', async () => {
    const points = await resolvePart('3937', fixtureReader);
    const finger = points.find((p) => p.kind === 'finger');
    expect(finger).toBeDefined();
    // seq=18 4 18, radius=4 — one section per finger, so the pattern survives.
    expect(profile(finger!)).toBe('R 4 18 · R 4 4 · R 4 18');
    expect(finger!.gender).toBe('F');
    expect(finger!.group).toBe('hgBrC');
    expect(pos(finger!)).toEqual([0, 10, 0]);
    expect(axis(finger!)).toEqual([-1, 0, 0]);
    expect(finger!.slide).toBe(false);
  });
});

describe('parts without coverage', () => {
  it('returns no connections when the shadow library has nothing, without throwing', async () => {
    expect(await resolvePart('3001', geometryOnlyReader)).toEqual([]);
  });

  it('returns no connections for a part id that does not exist', async () => {
    expect(await resolvePart('does-not-exist', fixtureReader)).toEqual([]);
  });

  it('ignores a commented-out annotation', async () => {
    // p/stud4.dat is captured with its SNAP_CYL parked behind `//`. If it were read,
    // every part referencing an anti-stud would gain a phantom connection.
    expect(await resolvePart('3070b', fixtureReader)).toHaveLength(2);
  });
});

describe('referenceCandidates', () => {
  it('searches parts/, then p/, then models/', () => {
    expect(referenceCandidates('stud.dat')).toEqual([
      'parts/stud.dat',
      'p/stud.dat',
      'models/stud.dat',
    ]);
  });

  it('normalises backslashes and case', () => {
    expect(referenceCandidates('S\\3001S01.DAT')[0]).toBe('parts/s/3001s01.dat');
  });

  it('takes a reference that already names a library directory as written', () => {
    expect(referenceCandidates('p/box5.dat')).toEqual(['p/box5.dat']);
  });

  it('yields nothing for an empty reference', () => {
    expect(referenceCandidates('   ')).toEqual([]);
  });
});

// --- rule tests over hand-written corpora ------------------------------------------

const stud = (gender: 'M' | 'F', id = 'x') =>
  `0 !LDCAD SNAP_CYL [id=${id}] [gender=${gender}] [secs=R 6 4]`;

describe('reference resolution', () => {
  const ref = (file: string) => `1 16 0 0 0 1 0 0 0 1 0 0 0 1 ${file}`;

  it('prefers parts/ over p/ and models/', async () => {
    const points = await resolvePart(
      'host',
      readerFor({
        'ldraw/parts/host.dat': ref('dup.dat'),
        'ldraw/parts/dup.dat': '0 in parts',
        'ldraw/p/dup.dat': '0 in p',
        'ldraw/models/dup.dat': '0 in models',
        'shadow/parts/dup.dat': stud('M'),
        'shadow/p/dup.dat': stud('F'),
        'shadow/models/dup.dat': stud('F'),
      }),
    );
    expect(points.map((p) => p.source)).toEqual(['parts/dup.dat']);
    expect(points[0].gender).toBe('M');
  });

  it('falls through to p/ when parts/ has no such file', async () => {
    const points = await resolvePart(
      'host',
      readerFor({
        'ldraw/parts/host.dat': ref('dup.dat'),
        'ldraw/p/dup.dat': '0 in p',
        'ldraw/models/dup.dat': '0 in models',
        'shadow/p/dup.dat': stud('M'),
      }),
    );
    expect(points.map((p) => p.source)).toEqual(['p/dup.dat']);
  });

  it('falls through to models/ last', async () => {
    const points = await resolvePart(
      'host',
      readerFor({
        'ldraw/parts/host.dat': ref('sub.ldr'),
        'ldraw/models/sub.ldr': '0 a submodel',
        'shadow/models/sub.ldr': stud('M'),
      }),
    );
    expect(points.map((p) => p.source)).toEqual(['models/sub.ldr']);
  });

  it('skips an unresolvable reference rather than throwing', async () => {
    const points = await resolvePart(
      'host',
      readerFor({
        'ldraw/parts/host.dat': [ref('missing.dat'), ref('present.dat')].join('\n'),
        'ldraw/p/present.dat': '0 present',
        'shadow/p/present.dat': stud('M'),
      }),
    );
    expect(points).toHaveLength(1);
  });

  it('skips a type-1 line with too few tokens rather than throwing', async () => {
    const points = await resolvePart(
      'host',
      readerFor({
        // Missing the trailing file token entirely, and missing several transform fields.
        'ldraw/parts/host.dat': ['1 16 0 0 0 1 0 0 0 1 0 0 0 1', ref('present.dat')].join('\n'),
        'ldraw/p/present.dat': '0 present',
        'shadow/p/present.dat': stud('M'),
      }),
    );
    expect(points).toHaveLength(1);
  });

  it('skips a type-1 line with a non-numeric transform field rather than throwing', async () => {
    const points = await resolvePart(
      'host',
      readerFor({
        'ldraw/parts/host.dat': [
          '1 16 0 0 0 1 NaN 0 0 1 0 0 0 1 bad.dat',
          ref('present.dat'),
        ].join('\n'),
        'ldraw/p/bad.dat': '0 bad',
        'shadow/p/bad.dat': stud('M', 'badStud'),
        'ldraw/p/present.dat': '0 present',
        'shadow/p/present.dat': stud('M'),
      }),
    );
    // Only the well-formed reference contributes; the malformed line is skipped outright,
    // not resolved with garbage numbers.
    expect(points).toHaveLength(1);
    expect(points[0].source).toBe('p/present.dat');
  });
});

describe('cyclic geometry references', () => {
  it('terminates on a two-file reference cycle instead of recursing to the depth cap', async () => {
    const ref = (file: string) => `1 16 0 0 0 1 0 0 0 1 0 0 0 1 ${file}`;
    const points = await resolvePart(
      'a',
      readerFor({
        // a.dat references b.dat, which references a.dat back — an unbounded cycle if
        // nothing tracks the chain. Each file also carries its own annotation, so a
        // depth-capped-but-undetected walk would emit many duplicates instead of two.
        'ldraw/parts/a.dat': ref('b.dat'),
        'ldraw/p/b.dat': ref('a.dat'),
        'shadow/parts/a.dat': stud('M', 'aStud'),
        'shadow/p/b.dat': stud('M', 'bStud'),
      }),
    );
    expect(points).toHaveLength(2);
    expect(points.map((p) => p.source).sort()).toEqual(['p/b.dat', 'parts/a.dat']);
  });
});

describe('transform accumulation', () => {
  it('multiplies transforms down a chain of references', async () => {
    // Translate by 20 in X, then rotate 90 degrees about X, then translate by 10 in Y.
    const points = await resolvePart(
      'host',
      readerFor({
        'ldraw/parts/host.dat': '1 16 20 0 0 1 0 0 0 1 0 0 0 1 mid.dat',
        'ldraw/p/mid.dat': '1 16 0 0 0 1 0 0 0 0 -1 0 1 0 leaf.dat',
        'ldraw/p/leaf.dat': '0 leaf',
        'shadow/p/leaf.dat': '0 !LDCAD SNAP_CYL [gender=M] [secs=R 6 4] [pos=0 10 0]',
      }),
    );
    expect(points).toHaveLength(1);
    // The rotation sends local +Y to +Z, so the snap lands at z = 10 and points that way.
    expect(pos(points[0])).toEqual([20, 0, 10]);
    expect(axis(points[0])).toEqual([0, 0, 1]);
  });

  it('keeps orientation a unit basis when a reference carries scale', async () => {
    const points = await resolvePart(
      'host',
      readerFor({
        'ldraw/parts/host.dat': '1 16 0 0 0 1 0 0 0 3 0 0 0 1 leaf.dat',
        'ldraw/p/leaf.dat': '0 leaf',
        'shadow/p/leaf.dat': '0 !LDCAD SNAP_CYL [gender=M] [secs=R 6 4] [pos=0 4 0]',
      }),
    );
    expect(pos(points[0])).toEqual([0, 12, 0]);
    expect(axis(points[0])).toEqual([0, 1, 0]);
  });

  it('applies a grid in the snap frame, so ori rotates the lattice', async () => {
    const points = await resolvePart(
      'host',
      readerFor({
        'ldraw/parts/host.dat': '0 host',
        'shadow/parts/host.dat':
          '0 !LDCAD SNAP_CYL [gender=M] [secs=R 6 4] [ori=1 0 0 0 0 -1 0 1 0] [grid=2 1 20 0]',
      }),
    );
    expect(points.map((p) => pos(p))).toEqual([
      [0, 0, 0],
      [20, 0, 0],
    ]);
    expect(axis(points[0])).toEqual([0, 0, 1]);
  });
});

describe('SNAP_INCL', () => {
  it('places an included file’s snaps at the given transform', async () => {
    const points = await resolvePart(
      'host',
      readerFor({
        'ldraw/parts/host.dat': '0 host',
        'shadow/parts/host.dat':
          '0 !LDCAD SNAP_INCL [ref=inc.dat] [pos=0 10 0] [ori=1 0 0 0 0 1 0 -1 0]',
        'shadow/p/inc.dat': '0 !LDCAD SNAP_CYL [gender=F] [secs=R 8 2 R 6 16 R 8 2]',
      }),
    );
    expect(points).toHaveLength(1);
    expect(points[0].source).toBe('p/inc.dat');
    expect(pos(points[0])).toEqual([0, 10, 0]);
    expect(axis(points[0])).toEqual([0, 0, -1]);
  });

  it('replicates an include over a grid', async () => {
    const points = await resolvePart(
      'host',
      readerFor({
        'ldraw/parts/host.dat': '0 host',
        'shadow/parts/host.dat': '0 !LDCAD SNAP_INCL [ref=inc.dat] [grid=C 2 1 40 0]',
        'shadow/p/inc.dat': stud('M'),
      }),
    );
    expect(points.map((p) => pos(p))).toEqual([
      [-20, 0, 0],
      [20, 0, 0],
    ]);
  });

  it('applies an include scale', async () => {
    const points = await resolvePart(
      'host',
      readerFor({
        'ldraw/parts/host.dat': '0 host',
        'shadow/parts/host.dat': '0 !LDCAD SNAP_INCL [ref=inc.dat] [scale=1 2 1]',
        'shadow/p/inc.dat': '0 !LDCAD SNAP_CYL [gender=M] [secs=R 6 4] [pos=0 10 0]',
      }),
    );
    expect(pos(points[0])).toEqual([0, 20, 0]);
  });

  it('stops at a self-referential include instead of recursing forever', async () => {
    const points = await resolvePart(
      'host',
      readerFor({
        'ldraw/parts/host.dat': '0 host',
        'shadow/parts/host.dat': [
          '0 !LDCAD SNAP_INCL [ref=host.dat]',
          stud('M'),
        ].join('\n'),
      }),
    );
    expect(points).toHaveLength(1);
  });
});

describe('SNAP_CLEAR', () => {
  const corpus = (clear: string) => ({
    'ldraw/parts/host.dat': [
      '1 16 0 0 0 1 0 0 0 1 0 0 0 1 a.dat',
      '1 16 20 0 0 1 0 0 0 1 0 0 0 1 b.dat',
    ].join('\n'),
    'ldraw/p/a.dat': '0 a',
    'ldraw/p/b.dat': '0 b',
    'shadow/p/a.dat': stud('M', 'aStud'),
    'shadow/p/b.dat': stud('M', 'bStud'),
    'shadow/parts/host.dat': [clear, '0 !LDCAD SNAP_CYL [gender=F] [secs=R 6 20] [pos=0 24 0]'].join(
      '\n',
    ),
  });

  it('drops everything inherited when no id is given', async () => {
    const points = await resolvePart('host', readerFor(corpus('0 !LDCAD SNAP_CLEAR')));
    expect(points.map((p) => p.source)).toEqual(['parts/host.dat']);
  });

  it('drops only the named id', async () => {
    const points = await resolvePart('host', readerFor(corpus('0 !LDCAD SNAP_CLEAR [id=aStud]')));
    expect(points.map((p) => p.source)).toEqual(['parts/host.dat', 'p/b.dat']);
  });

  it('never removes the annotations the file makes itself', async () => {
    const points = await resolvePart('host', readerFor(corpus('0 !LDCAD SNAP_CLEAR')));
    expect(points).toHaveLength(1);
    expect(profile(points[0])).toBe('R 6 20');
  });

  it('leaves the tree alone when there is no clear', async () => {
    const points = await resolvePart('host', readerFor(corpus('0 // nothing cleared')));
    expect(points).toHaveLength(3);
  });
});

describe('SNAP_GEN', () => {
  it('maps a bounding volume onto a section and keeps the matching group', async () => {
    const points = await resolvePart(
      'host',
      readerFor({
        'ldraw/parts/host.dat': '0 host',
        'shadow/parts/host.dat':
          '0 !LDCAD SNAP_GEN [group=towBall] [gender=F] [bounding=sph 6] [pos=0 12 0]',
      }),
    );
    expect(points).toHaveLength(1);
    expect(points[0].kind).toBe('general');
    expect(points[0].group).toBe('towBall');
    expect(points[0].gender).toBe('F');
    expect(profile(points[0])).toBe('R 6 12');
    expect(pos(points[0])).toEqual([0, 12, 0]);
  });
});
