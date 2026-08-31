/**
 * Scene document, connection graph, and operations. Contract file — see docs/ARCHITECTURE.md.
 *
 * Pure: no three.js imports, no DOM.
 */

import type { BrickId, EdgeId, GroupId, Mat4 } from '../types';
import type { Mate } from '../snap/types';

export interface BrickInstance {
  id: BrickId;
  partId: string;
  /** LDraw color code, per LDConfig. */
  colorCode: number;
  /** World transform, LDU. Flat and absolute: groups are not transform parents. */
  transform: Mat4;
  groupId?: GroupId;
}

export interface GroupDef {
  id: GroupId;
  name: string;
  parentId?: GroupId;
}

/** One edge per brick pair, carrying every point pair that joins them. */
export interface ConnectionEdge {
  /**
   * Derived deterministically from the unordered brick pair, so the same pair always
   * yields the same id and add/remove/add is idempotent. Not an arbitrary identifier.
   */
  id: EdgeId;
  a: BrickId;
  b: BrickId;
  mates: readonly Mate[];
}

export interface GraphNode {
  brick: BrickId;
  /** Edges where this brick carries the male half — what it supports. */
  out: readonly EdgeId[];
  /** Edges where it carries the female half — what supports it. */
  in: readonly EdgeId[];
  /** Symmetric and ungendered connections. */
  peer: readonly EdgeId[];
}

export interface ConnectionGraph {
  nodes: ReadonlyMap<BrickId, GraphNode>;
  edges: ReadonlyMap<EdgeId, ConnectionEdge>;
  neighbors(id: BrickId): readonly BrickId[];
  component(id: BrickId): ReadonlySet<BrickId>;
}

export interface SceneDocument {
  bricks: ReadonlyMap<BrickId, BrickInstance>;
  groups: ReadonlyMap<GroupId, GroupDef>;
  /** Materialised, and maintained incrementally by applyOperation. */
  graph: ConnectionGraph;
}

/**
 * Every mutation carries both sides of the change, so inversion never consults
 * document state.
 */
export type Operation =
  | { type: 'add'; bricks: readonly BrickInstance[] }
  | { type: 'remove'; bricks: readonly BrickInstance[] }
  /** One delta applied to many bricks — multi-select drags and group moves alike. */
  | { type: 'transformMany'; ids: readonly BrickId[]; delta: Mat4 }
  /** Per-brick absolute transforms, for changes that are not a single rigid delta. */
  | { type: 'transform'; changes: readonly { id: BrickId; from: Mat4; to: Mat4 }[] }
  | { type: 'recolor'; changes: readonly { id: BrickId; from: number; to: number }[] }
  | { type: 'reparent'; changes: readonly { id: BrickId; from?: GroupId; to?: GroupId }[] }
  | { type: 'addGroup'; group: GroupDef }
  | { type: 'removeGroup'; group: GroupDef }
  /**
   * Connectivity changes are first-class, because every geometry change alters it:
   * removing a brick drops edges, and moving one breaks and forms them. A gesture
   * pairs these with its geometry operations inside a single Transaction, which is
   * what lets undo restore connectivity exactly rather than re-deriving it.
   */
  | { type: 'connect'; edges: readonly ConnectionEdge[] }
  | { type: 'disconnect'; edges: readonly ConnectionEdge[] };

/** A single user-visible undo step; one gesture may produce several operations. */
export interface Transaction {
  /** Semantic intent, e.g. 'Rotate assembly', not 'Transform 412 bricks'. */
  label: string;
  ops: readonly Operation[];
}

export type ApplyOperation = (doc: SceneDocument, op: Operation) => SceneDocument;
export type InvertOperation = (op: Operation) => Operation;
