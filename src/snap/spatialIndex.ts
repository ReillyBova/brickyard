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

  insert(brick: BrickId, part: PartDef, transform: Mat4): void {
    this.remove(brick);

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
    this.boundsOf.set(brick, worldBounds(part.bounds, transform));
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
    this.byBrick.delete(brick);
    this.boundsOf.delete(brick);
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

  nearBricks(bounds: Bounds): readonly BrickId[] {
    const hits: BrickId[] = [];
    for (const [brick, b] of this.boundsOf) {
      if (overlaps(b, bounds)) hits.push(brick);
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
