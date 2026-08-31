/**
 * Document operations and their inverses.
 *
 * Every operation carries both sides of its change, so `invertOperation` never
 * consults document state. `applyOperation` returns a new `SceneDocument`, sharing
 * every entry it did not touch.
 *
 * Pure: no three.js imports, no DOM.
 */

import type { BrickId, GroupId, Mat4 } from '../types';
import { asGraph } from './document';
import { invert as invertMatrix, multiply } from '../math';
import type {
  ApplyOperation,
  BrickInstance,
  InvertOperation,
  Operation,
  SceneDocument,
} from './types';

const addBricks = (doc: SceneDocument, bricks: readonly BrickInstance[]): SceneDocument => {
  if (bricks.length === 0) return doc;
  const next = new Map(doc.bricks);
  for (const brick of bricks) {
    if (next.has(brick.id)) throw new Error(`applyOperation add: brick ${brick.id} already exists`);
    next.set(brick.id, brick);
  }
  const graph = asGraph(doc).addBricks(bricks.map((b) => ({ brick: b.id })));
  return { bricks: next, groups: doc.groups, graph };
};

const removeBricks = (doc: SceneDocument, bricks: readonly BrickInstance[]): SceneDocument => {
  if (bricks.length === 0) return doc;
  const next = new Map(doc.bricks);
  for (const brick of bricks) {
    if (!next.has(brick.id)) throw new Error(`applyOperation remove: unknown brick ${brick.id}`);
    next.delete(brick.id);
  }
  const graph = asGraph(doc).removeBricks(bricks.map((b) => b.id));
  return { bricks: next, groups: doc.groups, graph };
};

/** Rewrite a set of bricks in one map copy. The graph is untouched by all callers. */
const patchBricks = (
  doc: SceneDocument,
  ids: readonly BrickId[],
  patch: (brick: BrickInstance) => BrickInstance,
): SceneDocument => {
  if (ids.length === 0) return doc;
  const next = new Map(doc.bricks);
  for (const id of ids) {
    const brick = next.get(id);
    if (!brick) throw new Error(`applyOperation: unknown brick ${id}`);
    next.set(id, patch(brick));
  }
  return { bricks: next, groups: doc.groups, graph: doc.graph };
};

/** Rebuilt explicitly so that ungrouping leaves the key absent, not set to undefined. */
const withGroupId = (brick: BrickInstance, groupId: GroupId | undefined): BrickInstance => {
  const next: BrickInstance = {
    id: brick.id,
    partId: brick.partId,
    colorCode: brick.colorCode,
    transform: brick.transform,
  };
  if (groupId !== undefined) next.groupId = groupId;
  return next;
};

export const applyOperation: ApplyOperation = (doc, op) => {
  switch (op.type) {
    case 'add':
      return addBricks(doc, op.bricks);

    case 'remove':
      return removeBricks(doc, op.bricks);

    case 'transformMany': {
      const delta = op.delta;
      // World-space delta, applied on the left of each brick's world transform.
      return patchBricks(doc, op.ids, (b) => ({ ...b, transform: multiply(delta, b.transform) }));
    }

    case 'transform': {
      const byId = new Map<BrickId, Mat4>(op.changes.map((c) => [c.id, c.to]));
      return patchBricks(doc, [...byId.keys()], (b) => ({
        ...b,
        transform: byId.get(b.id) as Mat4,
      }));
    }

    case 'recolor': {
      const byId = new Map<BrickId, number>(op.changes.map((c) => [c.id, c.to]));
      return patchBricks(doc, [...byId.keys()], (b) => ({
        ...b,
        colorCode: byId.get(b.id) as number,
      }));
    }

    case 'reparent': {
      const byId = new Map<BrickId, GroupId | undefined>(op.changes.map((c) => [c.id, c.to]));
      return patchBricks(doc, [...byId.keys()], (b) => withGroupId(b, byId.get(b.id)));
    }

    case 'addGroup': {
      if (doc.groups.has(op.group.id)) {
        throw new Error(`applyOperation addGroup: group ${op.group.id} already exists`);
      }
      const groups = new Map(doc.groups);
      groups.set(op.group.id, op.group);
      return { bricks: doc.bricks, groups, graph: doc.graph };
    }

    case 'removeGroup': {
      if (!doc.groups.has(op.group.id)) {
        throw new Error(`applyOperation removeGroup: unknown group ${op.group.id}`);
      }
      const groups = new Map(doc.groups);
      groups.delete(op.group.id);
      return { bricks: doc.bricks, groups, graph: doc.graph };
    }

    case 'connect': {
      if (op.edges.length === 0) return doc;
      return { bricks: doc.bricks, groups: doc.groups, graph: asGraph(doc).addEdges(op.edges) };
    }

    case 'disconnect': {
      if (op.edges.length === 0) return doc;
      return { bricks: doc.bricks, groups: doc.groups, graph: asGraph(doc).removeEdges(op.edges) };
    }
  }
};

export const invertOperation: InvertOperation = (op) => {
  switch (op.type) {
    case 'add':
      return { type: 'remove', bricks: op.bricks };
    case 'remove':
      return { type: 'add', bricks: op.bricks };
    case 'transformMany':
      return { type: 'transformMany', ids: op.ids, delta: invertMatrix(op.delta) };
    case 'transform':
      return {
        type: 'transform',
        changes: op.changes.map((c) => ({ id: c.id, from: c.to, to: c.from })),
      };
    case 'recolor':
      return {
        type: 'recolor',
        changes: op.changes.map((c) => ({ id: c.id, from: c.to, to: c.from })),
      };
    case 'reparent':
      return {
        type: 'reparent',
        changes: op.changes.map((c) => ({ id: c.id, from: c.to, to: c.from })),
      };
    case 'addGroup':
      return { type: 'removeGroup', group: op.group };
    case 'removeGroup':
      return { type: 'addGroup', group: op.group };
    case 'connect':
      return { type: 'disconnect', edges: op.edges };
    case 'disconnect':
      return { type: 'connect', edges: op.edges };
  }
};

/** Apply a sequence of operations in order. */
export const applyOperations = (
  doc: SceneDocument,
  ops: readonly Operation[],
): SceneDocument => ops.reduce(applyOperation, doc);
