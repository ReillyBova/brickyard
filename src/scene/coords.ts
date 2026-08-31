/**
 * The one coordinate flip in the whole application.
 *
 * LDraw is +Y down; three's camera and controls expect +Y up. We do not convert
 * anywhere in the model, LDU stays LDU everywhere — instead the scene root carries
 * `rotation.x = Math.PI`, so every mesh under it is placed correctly by feeding it raw
 * LDU transforms unmodified.
 *
 * Rotating 180° about X maps `(x, y, z) -> (x, -y, -z)`, which is its own inverse. That
 * single fact is all picking needs: a point or direction coming back from a three.js
 * raycast (which operates in the post-rotation "app space") is converted to LDU world
 * space by applying the same flip again.
 */

import type { Vec3 } from '../types';

/** Radians the scene root is rotated about X so LDraw's +Y-down renders right-side up. */
export const ROOT_ROTATION_X = Math.PI;

/** `(x, y, z) -> (x, -y, -z)`. Self-inverse: also used to go the other direction. */
export function flipYZ(x: number, y: number, z: number): Vec3 {
  return [x, -y, -z];
}
