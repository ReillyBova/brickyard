/**
 * Shared primitives. Contract file — see docs/ARCHITECTURE.md.
 *
 * Units are LDU throughout and +Y points down. The only conversion to three.js
 * convention is a single rotation on the scene root.
 */

export type Vec3 = readonly [number, number, number];

/** Column-major, identical in layout to three.js `Matrix4.elements`. */
export type Mat4 = readonly number[];

/** Column-major 3×3 orientation basis. */
export type Mat3 = readonly number[];

export interface Bounds {
  min: Vec3;
  max: Vec3;
}

export type BrickId = string;
export type GroupId = string;
export type EdgeId = string;
