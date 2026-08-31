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
 * A connection point as the index holds it: already in world space, and carrying its
 * compatibility key, so a caller can test a match without a second lookup into the
 * part definitions.
 */
export interface IndexedPoint extends PointRef {
  /** World-space position, LDU. */
  position: Vec3;
  /** World-space connector axis, the point's local +Y transformed. */
  axis: Vec3;
  /** Copied from the ConnectionPoint. */
  key: number;
  kind: SnapKind;
  gender: Gender;
  /** SNAP_GEN matching group, when the kind is 'general'. */
  group?: string;
}

/**
 * Uniform spatial hash over world-space connection points, cell size 20 LDU.
 * Supports O(1) insert and remove: bricks appear and disappear constantly.
 */
export interface SpatialIndex {
  insert(brick: BrickId, part: PartDef, transform: Mat4): void;
  remove(brick: BrickId): void;
  near(point: Vec3, radius: number): readonly IndexedPoint[];
  nearBricks(bounds: Bounds): readonly BrickId[];
  /** Every brick currently indexed, for whole-scene solves. */
  bricks(): readonly BrickId[];
  /**
   * The part and placement behind an indexed brick. Narrow-phase collision needs the
   * part itself, not just its points, and without this on the interface a consumer
   * typed against `SpatialIndex` silently degrades to broad phase only.
   */
  partAt(brick: BrickId): { part: PartDef; transform: Mat4 } | undefined;
}

/**
 * Mates found against one already-placed brick. `aPoint` is on the moving part and
 * `bPoint` on `brick`, so the orientation is explicit rather than positional.
 */
export interface MateGroup {
  brick: BrickId;
  mates: readonly Mate[];
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
/**
 * Every point pair that coincides once `transform` is applied — a 2x4 laid squarely on
 * another 2x4 mates eight studs, not one. Runs *after* a placement is chosen, to
 * discover what else engaged; it does not select the placement.
 */
export type FindMates = (
  movingPart: PartDef,
  transform: Mat4,
  index: SpatialIndex,
  /** Bricks to ignore, normally the moving brick itself when it is already indexed. */
  exclude?: ReadonlySet<BrickId>,
) => readonly MateGroup[];

export type Collides = (
  part: PartDef,
  transform: Mat4,
  index: SpatialIndex,
  ignore?: ReadonlySet<BrickId>,
) => boolean;

/**
 * Resolving needs to read the parts and transforms of bricks already placed, which the
 * index deliberately does not carry — it holds points, not parts. The caller supplies
 * that lookup.
 */
export type BrickLookup = (id: BrickId) => { part: PartDef; transform: Mat4 } | null;

export type ResolveSnap = (
  query: SnapQuery,
  index: SpatialIndex,
  lookup: BrickLookup,
) => SnapCandidate[];
