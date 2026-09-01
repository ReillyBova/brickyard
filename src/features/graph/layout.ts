/**
 * The exploded-view layout: where every brick goes when the graph blooms apart.
 *
 * A classic assembly exploded view, not a force-directed graph layout — per the task,
 * one 3D exploded view, not an alternate layout. Every brick moves radially outward
 * from the model's centroid, scaled by how far it already sits from that centroid, so
 * a tall stack fans out top-to-bottom and a flat baseplate fans out edge-to-edge. `hop`
 * (BFS distance from the component's most-central brick) drives animation stagger only
 * — it never touches position — so the bloom visibly propagates outward through the
 * graph, wave by wave, rather than jumping all at once.
 *
 * Pure: no three.js imports, no DOM. Feature-owned, not a frozen contract.
 */
import type { BrickId, Vec3 } from '../../types';
import type { SceneDocument } from '../../model/types';
import { positionOf } from '../../math';

export interface BrickLayout {
  /** World position, LDU, as built. */
  origin: Vec3;
  /** World position, LDU, fully exploded. */
  target: Vec3;
  /** BFS distance from the nearest-to-centroid brick in this component. */
  hop: number;
}

export interface ExplodeLayoutOptions {
  /** Minimum outward travel, LDU, even for a brick sitting at the centroid. */
  baseDistance?: number;
  /** Multiplier applied to a brick's own distance from the centroid. */
  spreadFactor?: number;
}

/** Three stud pitches — enough that even a centred brick visibly separates. */
const DEFAULT_BASE_DISTANCE = 60;
const DEFAULT_SPREAD_FACTOR = 1.4;

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const length = (a: Vec3): number => Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);

export function computeExplodeLayout(
  doc: SceneDocument,
  options: ExplodeLayoutOptions = {},
): ReadonlyMap<BrickId, BrickLayout> {
  const baseDistance = options.baseDistance ?? DEFAULT_BASE_DISTANCE;
  const spreadFactor = options.spreadFactor ?? DEFAULT_SPREAD_FACTOR;

  const positions = new Map<BrickId, Vec3>();
  for (const [id, instance] of doc.bricks) positions.set(id, positionOf(instance.transform));

  const layout = new Map<BrickId, BrickLayout>();
  if (positions.size === 0) return layout;

  let sum: Vec3 = [0, 0, 0];
  for (const p of positions.values()) sum = add(sum, p);
  const centroid = scale(sum, 1 / positions.size);

  // +Y is down in LDraw; a brick that lands exactly on the centroid still needs a
  // direction to travel, so it explodes "up" rather than not moving at all.
  const fallbackDirection: Vec3 = [0, -1, 0];

  const visited = new Set<BrickId>();
  for (const id of positions.keys()) {
    if (visited.has(id)) continue;
    const component = doc.graph.component(id);

    let root = id;
    let bestDistance = Infinity;
    for (const member of component) {
      const p = positions.get(member);
      if (p === undefined) continue;
      const d = length(sub(p, centroid));
      if (d < bestDistance) {
        bestDistance = d;
        root = member;
      }
    }

    const hops = new Map<BrickId, number>([[root, 0]]);
    const queue: BrickId[] = [root];
    while (queue.length > 0) {
      const current = queue.shift() as BrickId;
      const hop = hops.get(current) ?? 0;
      for (const next of doc.graph.neighbors(current)) {
        if (!hops.has(next)) {
          hops.set(next, hop + 1);
          queue.push(next);
        }
      }
    }

    for (const member of component) {
      visited.add(member);
      const origin = positions.get(member);
      if (origin === undefined) continue;

      const offset = sub(origin, centroid);
      const distance = length(offset);
      const direction = distance > 1e-6 ? scale(offset, 1 / distance) : fallbackDirection;
      const magnitude = baseDistance + distance * spreadFactor;
      const target = add(origin, scale(direction, magnitude));

      layout.set(member, { origin, target, hop: hops.get(member) ?? 0 });
    }
  }

  return layout;
}
