/**
 * Matrix and vector maths. Contract file — see docs/ARCHITECTURE.md.
 *
 * A thin adapter over gl-matrix, which is column-major like `three.js
 * Matrix4.elements`, so transforms cross into `scene/` without repacking. We keep
 * plain `number[]` rather than gl-matrix's default `Float32Array`: transform chains
 * accumulate down deep subfile trees, and float64 avoids the drift that float32
 * would introduce.
 *
 * gl-matrix writes into a caller-supplied output array, so nothing here mutates its
 * inputs. Every function returns a fresh matrix.
 *
 * This lives at the source root rather than inside `snap/` or `model/` because both
 * need it and neither may depend on the other.
 */

import { mat4 as glMat4, vec3 as glVec3 } from 'gl-matrix';

import type { Mat3, Mat4, Vec3 } from './types';

/**
 * gl-matrix types its inputs as mutable indexed collections; ours are readonly.
 * The cast is confined to this file and is safe because gl-matrix only ever reads
 * from its input parameters.
 */
type GlIn = Parameters<typeof glMat4.multiply>[1];
const input = (m: Mat3 | Mat4 | Vec3): GlIn => m as unknown as GlIn;
const out4 = (): number[] => new Array<number>(16);
const out3 = (): number[] => new Array<number>(3);

export const IDENTITY: Mat4 = Object.freeze([
  1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
]);

/** `a · b`, with `b` applied first — the same convention as `Matrix4.multiplyMatrices`. */
export function multiply(a: Mat4, b: Mat4): Mat4 {
  return glMat4.multiply(out4(), input(a), input(b)) as number[];
}

/** Left-to-right composition, so `multiplyAll(parent, child, grandchild)`. */
export function multiplyAll(...ms: readonly Mat4[]): Mat4 {
  return ms.reduce<Mat4>((acc, m) => multiply(acc, m), IDENTITY);
}

/** Throws rather than returning a sentinel: a singular transform is a bug, not a value. */
export function invert(m: Mat4): Mat4 {
  const result = glMat4.invert(out4(), input(m));
  if (result === null) throw new Error('math: matrix is not invertible');
  return result as number[];
}

export function determinant(m: Mat4): number {
  return glMat4.determinant(input(m));
}

/**
 * Build a transform from a column-major basis and a position — the shape an LDraw
 * type-1 reference resolves to once its row-major triple has been transposed.
 */
export function fromBasis(basis: Mat3, position: Vec3): Mat4 {
  const [b0, b1, b2, b3, b4, b5, b6, b7, b8] = basis;
  const [x, y, z] = position;
  return [b0, b1, b2, 0, b3, b4, b5, 0, b6, b7, b8, 0, x, y, z, 1];
}

export function fromTranslation(position: Vec3): Mat4 {
  return glMat4.fromTranslation(out4(), input(position)) as number[];
}

export function basisOf(m: Mat4): Mat3 {
  return [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]];
}

export function positionOf(m: Mat4): Vec3 {
  return [m[12], m[13], m[14]];
}

/** Applies rotation and translation. */
export function transformPoint(m: Mat4, p: Vec3): Vec3 {
  return glVec3.transformMat4(out3(), input(p), input(m)) as unknown as Vec3;
}

/** Applies rotation only, leaving translation out, and renormalises. */
export function transformDirection(m: Mat4, d: Vec3): Vec3 {
  const [x, y, z] = d;
  const v: number[] = [
    m[0] * x + m[4] * y + m[8] * z,
    m[1] * x + m[5] * y + m[9] * z,
    m[2] * x + m[6] * y + m[10] * z,
  ];
  return glVec3.normalize(out3(), input(v as unknown as Vec3)) as unknown as Vec3;
}

/**
 * A connection point's axis is its local +Y, which is the second basis column.
 * See CLAUDE.md — LDraw's +Y points down.
 */
export function axisOf(m: Mat4): Vec3 {
  return transformDirection(m, [0, 1, 0]);
}

export function equals(a: Mat4, b: Mat4, epsilon = 1e-6): boolean {
  return a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= epsilon);
}

export function vecEquals(a: Vec3, b: Vec3, epsilon = 1e-6): boolean {
  return a.every((v, i) => Math.abs(v - b[i]) <= epsilon);
}
