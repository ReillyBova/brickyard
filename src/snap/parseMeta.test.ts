import { describe, expect, it } from 'vitest';
import {
  gridOffsets,
  matingSection,
  packKey,
  parseAttributes,
  parseBoolean,
  parseBounding,
  parseGender,
  parseGrid,
  parseOrientation,
  parseSections,
  parseSnapLine,
  parseVec3,
} from './parseMeta';

describe('parseAttributes', () => {
  it('extracts every [key=value] pair and lowercases keys', () => {
    expect(parseAttributes('[ID=studC] [gender=M] [caps=one] [secs=R 6 4]')).toEqual({
      id: 'studC',
      gender: 'M',
      caps: 'one',
      secs: 'R 6 4',
    });
  });

  it('keeps values verbatim apart from surrounding whitespace', () => {
    expect(parseAttributes('[ secs = R 8 2   R 6 16  ]').secs).toBe('R 8 2   R 6 16');
  });

  it('yields an empty record when there are no attributes', () => {
    expect(parseAttributes('')).toEqual({});
  });

  it('tolerates a valueless attribute', () => {
    expect(parseAttributes('[center=] [slide=true]')).toEqual({ center: '', slide: 'true' });
  });
});

describe('parseSnapLine', () => {
  it('reads a SNAP_CYL line', () => {
    const meta = parseSnapLine('0 !LDCAD SNAP_CYL [ID=studC] [gender=M] [secs=R 6 4]');
    expect(meta?.command).toBe('SNAP_CYL');
    expect(meta?.attrs.gender).toBe('M');
  });

  it('is case-insensitive on the command', () => {
    expect(parseSnapLine('0 !ldcad snap_incl [ref=connhole.dat]')?.command).toBe('SNAP_INCL');
  });

  it('ignores a commented-out meta', () => {
    // p/stud4.dat parks its annotation this way; it must not become a connection.
    expect(parseSnapLine('0 //!LDCAD SNAP_CYL [id=aStud] [gender=F] [secs=R 6 4]')).toBeNull();
  });

  it('ignores ordinary comments, geometry and unknown metas', () => {
    expect(parseSnapLine('0 Author: LDCad Shadow Library')).toBeNull();
    expect(parseSnapLine('1 16 0 0 0 1 0 0 0 1 0 0 0 1 stud.dat')).toBeNull();
    expect(parseSnapLine('0 !LDCAD SNAP_WHAT [pos=0 0 0]')).toBeNull();
    expect(parseSnapLine('0 !LDCAD GENERATED')).toBeNull();
  });
});

describe('parseVec3 and parseOrientation', () => {
  it('reads a position', () => {
    expect(parseVec3('-5 18.8839 -9.8839')).toEqual([-5, 18.8839, -9.8839]);
  });

  it('falls back when the vector is missing or short', () => {
    expect(parseVec3(undefined)).toEqual([0, 0, 0]);
    expect(parseVec3('1 2')).toEqual([0, 0, 0]);
  });

  it('transposes ori from LDraw row-major into a column-major basis', () => {
    // Rows (0 -1 0) (1 0 0) (0 0 1); the connector axis is column 1, so [-1, 0, 0].
    const m = parseOrientation('0 -1 0 1 0 0 0 0 1');
    expect(m).toEqual([0, 1, 0, -1, 0, 0, 0, 0, 1]);
    expect([m[3], m[4], m[5]]).toEqual([-1, 0, 0]);
  });

  it('defaults to identity', () => {
    expect(parseOrientation(undefined)).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  });
});

describe('parseSections', () => {
  it('reads a single round section', () => {
    expect(parseSections('R 6 4')).toEqual([{ variant: 'R', radius: 6, length: 4 }]);
  });

  it('reads a square section', () => {
    expect(parseSections('S 6 4')).toEqual([{ variant: 'S', radius: 6, length: 4 }]);
  });

  it('reads an axle section', () => {
    expect(parseSections('A 6 20')).toEqual([{ variant: 'A', radius: 6, length: 20 }]);
  });

  it('reads a stepped multi-section profile', () => {
    expect(parseSections('R 8 2   R 6 16   R 8 2')).toEqual([
      { variant: 'R', radius: 8, length: 2 },
      { variant: 'R', radius: 6, length: 16 },
      { variant: 'R', radius: 8, length: 2 },
    ]);
  });

  it('mixes variants within one profile', () => {
    expect(parseSections('R 4 8   S 6 12')).toEqual([
      { variant: 'R', radius: 4, length: 8 },
      { variant: 'S', radius: 6, length: 12 },
    ]);
  });

  it('gives a _L transition the previous section variant', () => {
    // p/knob1.dat: `R 5 2   _L 6 5`.
    expect(parseSections('R 5 2   _L 6 5')).toEqual([
      { variant: 'R', radius: 5, length: 2 },
      { variant: 'R', radius: 6, length: 5 },
    ]);
  });

  it('gives an L_ transition the next section variant', () => {
    expect(parseSections('L_ 4 1   S 6 12')).toEqual([
      { variant: 'S', radius: 4, length: 1 },
      { variant: 'S', radius: 6, length: 12 },
    ]);
  });

  it('returns nothing for a missing or truncated profile', () => {
    expect(parseSections(undefined)).toEqual([]);
    expect(parseSections('R 6')).toEqual([]);
  });
});

describe('parseGrid', () => {
  it('reads both axes centred', () => {
    expect(parseGrid('C 4 C 2 20 20')).toEqual({
      x: { count: 4, centred: true, step: 20 },
      z: { count: 2, centred: true, step: 20 },
    });
  });

  it('reads a mixed centred and uncentred grid', () => {
    expect(parseGrid('C 2 1 20 0')).toEqual({
      x: { count: 2, centred: true, step: 20 },
      z: { count: 1, centred: false, step: 0 },
    });
  });

  it('returns null when absent', () => {
    expect(parseGrid(undefined)).toBeNull();
  });
});

describe('gridOffsets', () => {
  it('yields a single zero offset for no grid', () => {
    expect(gridOffsets(null)).toEqual([[0, 0, 0]]);
  });

  it('centres an even count about the origin', () => {
    // 3001's underside: four columns at -30, -10, 10, 30 and two rows at -10, 10.
    const offsets = gridOffsets(parseGrid('C 4 C 2 20 20'));
    expect(offsets).toHaveLength(8);
    expect([...new Set(offsets.map((o) => o[0]))].sort((a, b) => a - b)).toEqual([-30, -10, 10, 30]);
    expect([...new Set(offsets.map((o) => o[2]))].sort((a, b) => a - b)).toEqual([-10, 10]);
    expect(offsets.every((o) => o[1] === 0)).toBe(true);
  });

  it('centres an odd count on the origin', () => {
    expect(gridOffsets(parseGrid('C 3 1 20 0')).map((o) => o[0])).toEqual([-20, 0, 20]);
  });

  it('runs an uncentred axis from zero upwards', () => {
    expect(gridOffsets(parseGrid('4 1 20 0')).map((o) => o[0])).toEqual([0, 20, 40, 60]);
  });

  it('centres the Z axis independently of X', () => {
    const offsets = gridOffsets(parseGrid('1 C 4 0 8'));
    expect(offsets.map((o) => o[2])).toEqual([-12, -4, 4, 12]);
    expect(offsets.every((o) => o[0] === 0)).toBe(true);
  });

  it('walks X outermost so the order is stable', () => {
    expect(gridOffsets(parseGrid('2 2 10 5'))).toEqual([
      [0, 0, 0],
      [0, 0, 5],
      [10, 0, 0],
      [10, 0, 5],
    ]);
  });
});

describe('scalar attribute parsing', () => {
  it('reads booleans', () => {
    expect(parseBoolean('true')).toBe(true);
    expect(parseBoolean('TRUE')).toBe(true);
    expect(parseBoolean('false')).toBe(false);
    expect(parseBoolean(undefined)).toBe(false);
  });

  it('reads gender in both spellings', () => {
    expect(parseGender('F')).toBe('F');
    expect(parseGender('female')).toBe('F');
    expect(parseGender('M')).toBe('M');
    expect(parseGender(undefined)).toBe('M');
    expect(parseGender(undefined, 'F')).toBe('F');
  });

  it('maps SNAP_GEN bounding volumes onto a section profile', () => {
    expect(parseBounding('cyl 5 10')).toEqual([{ variant: 'R', radius: 5, length: 10 }]);
    expect(parseBounding('sph 3')).toEqual([{ variant: 'R', radius: 3, length: 6 }]);
    expect(parseBounding('cube 4')).toEqual([{ variant: 'S', radius: 4, length: 8 }]);
    expect(parseBounding('box 2 5 3')).toEqual([{ variant: 'S', radius: 3, length: 10 }]);
    expect(parseBounding('pnt')).toEqual([{ variant: 'R', radius: 0, length: 0 }]);
  });
});

describe('matingSection', () => {
  it('takes the bore of a stepped female profile — the dominant section by length', () => {
    expect(matingSection(parseSections('R 8 2 R 6 16 R 8 2'))).toEqual({
      variant: 'R',
      radius: 6,
      length: 16,
    });
  });

  it('picks the section with the most total length, not a fixed min or max', () => {
    // p/knob1.dat's real profile: a short neck (radius 5, length 2) flexing into a
    // longer widened run (radius 6, length 5). Neither "always widest" nor "always
    // narrowest" is safe in general — the section that dominates by length is.
    expect(matingSection(parseSections('R 5 2 _L 6 5'))).toEqual({
      variant: 'R',
      radius: 6,
      length: 5,
    });
  });

  it('picks the dominant section even when it sits in the middle, flanked by narrower ones', () => {
    // The real Technic pin (3673): two radius-6 shafts (16 LDU each) flank a short
    // radius-8 collar (4 LDU) and two short radius-6.25 tips (2 LDU each). The shafts
    // dominate by length, so they — not the collar — key the pin, matching 3700's hole.
    expect(matingSection(parseSections('R 6.25 2 R 6 16 R 8 4 R 6 16 R 6.25 2'))).toEqual({
      variant: 'R',
      radius: 6,
      length: 16,
    });
  });

  it('picks the dominant bore over a short, unreachable inner constriction', () => {
    // The real round brick 3062b's underside socket: a normal radius-6 bore for almost
    // its whole depth (20 LDU), narrowing to radius 4 only in the last 8 LDU that no
    // stud ever reaches. Measured against the bundled models, keying on the narrow tail
    // instead of the bore left every 3062b reading as incompatible with the stud it
    // visibly sits on.
    expect(matingSection(parseSections('R 6 20 R 4 8'))).toEqual({
      variant: 'R',
      radius: 6,
      length: 20,
    });
  });

  it('returns null for an empty profile', () => {
    expect(matingSection([])).toBeNull();
  });
});

describe('packKey', () => {
  const stud = () => packKey('cyl', 'M', parseSections('R 6 4'), false);
  const socket = () => packKey('cyl', 'F', parseSections('R 6 20'), false);

  it('is a non-negative integer', () => {
    expect(Number.isInteger(stud())).toBe(true);
    expect(stud()).toBeGreaterThan(0);
  });

  it('unpacks to the fields it was given', () => {
    const key = packKey('cyl', 'F', parseSections('R 8 2 R 6 16 R 8 2'), true);
    expect(key & 0b111).toBe(1); // kind: cyl
    expect((key >> 3) & 0b11).toBe(2); // gender: F
    expect((key >> 5) & 0b11).toBe(1); // variant: R
    expect((key >> 7) & 0xff).toBe(12); // radius 6 in half-LDU buckets
    expect((key >> 15) & 1).toBe(1); // slide
  });

  it('separates the two genders of the same profile', () => {
    expect(stud()).not.toBe(socket());
    expect(stud() ^ socket()).toBe((1 ^ 2) << 3);
  });

  it('keys a stud and a matching socket to the same kind, variant and radius', () => {
    const mask = ~(0b11 << 3);
    expect(stud() & mask).toBe(socket() & mask);
  });

  it('separates section variants at equal radius', () => {
    expect(packKey('cyl', 'F', parseSections('S 6 4'), false)).not.toBe(
      packKey('cyl', 'F', parseSections('R 6 4'), false),
    );
    expect(packKey('cyl', 'F', parseSections('A 6 4'), false)).not.toBe(
      packKey('cyl', 'F', parseSections('R 6 4'), false),
    );
  });

  it('separates radii but buckets to half an LDU', () => {
    expect(packKey('cyl', 'M', parseSections('R 4 4'), false)).not.toBe(stud());
    expect(packKey('cyl', 'M', parseSections('R 6.01 4'), false)).toBe(stud());
    expect(packKey('cyl', 'M', parseSections('R 2.5 4'), false)).not.toBe(
      packKey('cyl', 'M', parseSections('R 3 4'), false),
    );
  });

  it('separates the kinds', () => {
    const sections = parseSections('R 4 8');
    const keys = (['cyl', 'clip', 'finger', 'general'] as const).map((k) =>
      packKey(k, 'F', sections, false),
    );
    expect(new Set(keys).size).toBe(4);
  });

  it('records a profileless point with empty variant and radius fields', () => {
    const key = packKey('general', 'M', [], false);
    expect((key >> 5) & 0b11).toBe(0);
    expect((key >> 7) & 0xff).toBe(0);
  });

  it('packs the radius bucket ceiling (255) without throwing', () => {
    // round(127.5 / 0.5) === 255, the exact top of the 8-bit field.
    const key = packKey('cyl', 'M', parseSections('R 127.5 4'), false);
    expect((key >> 7) & 0xff).toBe(255);
  });

  it('throws rather than silently collapsing a radius above the packable ceiling', () => {
    // round(127.75 / 0.5) === 256, one past the 8-bit field's ceiling.
    expect(() => packKey('cyl', 'M', parseSections('R 127.75 4'), false)).toThrow(RangeError);
  });
});
