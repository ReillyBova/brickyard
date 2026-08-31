import { describe, expect, it } from 'vitest';

import type { Mat4, Vec3 } from '../types';
import {
  compose,
  decompose,
  determinant,
  equals,
  fromTranslation,
  identity,
  index,
  invert,
  multiply,
  multiplyAll,
  transformDirection,
  transformPoint,
  translation,
} from './matrix';

/** Rotation by 90 degrees about +X, column-major. Maps +Y to +Z and +Z to -Y. */
const rotX90: Mat4 = [
  1, 0, 0, 0,
  0, 0, 1, 0,
  0, -1, 0, 0,
  0, 0, 0, 1,
];

/** Rotation by 90 degrees about +Y, column-major. Maps +Z to +X and +X to -Z. */
const rotY90: Mat4 = [
  0, 0, -1, 0,
  0, 1, 0, 0,
  1, 0, 0, 0,
  0, 0, 0, 1,
];

const close = (a: Vec3 | Mat4, b: Vec3 | Mat4) => {
  expect(a.length).toBe(b.length);
  for (let i = 0; i < a.length; i++) expect(a[i]).toBeCloseTo(b[i], 12);
};

describe('layout', () => {
  it('is column-major: translation occupies indices 12..14', () => {
    const m = fromTranslation([20, -24, 8]);
    expect(m[12]).toBe(20);
    expect(m[13]).toBe(-24);
    expect(m[14]).toBe(8);
    expect(translation(m)).toEqual([20, -24, 8]);
  });

  it('indexes row r column c at c * 4 + r', () => {
    expect(index(0, 0)).toBe(0);
    expect(index(1, 0)).toBe(1);
    expect(index(0, 3)).toBe(12);
    expect(index(3, 3)).toBe(15);
  });

  it('composes a basis and a translation into the LDraw affine layout', () => {
    const basis = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    const m = compose(basis, [5, 6, 7]);
    expect(m).toEqual(fromTranslation([5, 6, 7]));
    const back = decompose(m);
    expect(back.basis).toEqual(basis);
    expect(back.translation).toEqual([5, 6, 7]);
  });

  it('round-trips an arbitrary basis through compose and decompose', () => {
    const basis = [0, 0, -1, 0, 1, 0, 1, 0, 0];
    const back = decompose(compose(basis, [1, 2, 3]));
    expect(back.basis).toEqual(basis);
    expect(back.translation).toEqual([1, 2, 3]);
  });
});

describe('multiply', () => {
  it('leaves a matrix unchanged when multiplied by identity on either side', () => {
    close(multiply(identity(), rotX90), rotX90);
    close(multiply(rotX90, identity()), rotX90);
  });

  it('composes so that the right operand is applied first', () => {
    const t = fromTranslation([10, 0, 0]);
    // multiply(t, rotX90) rotates the point, then translates it.
    close(transformPoint(multiply(t, rotX90), [0, 1, 0]), [10, 0, 1]);
    // multiply(rotX90, t) translates first, then rotates the translated point.
    close(transformPoint(multiply(rotX90, t), [0, 1, 0]), [10, 0, 1]);
    // A translation along the rotated axis distinguishes the two orders.
    const ty = fromTranslation([0, 10, 0]);
    close(transformPoint(multiply(ty, rotX90), [0, 0, 0]), [0, 10, 0]);
    close(transformPoint(multiply(rotX90, ty), [0, 0, 0]), [0, 0, 10]);
  });

  it('is not commutative for two distinct rotations, and matches applied order', () => {
    const a = multiply(rotX90, rotY90);
    const b = multiply(rotY90, rotX90);
    expect(equals(a, b)).toBe(false);
    // a applies rotY90 first: +X -> -Z, then rotX90: -Z -> +Y.
    close(transformDirection(a, [1, 0, 0]), [0, 1, 0]);
    // b applies rotX90 first: +X -> +X, then rotY90: +X -> -Z.
    close(transformDirection(b, [1, 0, 0]), [0, 0, -1]);
  });

  it('multiplyAll folds left to right', () => {
    close(multiplyAll(rotX90, rotY90), multiply(rotX90, rotY90));
    close(multiplyAll(), identity());
    close(multiplyAll(rotX90), rotX90);
  });
});

describe('invert', () => {
  const affine: Mat4 = multiply(fromTranslation([13.5, -24, 7.25]), multiply(rotX90, rotY90));

  it('produces identity when multiplied by the original, either side', () => {
    close(multiply(affine, invert(affine)), identity());
    close(multiply(invert(affine), affine), identity());
  });

  it('inverts a scaled matrix', () => {
    const scaled: Mat4 = [2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 4, 0, 1, 2, 3, 1];
    close(multiply(scaled, invert(scaled)), identity());
    expect(determinant(scaled)).toBeCloseTo(24, 12);
  });

  it('is its own inverse', () => {
    close(invert(invert(affine)), affine);
  });

  it('throws on a singular matrix', () => {
    const singular: Mat4 = [0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    expect(() => invert(singular)).toThrow(/singular/);
  });
});

describe('transformPoint and transformDirection', () => {
  it('applies translation to points but not to directions', () => {
    const m = multiply(fromTranslation([20, 0, 0]), rotX90);
    close(transformPoint(m, [0, 1, 0]), [20, 0, 1]);
    close(transformDirection(m, [0, 1, 0]), [0, 0, 1]);
  });
});

describe('equals', () => {
  it('respects the epsilon', () => {
    const a = identity();
    const b = [...a];
    b[0] = 1 + 1e-9;
    expect(equals(a, b)).toBe(false);
    expect(equals(a, b, 1e-6)).toBe(true);
  });
});
