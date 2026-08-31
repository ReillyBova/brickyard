/**
 * Minimal column-major 4x4 matrix helpers.
 *
 * Layout is identical to three.js `Matrix4.elements`: element `i` of column `c`,
 * row `r`, lives at `m[c * 4 + r]`. Translation therefore occupies indices 12, 13, 14.
 *
 * Pure: no three.js imports, no DOM.
 */

import type { Mat3, Mat4, Vec3 } from '../types';

/** Column-major index of row `r`, column `c`. */
export const index = (r: number, c: number): number => c * 4 + r;

export const identity = (): Mat4 => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/**
 * Matrix product `a · b`, in the usual mathematical sense: the result applies `b`
 * to a column vector first, then `a`. Matches `Matrix4.multiplyMatrices(a, b)`.
 */
export const multiply = (a: Mat4, b: Mat4): Mat4 => {
  const out = new Array<number>(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = sum;
    }
  }
  return out;
};

/** Left-to-right composition: `compose(a, b, c)` applies `c`, then `b`, then `a`. */
export const multiplyAll = (...ms: readonly Mat4[]): Mat4 =>
  ms.length === 0 ? identity() : ms.reduce((acc, m) => multiply(acc, m));

export const determinant = (m: Mat4): number => {
  const [
    m00, m10, m20, m30,
    m01, m11, m21, m31,
    m02, m12, m22, m32,
    m03, m13, m23, m33,
  ] = m;

  const s0 = m00 * m11 - m01 * m10;
  const s1 = m00 * m12 - m02 * m10;
  const s2 = m00 * m13 - m03 * m10;
  const s3 = m01 * m12 - m02 * m11;
  const s4 = m01 * m13 - m03 * m11;
  const s5 = m02 * m13 - m03 * m12;

  const c5 = m22 * m33 - m23 * m32;
  const c4 = m21 * m33 - m23 * m31;
  const c3 = m21 * m32 - m22 * m31;
  const c2 = m20 * m33 - m23 * m30;
  const c1 = m20 * m32 - m22 * m30;
  const c0 = m20 * m31 - m21 * m30;

  return s0 * c5 - s1 * c4 + s2 * c3 + s3 * c2 - s4 * c1 + s5 * c0;
};

/**
 * Full 4x4 inverse. Throws on a singular matrix rather than returning identity:
 * a degenerate brick transform is a bug worth surfacing, not one worth hiding.
 */
export const invert = (m: Mat4): Mat4 => {
  const [
    m00, m10, m20, m30,
    m01, m11, m21, m31,
    m02, m12, m22, m32,
    m03, m13, m23, m33,
  ] = m;

  const s0 = m00 * m11 - m01 * m10;
  const s1 = m00 * m12 - m02 * m10;
  const s2 = m00 * m13 - m03 * m10;
  const s3 = m01 * m12 - m02 * m11;
  const s4 = m01 * m13 - m03 * m11;
  const s5 = m02 * m13 - m03 * m12;

  const c5 = m22 * m33 - m23 * m32;
  const c4 = m21 * m33 - m23 * m31;
  const c3 = m21 * m32 - m22 * m31;
  const c2 = m20 * m33 - m23 * m30;
  const c1 = m20 * m32 - m22 * m30;
  const c0 = m20 * m31 - m21 * m30;

  const det = s0 * c5 - s1 * c4 + s2 * c3 + s3 * c2 - s4 * c1 + s5 * c0;
  if (det === 0 || !Number.isFinite(det)) {
    throw new Error('matrix.invert: matrix is singular');
  }
  const d = 1 / det;

  return [
    (m11 * c5 - m12 * c4 + m13 * c3) * d,
    (-m10 * c5 + m12 * c2 - m13 * c1) * d,
    (m10 * c4 - m11 * c2 + m13 * c0) * d,
    (-m10 * c3 + m11 * c1 - m12 * c0) * d,

    (-m01 * c5 + m02 * c4 - m03 * c3) * d,
    (m00 * c5 - m02 * c2 + m03 * c1) * d,
    (-m00 * c4 + m01 * c2 - m03 * c0) * d,
    (m00 * c3 - m01 * c1 + m02 * c0) * d,

    (m31 * s5 - m32 * s4 + m33 * s3) * d,
    (-m30 * s5 + m32 * s2 - m33 * s1) * d,
    (m30 * s4 - m31 * s2 + m33 * s0) * d,
    (-m30 * s3 + m31 * s1 - m32 * s0) * d,

    (-m21 * s5 + m22 * s4 - m23 * s3) * d,
    (m20 * s5 - m22 * s2 + m23 * s1) * d,
    (-m20 * s4 + m21 * s2 - m23 * s0) * d,
    (m20 * s3 - m21 * s1 + m22 * s0) * d,
  ];
};

/**
 * Build an affine transform from a column-major 3x3 basis and a translation.
 * This is the shape LDraw line type 1 carries, and the shape brick transforms take.
 */
export const compose = (basis: Mat3, translation: Vec3): Mat4 => [
  basis[0], basis[1], basis[2], 0,
  basis[3], basis[4], basis[5], 0,
  basis[6], basis[7], basis[8], 0,
  translation[0], translation[1], translation[2], 1,
];

export const decompose = (m: Mat4): { basis: Mat3; translation: Vec3 } => ({
  basis: [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]],
  translation: [m[12], m[13], m[14]],
});

export const translation = (m: Mat4): Vec3 => [m[12], m[13], m[14]];

/** Pure translation. */
export const fromTranslation = (t: Vec3): Mat4 => [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  t[0], t[1], t[2], 1,
];

/** Transform a point (w = 1), with perspective divide skipped: our matrices are affine. */
export const transformPoint = (m: Mat4, p: Vec3): Vec3 => [
  m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
  m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
  m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
];

/** Transform a direction: rotation and scale only, no translation. */
export const transformDirection = (m: Mat4, v: Vec3): Vec3 => [
  m[0] * v[0] + m[4] * v[1] + m[8] * v[2],
  m[1] * v[0] + m[5] * v[1] + m[9] * v[2],
  m[2] * v[0] + m[6] * v[1] + m[10] * v[2],
];

export const equals = (a: Mat4, b: Mat4, epsilon = 0): boolean => {
  if (a.length !== 16 || b.length !== 16) return false;
  for (let i = 0; i < 16; i++) {
    if (Math.abs(a[i] - b[i]) > epsilon) return false;
  }
  return true;
};
