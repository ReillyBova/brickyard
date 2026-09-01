/**
 * Scene document construction and accessors.
 *
 * The document is the only writable state; the graph is materialised inside it and
 * maintained incrementally by `applyOperation`. Documents are treated as immutable:
 * every mutator returns a new `SceneDocument` sharing the unchanged entries.
 *
 * Pure: no three.js imports, no DOM.
 */

import type { BrickId, GroupId } from '../types.ts';
import type { MateLink } from './graph.ts';
import { Graph, buildGraph, emptyGraph } from './graph.ts';
import type { BrickInstance, ConnectionEdge, GroupDef, SceneDocument } from './types.ts';

export const emptyDocument = (): SceneDocument => ({
  bricks: new Map(),
  groups: new Map(),
  graph: emptyGraph(),
});

/**
 * Build a document from bricks, optional groups, and an optional solved edge list —
 * the shape a model import produces.
 */
export const createDocument = (
  bricks: readonly BrickInstance[] = [],
  groups: readonly GroupDef[] = [],
  edges: readonly ConnectionEdge[] = [],
): SceneDocument => {
  const brickMap = new Map<BrickId, BrickInstance>();
  for (const brick of bricks) {
    if (brickMap.has(brick.id)) throw new Error(`createDocument: duplicate brick id ${brick.id}`);
    brickMap.set(brick.id, brick);
  }
  const groupMap = new Map<GroupId, GroupDef>();
  for (const group of groups) {
    if (groupMap.has(group.id)) throw new Error(`createDocument: duplicate group id ${group.id}`);
    groupMap.set(group.id, group);
  }
  return { bricks: brickMap, groups: groupMap, graph: buildGraph([...brickMap.keys()], edges) };
};

export const getBrick = (doc: SceneDocument, id: BrickId): BrickInstance | undefined =>
  doc.bricks.get(id);

/** Throwing accessor, for call sites where absence is a programming error. */
export const requireBrick = (doc: SceneDocument, id: BrickId): BrickInstance => {
  const brick = doc.bricks.get(id);
  if (!brick) throw new Error(`document: unknown brick ${id}`);
  return brick;
};

export const getGroup = (doc: SceneDocument, id: GroupId): GroupDef | undefined =>
  doc.groups.get(id);

export const brickCount = (doc: SceneDocument): number => doc.bricks.size;

export const allBricks = (doc: SceneDocument): readonly BrickInstance[] => [...doc.bricks.values()];

/** Direct members of a group; nested groups are not flattened. */
export const bricksInGroup = (doc: SceneDocument, id: GroupId): readonly BrickInstance[] =>
  [...doc.bricks.values()].filter((b) => b.groupId === id);

/** A group and every group beneath it. */
export const groupDescendants = (doc: SceneDocument, id: GroupId): ReadonlySet<GroupId> => {
  const result = new Set<GroupId>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const group of doc.groups.values()) {
      if (group.parentId !== undefined && result.has(group.parentId) && !result.has(group.id)) {
        result.add(group.id);
        grew = true;
      }
    }
  }
  return result;
};

/** Every brick in a group or any group beneath it. */
export const bricksInGroupTree = (doc: SceneDocument, id: GroupId): readonly BrickInstance[] => {
  const ids = groupDescendants(doc, id);
  return [...doc.bricks.values()].filter((b) => b.groupId !== undefined && ids.has(b.groupId));
};

/** The set of bricks structurally joined to `id`, `id` included. */
export const assemblyOf = (doc: SceneDocument, id: BrickId): ReadonlySet<BrickId> =>
  doc.graph.component(id);

const asGraph = (doc: SceneDocument): Graph => {
  if (doc.graph instanceof Graph) return doc.graph;
  return new Graph(doc.graph.nodes, doc.graph.edges);
};

/**
 * Attach precomputed mates to the document's graph, merging them into any edge the
 * pair already has.
 *
 * This is a convenience for building a document up front — an import, a fixture, a
 * test. Edits that a user can undo go through the `connect` and `disconnect`
 * operations instead, so that the change is recorded on the transaction stack.
 */
export const connectBricks = (doc: SceneDocument, links: readonly MateLink[]): SceneDocument => {
  if (links.length === 0) return doc;
  for (const l of links) {
    for (const brick of [l.a, l.b]) {
      if (!doc.bricks.has(brick)) throw new Error(`connectBricks: unknown brick ${brick}`);
    }
  }
  return { bricks: doc.bricks, groups: doc.groups, graph: asGraph(doc).connect(links) };
};

/** Drop the edge between each pair, leaving both bricks in place. Lenient if absent. */
export const disconnectBricks = (
  doc: SceneDocument,
  pairs: readonly { a: BrickId; b: BrickId }[],
): SceneDocument => {
  if (pairs.length === 0) return doc;
  return { bricks: doc.bricks, groups: doc.groups, graph: asGraph(doc).disconnect(pairs) };
};

export { asGraph };
