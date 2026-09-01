/**
 * The editor session: the document, its history, and the derived indexes, kept in step.
 *
 * Placement previously held its own `Map` of bricks, which meant the document, the
 * connection graph and the undo stack were all bypassed — and every feature that reads
 * them (undo, grouping, select-connected, restyle, save, graph inspection) had nothing
 * to read. This is the single writer: every mutation goes through a `Transaction`, and
 * the spatial index and renderer are projections kept in step with it.
 */

import { findMates } from '../../snap/mating';
import { HashSpatialIndex } from '../../snap/spatialIndex';
import type { MateGroup, PartDef } from '../../snap/types';
import {
  type History,
  canRedo,
  canUndo,
  commit,
  createHistory,
  emptyDocument,
  redo,
  redoLabel,
  undo,
  undoLabel,
} from '../../model';
import type {
  BrickInstance,
  ConnectionEdge,
  SceneDocument,
  Transaction,
} from '../../model/types';
import { edgeIdFor } from '../../model/ids';
import type { BrickId, Mat4 } from '../../types';

/** What the renderer must do to match a document change. */
export interface SceneSync {
  addBrick(brick: BrickInstance): Promise<void> | void;
  removeBrick(id: BrickId): void;
  setBrickTransform(id: BrickId, transform: Mat4): void;
}

export interface EditorListener {
  (session: EditorSession): void;
}

/**
 * Mates come back grouped by neighbour with `aPoint` on the moving part. Edges want the
 * pair named, so the moving brick's id is threaded in here rather than inside `snap/`,
 * which has no notion of which brick is being placed.
 */
function edgesFor(moving: BrickId, groups: readonly MateGroup[]): ConnectionEdge[] {
  return groups.map((g) => ({
    id: edgeIdFor(moving, g.brick),
    a: moving,
    b: g.brick,
    mates: g.mates,
  }));
}

export class EditorSession {
  private history: History;
  private readonly parts = new Map<string, PartDef>();
  private readonly listeners = new Set<EditorListener>();

  readonly index = new HashSpatialIndex();
  private readonly scene: SceneSync;

  constructor(scene: SceneSync) {
    this.scene = scene;
    this.history = createHistory(emptyDocument());
  }

  get document(): SceneDocument {
    return this.history.doc;
  }

  get canUndo(): boolean {
    return canUndo(this.history);
  }

  get canRedo(): boolean {
    return canRedo(this.history);
  }

  /** Labels drive the undo affordance, so they read as user actions, not operations. */
  get undoLabel(): string | undefined {
    return undoLabel(this.history);
  }

  get redoLabel(): string | undefined {
    return redoLabel(this.history);
  }

  /** Part definitions are session-scoped; the document stores only part ids. */
  registerPart(part: PartDef): void {
    this.parts.set(part.id, part);
  }

  partFor(partId: string): PartDef | undefined {
    return this.parts.get(partId);
  }

  lookup = (id: BrickId): { part: PartDef; transform: Mat4 } | null => {
    const brick = this.document.bricks.get(id);
    if (!brick) return null;
    const part = this.parts.get(brick.partId);
    return part ? { part, transform: brick.transform } : null;
  };

  subscribe(listener: EditorListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const l of this.listeners) l(this);
  }

  /**
   * Place a brick. Geometry and connectivity land in one transaction so undo restores
   * both — a `remove` alone would put the brick back with no edges.
   */
  place(brick: BrickInstance, part: PartDef): void {
    const groups = findMates(part, brick.transform, this.index);
    const tx: Transaction = {
      label: `Place ${part.title}`,
      ops: [
        { type: 'add', bricks: [brick] },
        { type: 'connect', edges: edgesFor(brick.id, groups) },
      ],
    };
    this.history = commit(this.history, tx);
    this.index.insert(brick.id, part, brick.transform);
    void this.scene.addBrick(brick);
    this.notify();
  }

  /** Remove bricks, dropping the edges that held them first so undo can restore both. */
  remove(ids: readonly BrickId[]): void {
    const bricks = ids.map((id) => this.document.bricks.get(id)).filter((b): b is BrickInstance => !!b);
    if (bricks.length === 0) return;

    const edges = new Map<string, ConnectionEdge>();
    for (const id of ids) {
      for (const edgeId of this.document.graph.nodes.get(id)?.out ?? []) {
        const e = this.document.graph.edges.get(edgeId);
        if (e) edges.set(e.id, e);
      }
      for (const edgeId of this.document.graph.nodes.get(id)?.in ?? []) {
        const e = this.document.graph.edges.get(edgeId);
        if (e) edges.set(e.id, e);
      }
      for (const edgeId of this.document.graph.nodes.get(id)?.peer ?? []) {
        const e = this.document.graph.edges.get(edgeId);
        if (e) edges.set(e.id, e);
      }
    }

    this.history = commit(this.history, {
      label: bricks.length === 1 ? 'Delete brick' : `Delete ${bricks.length} bricks`,
      ops: [
        { type: 'disconnect', edges: [...edges.values()] },
        { type: 'remove', bricks },
      ],
    });
    for (const b of bricks) {
      this.index.remove(b.id);
      this.scene.removeBrick(b.id);
    }
    this.notify();
  }

  undo(): void {
    if (!this.canUndo) return;
    const before = this.document;
    this.history = undo(this.history);
    this.reconcile(before);
  }

  redo(): void {
    if (!this.canRedo) return;
    const before = this.document;
    this.history = redo(this.history);
    this.reconcile(before);
  }

  /**
   * Bring the index and the renderer back in line after a history move.
   *
   * Undo replaces the document wholesale rather than replaying inverse operations
   * against the projections, so the projections are diffed against it instead. Diffing
   * is what keeps this correct no matter how many operations a transaction carried.
   */
  private reconcile(before: SceneDocument): void {
    const after = this.document;

    for (const [id] of before.bricks) {
      if (!after.bricks.has(id)) {
        this.index.remove(id);
        this.scene.removeBrick(id);
      }
    }
    for (const [id, brick] of after.bricks) {
      const part = this.parts.get(brick.partId);
      if (!part) continue;
      const prior = before.bricks.get(id);
      if (!prior) {
        this.index.insert(id, part, brick.transform);
        void this.scene.addBrick(brick);
      } else if (prior.transform !== brick.transform) {
        this.index.insert(id, part, brick.transform);
        this.scene.setBrickTransform(id, brick.transform);
      }
    }
    this.notify();
  }
}
