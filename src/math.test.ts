import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';

import {
  IDENTITY,
  axisOf,
  basisOf,
  determinant,
  equals,
  fromBasis,
  invert,
  multiply,
  multiplyAll,
  positionOf,
  transformDirection,
  transformPoint,
} from './math';
import type { Mat4, Vec3 } from './types';

/**
 * The adapter's contract is that our matrices are laid out identically to
 * `three.js Matrix4.elements`, so the strongest available check is agreement with
 * three itself over arbitrary transforms — including mirrored and non-uniformly
 * scaled ones, which is where a hand-rolled inverse would be most likely to fail.
 */
const randomMatrix = (rng: () => number): Mat4 => {
  // Keep scale away from zero so every matrix is invertible, but allow negatives
  // so the sample includes mirrored (negative-determinant) transforms.
  const scale = (): number => {
    const v = rng() * 4 - 2;
    return Math.abs(v) < 0.25 ? (v < 0 ? -0.5 : 0.5) : v;
  };
  const m = new Matrix4().compose(
    new Vector3(rng() * 200 - 100, rng() * 200 - 100, rng() * 200 - 100),
    new Quaternion().setFromEuler(new Euler(rng() * 6, rng() * 6, rng() * 6, 'XYZ')),
    new Vector3(scale(), scale(), scale()),
  );
  return [...m.elements];
};

/** Deterministic, so a failure is reproducible. */
const seeded = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

describe('layout', () => {
  it('is column-major, with translation at indices 12 to 14', () => {
    const m = fromBasis([1, 0, 0, 0, 1, 0, 0, 0, 1], [10, 20, 30]);
    expect(m.slice(12, 15)).toEqual([10, 20, 30]);
    expect(positionOf(m)).toEqual([10, 20, 30]);
  });

  it('matches three.js element order', () => {
    const rng = seeded(7);
    const ours = randomMatrix(rng);
    expect([...new Matrix4().fromArray([...ours]).elements]).toEqual(ours);
  });

  it('round-trips a basis and position', () => {
    const basis = [0, 0, -1, 0, 1, 0, 1, 0, 0];
    const m = fromBasis(basis, [1, 2, 3]);
    expect(basisOf(m)).toEqual(basis);
    expect(positionOf(m)).toEqual([1, 2, 3]);
  });
});

describe('multiply', () => {
  it('applies the right operand first', () => {
    // A non-commuting pair: order is observable in where the origin lands.
    const translateY = fromBasis([1, 0, 0, 0, 1, 0, 0, 0, 1], [0, 10, 0]);
    const rotateX90 = fromBasis([1, 0, 0, 0, 0, 1, 0, -1, 0], [0, 0, 0]);

    expect(transformPoint(multiply(translateY, rotateX90), [0, 0, 0])).toEqual([0, 10, 0]);
    const [x, y, z] = transformPoint(multiply(rotateX90, translateY), [0, 0, 0]);
    expect([Math.round(x), Math.round(y), Math.round(z)]).toEqual([0, 0, 10]);
  });

  it('agrees with three.js over random matrices', () => {
    const rng = seeded(11);
    for (let i = 0; i < 200; i++) {
      const a = randomMatrix(rng);
      const b = randomMatrix(rng);
      const expected = new Matrix4()
        .multiplyMatrices(new Matrix4().fromArray([...a]), new Matrix4().fromArray([...b]))
        .elements;
      expect(equals(multiply(a, b), [...expected], 1e-9)).toBe(true);
    }
  });

  it('composes left to right', () => {
    const rng = seeded(13);
    const [a, b, c] = [randomMatrix(rng), randomMatrix(rng), randomMatrix(rng)];
    expect(equals(multiplyAll(a, b, c), multiply(multiply(a, b), c), 1e-9)).toBe(true);
  });

  it('leaves inputs unmutated', () => {
    const a = fromBasis([1, 0, 0, 0, 1, 0, 0, 0, 1], [1, 2, 3]);
    const before = [...a];
    multiply(a, IDENTITY);
    expect([...a]).toEqual(before);
  });
});

describe('invert', () => {
  it('agrees with three.js, including mirrored and non-uniformly scaled matrices', () => {
    const rng = seeded(17);
    let mirrored = 0;
    for (let i = 0; i < 200; i++) {
      const m = randomMatrix(rng);
      if (determinant(m) < 0) mirrored++;
      const expected = new Matrix4().fromArray([...m]).invert().elements;
      expect(equals(invert(m), [...expected], 1e-6)).toBe(true);
    }
    // The check is only meaningful if negative-determinant cases actually occurred.
    expect(mirrored).toBeGreaterThan(0);
  });

  it('round-trips to identity', () => {
    const rng = seeded(19);
    const m = randomMatrix(rng);
    expect(equals(multiply(m, invert(m)), IDENTITY, 1e-6)).toBe(true);
    expect(equals(multiply(invert(m), m), IDENTITY, 1e-6)).toBe(true);
  });

  it('throws on a singular matrix rather than returning a sentinel', () => {
    expect(() => invert(fromBasis([0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0]))).toThrow(/not invertible/);
  });
});

describe('vectors', () => {
  it('transformPoint applies translation and transformDirection does not', () => {
    const m = fromBasis([1, 0, 0, 0, 1, 0, 0, 0, 1], [5, 5, 5]);
    expect(transformPoint(m, [1, 0, 0])).toEqual([6, 5, 5]);
    expect(transformDirection(m, [1, 0, 0])).toEqual([1, 0, 0]);
  });

  it('axisOf reads local +Y, which is LDraw down', () => {
    expect(axisOf(IDENTITY)).toEqual([0, 1, 0]);
    // Column-major, so the middle triple is the +Y column: here it points at -Z.
    const rotated = fromBasis([1, 0, 0, 0, 0, -1, 0, 1, 0], [0, 0, 0]);
    const axis = axisOf(rotated) as Vec3;
    expect(axis.map(Math.round)).toEqual([0, 0, -1]);
  });

  it('transformDirection renormalises under scale', () => {
    const scaled = fromBasis([3, 0, 0, 0, 3, 0, 0, 0, 3], [0, 0, 0]);
    const [x, y, z] = transformDirection(scaled, [0, 1, 0]);
    expect(Math.hypot(x, y, z)).toBeCloseTo(1, 12);
  });
});
