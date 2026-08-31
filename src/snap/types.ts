/**
 * Connection geometry and snapping. Contract file — see docs/ARCHITECTURE.md.
 *
 * Pure: no three.js imports, no DOM. This module must stay safe to run in a worker.
 */

import type { Bounds, BrickId, Mat3, Mat4, Vec3 } from '../types';

export type SnapKind = 'cyl' | 'clip' | 'finger' | 'general';
export type Gender = 'M' | 'F';

/** Round, Square, or Axle cross-section. */
export type SectionVariant = 'R' | 'S' | 'A';

export interface Section {
  variant: SectionVariant;
  radius: number; // LDU
  length: number; // LDU
}

export interface ConnectionPoint {
  /** Stable within a part, derived from provenance + ordinal. */
  id: string;
  kind: SnapKind;
  gender: Gender;
  /** Profile along the axis. Length > 1 for stepped holes, e.g. Technic pin holes. */
  sections: Section[];
  position: Vec3;
  /** Part-local basis. The connector axis is local +Y. */
  orientation: Mat3;
  /** Connection permits sliding along its axis, e.g. Technic pins and bars. */
  slide: boolean;
  /** SNAP_GEN matching group; only meaningful when kind === 'general'. */
  group?: string;
  /**
   * Precomputed compatibility key: kind, gender, variant and bucketed radius packed
   * into one integer, so compatibility is a table lookup rather than a comparison chain.
   */
  key: number;
  /** Source file, for debugging: 'p/stud.dat', 'parts/s/3001s01.dat'. */
  source: string;
}

/** Coarse occupancy mask used for collision, 4 LDU cells, part-local. */
export interface OccupancyMask {
  dims: readonly [number, number, number];
  bits: Uint8Array;
}

export interface PartDef {
  id: string; // '3001'
  title: string; // 'Brick  2 x  4'
  connections: readonly ConnectionPoint[];
  bounds: Bounds;
  occupancy: OccupancyMask;
  category?: string;
}

/** A single coincident pair of connection points joining two bricks. */
export interface Mate {
  aPoint: string;
  bPoint: string;
  kind: SnapKind;
  /** Which side carries the male half. Hinge fingers are genuinely symmetric. */
  polarity: 'a' | 'b' | 'symmetric';
}

export interface PointRef {
  brick: BrickId;
  point: string;
}

/** What the cursor is over, produced by the scene raycast against rendered meshes. */
export interface RaycastHit {
  brick: BrickId;
  /** World-space intersection, LDU. */
  point: Vec3;
  /** Surface normal at the intersection, which face of the brick was hit. */
  normal: Vec3;
}

export interface SnapCandidate {
  /** The primary pair: the connection the user is expressing through the cursor. */
  movingPoint: string;
  target: PointRef;
  transform: Mat4;
  /**
   * Everything else that coincides once `transform` is applied, discovered *after*
   * the placement is chosen rather than used to choose it. Consequence, not intent.
   */
  mates: readonly Mate[];
  score: number;
}

export interface SnapQuery {
  part: PartDef;
  /** World space, LDU. */
  rayOrigin: Vec3;
  rayDirection: Vec3;
  /**
   * What the cursor is over. Present means cursor-driven placement: the hit brick,
   * point and normal narrow the candidates to a handful. Absent means the cursor is
   * over empty space or the baseplate, and placement falls back to a ground-plane
   * intersection.
   */
  hit?: RaycastHit;
  /**
   * Where the ghost currently sits. Which of the moving part's points mates to the
   * target is genuinely ambiguous — stud 1 and stud 8 of a 2x4 differ by 60 LDU on
   * the same target — and continuity is what resolves it, so the piece stays near
   * where it already is instead of jumping.
   */
  previous?: Mat4;
  /** Quarter turns about the connection axis. */
  roll: number;
}

/**
 * Uniform spatial hash over world-space connection points, cell size 20 LDU.
 * Supports O(1) insert and remove: bricks appear and disappear constantly.
 */
export interface SpatialIndex {
  insert(brick: BrickId, part: PartDef, transform: Mat4): void;
  remove(brick: BrickId): void;
  near(point: Vec3, radius: number): readonly PointRef[];
  nearBricks(bounds: Bounds): readonly BrickId[];
}

/** Table lookup on precomputed keys. */
export type IsCompatible = (a: ConnectionPoint, b: ConnectionPoint) => boolean;

/**
 * World transform placing `movingPart` so its `movingPoint` mates `targetPoint`.
 * `roll` rotates about the shared axis, in quarter turns.
 */
export type SolveMating = (
  movingPart: PartDef,
  movingPoint: ConnectionPoint,
  targetPoint: ConnectionPoint,
  targetWorld: Mat4,
  roll: number,
) => Mat4;

/**
 * Every point pair that coincides once `transform` is applied. A 2×4 laid squarely
 * on another 2×4 mates eight studs, not one.
 */
export type FindMates = (
  movingPart: PartDef,
  transform: Mat4,
  index: SpatialIndex,
) => readonly Mate[];

export type Collides = (
  part: PartDef,
  transform: Mat4,
  index: SpatialIndex,
  ignore?: ReadonlySet<BrickId>,
) => boolean;

export type ResolveSnap = (query: SnapQuery, index: SpatialIndex) => SnapCandidate[];
