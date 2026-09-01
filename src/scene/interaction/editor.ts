/**
 * The editor session: the document, its history, and the derived indexes, kept in step.
 *
 * Placement previously held its own `Map` of bricks, which meant the document, the
 * connection graph and the undo stack were all bypassed — and every feature that reads
 * them (undo, grouping, select-connected, restyle, save, graph inspection) had nothing
 * to read. This is the single writer: every mutation goes through a `Transaction`, and
 * the spatial index and renderer are projections kept in step with it.
 *
 * `commit()` is the generic entry point — any caller that has legitimately built a
 * `Transaction` from `src/model/operations.ts` (grouping, restyle, reparenting, …)
 * applies it here rather than touching `History` itself, so there is exactly one place
 * that writes the document and exactly one place the index and renderer can drift from
 * it. `place()`, `remove()` and `transformSelection()` are convenience wrappers over the
 * same primitive for the gestures this slice owns.
 */

import { multiply } from '../../math';
import { findMates, mateCount } from '../../snap/mating';
import { HashSpatialIndex } from '../../snap/spatialIndex';
import type { MateGroup, PartDef } from '../../snap/types';
import {
  type History,
  canRedo,
  canUndo,
  commit as commitToHistory,
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
  /**
   * View state, per docs/ARCHITECTURE.md: selection lives outside the document and is
   * not undoable. It lives here rather than in a component so every slice that reads or
   * drives the canvas (toolbar, restyle, grouping) shares one answer to "what's
   * selected" instead of each inventing its own.
   */
  private selectedIds: ReadonlySet<BrickId> = new Set();

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

  get selection(): ReadonlySet<BrickId> {
    return this.selectedIds;
  }

  /** Replaces the selection wholesale; an empty iterable clears it. Not undoable. */
  setSelection(ids: Iterable<BrickId>): void {
    this.selectedIds = new Set(ids);
    this.notify();
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
   * Apply any transaction through the one writer. Every other mutator on this class —
   * `place`, `remove`, `transformSelection` — is a convenience that builds a
   * `Transaction` and calls this; a caller elsewhere (grouping, restyle, reparenting)
   * that has built its own `Transaction` from `src/model/operations.ts` uses this
   * directly instead of touching `History` itself, so the index, the renderer and the
   * undo stack can never drift from what actually happened.
   */
  commit(tx: Transaction): void {
    const before = this.document;
    this.history = commitToHistory(this.history, tx);
    this.reconcile(before);
  }

  /**
   * Replace the whole document — opening a model, or returning to an empty sandbox.
   * Fresh history: loading a model is a new starting point, not an edit to undo back
   * past. `parts` must cover every part id the document references, or `lookup` and
   * collision on those bricks silently no-op (see `docs/ARCHITECTURE.md`'s "fallback
   * behaviour" — a part with no data still loads and renders, it just can't snap or
   * collide, which is a property of the part, not of how it got here).
   */
  loadDocument(doc: SceneDocument, parts: Iterable<PartDef>): void {
    for (const part of parts) this.registerPart(part);
    const before = this.document;
    this.history = createHistory(doc);
    this.reconcile(before);
  }

  /**
   * Place a brick. Geometry and connectivity land in one transaction so undo restores
   * both — a `remove` alone would put the brick back with no edges. Returns the total
   * mate count, which is the only external use for a placement's engagement strength —
   * see `src/scene/interaction/click.ts`.
   */
  place(brick: BrickInstance, part: PartDef): number {
    const groups = findMates(part, brick.transform, this.index);
    this.commit({
      label: `Place ${part.title}`,
      ops: [
        { type: 'add', bricks: [brick] },
        { type: 'connect', edges: edgesFor(brick.id, groups) },
      ],
    });
    return mateCount(groups);
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

    this.commit({
      label: bricks.length === 1 ? 'Delete brick' : `Delete ${bricks.length} bricks`,
      ops: [
        { type: 'disconnect', edges: [...edges.values()] },
        { type: 'remove', bricks },
      ],
    });
  }

  /**
   * Nudge or rotate a set of already-placed bricks by one rigid world-space `delta`
   * (the same matrix applied to every brick — see `transformMany`). Edges to bricks
   * outside `ids` are dropped and re-solved against the landing position; edges between
   * two co-moving bricks are left alone, because a single rigid delta left-multiplying
   * both leaves their relative transform — and so their mate geometry — unchanged.
   */
  transformSelection(ids: readonly BrickId[], delta: Mat4, label: string): void {
    const idSet = new Set(ids);
    const moving = ids
      .map((id) => this.document.bricks.get(id))
      .filter((b): b is BrickInstance => !!b);
    if (moving.length === 0) return;

    const dropped = new Map<string, ConnectionEdge>();
    for (const id of ids) {
      const node = this.document.graph.nodes.get(id);
      if (!node) continue;
      for (const edgeId of [...node.out, ...node.in, ...node.peer]) {
        const e = this.document.graph.edges.get(edgeId);
        if (!e) continue;
        const other = e.a === id ? e.b : e.a;
        if (!idSet.has(other)) dropped.set(e.id, e);
      }
    }

    const landing = new Map<BrickId, Mat4>();
    for (const b of moving) {
      const to = multiply(delta, b.transform);
      landing.set(b.id, to);
      const part = this.parts.get(b.partId);
      // Re-index at the landing transform before re-solving mates, so findMates sees
      // the piece where it actually lands rather than where it started.
      if (part) this.index.insert(b.id, part, to);
    }

    const newEdges = new Map<string, ConnectionEdge>();
    for (const b of moving) {
      const part = this.parts.get(b.partId);
      if (!part) continue;
      const to = landing.get(b.id) as Mat4;
      for (const e of edgesFor(b.id, findMates(part, to, this.index, idSet))) newEdges.set(e.id, e);
    }

    this.commit({
      label,
      ops: [
        { type: 'disconnect', edges: [...dropped.values()] },
        {
          type: 'transform',
          changes: moving.map((b) => ({ id: b.id, from: b.transform, to: landing.get(b.id) as Mat4 })),
        },
        { type: 'connect', edges: [...newEdges.values()] },
      ],
    });
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
   * Bring the index and the renderer back in line after a history move — and after any
   * `commit()`, which is what makes it the one place that keeps them from drifting.
   *
   * The document is diffed against its prior snapshot rather than replaying the
   * transaction's operations, which is what lets a single method serve `commit()`
   * (forward) and `undo`/`redo` (wholesale replacement) alike: it doesn't care how the
   * new document came about, only what's different about it.
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
      } else if (prior.colorCode !== brick.colorCode) {
        // No in-place recolor on the renderer's projection: a brick's batch is keyed by
        // (partId, colorCode), so changing color means changing batch. Remove and
        // re-add is exactly that, through the same two SceneSync methods everything
        // else already uses.
        this.scene.removeBrick(id);
        void this.scene.addBrick(brick);
      }
    }

    if (this.selectedIds.size > 0) {
      const pruned = [...this.selectedIds].filter((id) => after.bricks.has(id));
      if (pruned.length !== this.selectedIds.size) this.selectedIds = new Set(pruned);
    }

    this.notify();
  }
}
