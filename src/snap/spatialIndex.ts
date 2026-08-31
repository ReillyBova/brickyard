/**
 * Uniform spatial hash over world-space connection points.
 *
 * Bricks appear and disappear constantly — every placement, deletion, drag frame and
 * undo — so this is a hash grid with O(1) insert and remove rather than a tree that
 * would need rebuilding.
 */

import { transformDirection, transformPoint } from '../math';
import type { BrickId, Bounds, Mat4, Vec3 } from '../types';
import { pointMatrix } from './mating';
import { multiply } from '../math';
import type { IndexedPoint, PartDef, SpatialIndex } from './types';

/** One stud pitch. A query radius well under this touches a handful of cells. */
export const CELL_SIZE = 20;

const cellKey = (x: number, y: number, z: number): string => `${x},${y},${z}`;
const cellOf = (v: number): number => Math.floor(v / CELL_SIZE);

interface Entry {
  point: IndexedPoint;
  cell: string;
}

export class HashSpatialIndex implements SpatialIndex {
  private readonly cells = new Map<string, IndexedPoint[]>();
  private readonly byBrick = new Map<BrickId, Entry[]>();
  private readonly boundsOf = new Map<BrickId, Bounds>();
  /**
   * The same 20 LDU grid `cells` uses for connection points, additionally indexing
   * whole bricks by every cell their world bounds overlap — not just one cell, since a
   * brick is rarely a single point. A 2×4 is 80 LDU across, four cells wide; a plate
   * spanning many studs wider than that spans proportionally more. Registration cost on
   * insert is the number of cells covered, which is fine for ordinary bricks but would
   * be worth reconsidering before indexing something baseplate-sized this way.
   */
  private readonly brickCells = new Map<string, Set<BrickId>>();
  /** Which cell keys `brickCells` currently holds each brick under, for O(cells) removal. */
  private readonly brickCellKeysOf = new Map<BrickId, readonly string[]>();
  /**
   * `part` and `transform` per indexed brick, additive to the `SpatialIndex` contract.
   * Collision's narrow phase (`src/snap/collision.ts`) needs the placed part and its
   * world transform to test occupancy masks against — `nearBricks` only returns ids —
   * so this is exposed via `partAt`, a method outside the frozen interface. See
   * `collision.ts` for the full reasoning.
   */
  private readonly partsOf = new Map<BrickId, { part: PartDef; transform: Mat4 }>();

  insert(brick: BrickId, part: PartDef, transform: Mat4): void {
    this.remove(brick);
    this.partsOf.set(brick, { part, transform });

    const entries: Entry[] = [];
    for (const p of part.connections) {
      const m = multiply(transform, pointMatrix(p));
      const position = transformPoint(m, [0, 0, 0]);
      const axis = transformDirection(m, [0, 1, 0]);
      const indexed: IndexedPoint = {
        brick,
        point: p.id,
        position,
        axis,
        key: p.key,
        kind: p.kind,
        gender: p.gender,
        ...(p.group === undefined ? {} : { group: p.group }),
      };
      const cell = cellKey(cellOf(position[0]), cellOf(position[1]), cellOf(position[2]));
      const bucket = this.cells.get(cell);
      if (bucket) bucket.push(indexed);
      else this.cells.set(cell, [indexed]);
      entries.push({ point: indexed, cell });
    }
    this.byBrick.set(brick, entries);

    const bounds = worldBounds(part.bounds, transform);
    this.boundsOf.set(brick, bounds);
    this.brickCellKeysOf.set(brick, this.registerBrickCells(brick, bounds));
  }

  /** Registers `brick` in every grid cell its world `bounds` overlaps; returns their keys. */
  private registerBrickCells(brick: BrickId, bounds: Bounds): readonly string[] {
    const lo = [cellOf(bounds.min[0]), cellOf(bounds.min[1]), cellOf(bounds.min[2])];
    const hi = [cellOf(bounds.max[0]), cellOf(bounds.max[1]), cellOf(bounds.max[2])];
    const keys: string[] = [];
    for (let x = lo[0]; x <= hi[0]; x++) {
      for (let y = lo[1]; y <= hi[1]; y++) {
        for (let z = lo[2]; z <= hi[2]; z++) {
          const key = cellKey(x, y, z);
          let set = this.brickCells.get(key);
          if (!set) {
            set = new Set();
            this.brickCells.set(key, set);
          }
          set.add(brick);
          keys.push(key);
        }
      }
    }
    return keys;
  }

  remove(brick: BrickId): void {
    const entries = this.byBrick.get(brick);
    if (!entries) return;
    for (const { cell, point } of entries) {
      const bucket = this.cells.get(cell);
      if (!bucket) continue;
      const i = bucket.indexOf(point);
      if (i >= 0) bucket.splice(i, 1);
      if (bucket.length === 0) this.cells.delete(cell);
    }
    const brickCellKeys = this.brickCellKeysOf.get(brick);
    if (brickCellKeys) {
      for (const key of brickCellKeys) {
        const set = this.brickCells.get(key);
        if (!set) continue;
        set.delete(brick);
        if (set.size === 0) this.brickCells.delete(key);
      }
      this.brickCellKeysOf.delete(brick);
    }
    this.byBrick.delete(brick);
    this.boundsOf.delete(brick);
    this.partsOf.delete(brick);
  }

  /** The part and world transform last inserted for `brick`, for narrow-phase collision. */
  partAt(brick: BrickId): { part: PartDef; transform: Mat4 } | undefined {
    return this.partsOf.get(brick);
  }

  near(point: Vec3, radius: number): readonly IndexedPoint[] {
    const found: IndexedPoint[] = [];
    const r2 = radius * radius;
    // A query near a cell boundary must look at the neighbours it spills into.
    const lo = point.map((v) => cellOf(v - radius)) as unknown as Vec3;
    const hi = point.map((v) => cellOf(v + radius)) as unknown as Vec3;
    for (let x = lo[0]; x <= hi[0]; x++) {
      for (let y = lo[1]; y <= hi[1]; y++) {
        for (let z = lo[2]; z <= hi[2]; z++) {
          const bucket = this.cells.get(cellKey(x, y, z));
          if (!bucket) continue;
          for (const p of bucket) {
            const d2 =
              (p.position[0] - point[0]) ** 2 +
              (p.position[1] - point[1]) ** 2 +
              (p.position[2] - point[2]) ** 2;
            if (d2 <= r2) found.push(p);
          }
        }
      }
    }
    return found;
  }

  /**
   * Broad phase for collision: candidate bricks whose world bounds might overlap
   * `bounds`. Gathers the union of bricks registered in every cell `bounds` itself
   * overlaps (a handful, from `brickCells`), then resolves that candidate set with an
   * exact AABB test — the grid narrows which bricks are even worth checking, it isn't
   * itself the precise answer, since two bricks can share a cell without their bounds
   * actually overlapping.
   */
  nearBricks(bounds: Bounds): readonly BrickId[] {
    const lo = [cellOf(bounds.min[0]), cellOf(bounds.min[1]), cellOf(bounds.min[2])];
    const hi = [cellOf(bounds.max[0]), cellOf(bounds.max[1]), cellOf(bounds.max[2])];
    const candidates = new Set<BrickId>();
    for (let x = lo[0]; x <= hi[0]; x++) {
      for (let y = lo[1]; y <= hi[1]; y++) {
        for (let z = lo[2]; z <= hi[2]; z++) {
          const set = this.brickCells.get(cellKey(x, y, z));
          if (!set) continue;
          for (const brick of set) candidates.add(brick);
        }
      }
    }
    const hits: BrickId[] = [];
    for (const brick of candidates) {
      const b = this.boundsOf.get(brick);
      if (b && overlaps(b, bounds)) hits.push(brick);
    }
    return hits;
  }

  bricks(): readonly BrickId[] {
    return [...this.byBrick.keys()];
  }

  /** Points currently indexed, for tests and diagnostics. */
  get size(): number {
    let n = 0;
    for (const bucket of this.cells.values()) n += bucket.length;
    return n;
  }
}

/** Axis-aligned bounds of a transformed box, from its eight transformed corners. */
export function worldBounds(local: Bounds, transform: Mat4): Bounds {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < 8; i++) {
    const corner: Vec3 = [
      i & 1 ? local.max[0] : local.min[0],
      i & 2 ? local.max[1] : local.min[1],
      i & 4 ? local.max[2] : local.min[2],
    ];
    const w = transformPoint(transform, corner);
    for (let a = 0; a < 3; a++) {
      if (w[a] < min[a]) min[a] = w[a];
      if (w[a] > max[a]) max[a] = w[a];
    }
  }
  return { min, max };
}

const overlaps = (a: Bounds, b: Bounds): boolean =>
  a.min[0] <= b.max[0] &&
  a.max[0] >= b.min[0] &&
  a.min[1] <= b.max[1] &&
  a.max[1] >= b.min[1] &&
  a.min[2] <= b.max[2] &&
  a.max[2] >= b.min[2];
