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
import { collides } from '../../snap/collision';
import { findMates, mateCount, pointMatrix } from '../../snap/mating';
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

/**
 * Whether a brick arriving in the renderer should fly in (`SceneRenderer`'s progressive
 * "arrival" animation, see `docs/ROADMAP.md`'s "Progressive loading" section) or appear
 * immediately. Only `loadDocument` — opening a model — sets this; every other path that
 * adds geometry (hand placement, undo/redo, restyle's recolor-as-remove-plus-re-add)
 * must not, or the animation fires for ordinary editing instead of only the initial
 * load. Threaded through as a call-time argument rather than a stateful "bulk load
 * window" opened/closed around `reconcile`'s loop: `reconcile` dispatches every
 * `addBrick` synchronously in one pass (the *loads* it kicks off are async, the calls
 * that start them are not), so a plain argument captured at call time can't leak across
 * calls the way a window's open/close bracketing could if a caller forgot to close it,
 * threw before closing it, or a load from a stale window resolved late.
 */
export interface AddBrickOptions {
  animate?: boolean;
}

/** What the renderer must do to match a document change. */
export interface SceneSync {
  addBrick(brick: BrickInstance, options?: AddBrickOptions): Promise<void> | void;
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
    this.reconcile(before); // never animated — see AddBrickOptions
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
    // The one caller that animates: opening a model is the "initial load" the fly-in
    // treatment is for. See AddBrickOptions.
    this.reconcile(before, { animateArrivals: true });
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
   * The world-space connector frame `id` is currently mated to — position and full
   * 3-axis orientation, not just the connector's own axis. This is what "the
   * coordinate system of what it is anchored to" means for a placed brick: the
   * lattice it can step along without breaking connectivity is defined by whichever
   * connection is actually holding it there, not world or camera axes.
   *
   * Deterministic when several mates apply: the strongest edge (most points engaged)
   * wins, tie-broken by the lowest neighbour brick id. Null when `id` isn't mated to
   * anything — the caller falls back to world axes in that case.
   */
  anchorFrame(id: BrickId): Mat4 | null {
    const node = this.document.graph.nodes.get(id);
    if (!node) return null;
    const edgeIds = [...node.out, ...node.in, ...node.peer];
    const edges = edgeIds
      .map((edgeId) => this.document.graph.edges.get(edgeId))
      .filter((e): e is ConnectionEdge => !!e);
    if (edges.length === 0) return null;

    const strongest = [...edges].sort(
      (a, b) => b.mates.length - a.mates.length || (a.id < b.id ? -1 : 1),
    )[0];
    const otherId = strongest.a === id ? strongest.b : strongest.a;
    const otherBrick = this.document.bricks.get(otherId);
    const otherPart = otherBrick && this.parts.get(otherBrick.partId);
    if (!otherBrick || !otherPart) return null;

    const mate = strongest.mates[0];
    const otherPointId = strongest.a === id ? mate.bPoint : mate.aPoint;
    const targetPoint = otherPart.connections.find((c) => c.id === otherPointId);
    if (!targetPoint) return null;
    return multiply(otherBrick.transform, pointMatrix(targetPoint));
  }

  /**
   * Nudge or rotate a set of already-placed bricks by one rigid world-space `delta`
   * (the same matrix applied to every brick — see `transformMany`). Edges to bricks
   * outside `ids` are dropped and re-solved against the landing position; edges between
   * two co-moving bricks are left alone, because a single rigid delta left-multiplying
   * both leaves their relative transform — and so their mate geometry — unchanged.
   *
   * Collision is checked per moved brick against the landing transform before anything
   * is committed — the same fix `src/features/mcp/session.ts`'s `transform()` needed
   * for the identical gap: moving used to re-solve connectivity via `findMates` but
   * never called `collides()`, so a brick could be driven into another and locked
   * there. The moving set is passed as `collides`'s `ignore`, exactly as `findMates`
   * already excludes it below — two co-moving bricks that overlap each other (they
   * don't, since a rigid delta preserves their relative pose, but adjacent studs can
   * sit close) are not what this guards against; a brick landing inside some *other*
   * brick is. Any hit refuses the whole gesture atomically — nothing partially moves —
   * and returns `false` rather than throwing, since a keyboard nudge into a wall is a
   * refusal, not a caller error (contrast the MCP path, which throws because a caller
   * gets to know why).
   */
  transformSelection(ids: readonly BrickId[], delta: Mat4, label: string): boolean {
    const idSet = new Set(ids);
    const moving = ids
      .map((id) => this.document.bricks.get(id))
      .filter((b): b is BrickInstance => !!b);
    if (moving.length === 0) return false;

    const landing = new Map<BrickId, Mat4>();
    for (const b of moving) landing.set(b.id, multiply(delta, b.transform));

    // Checked against the index as it stands now — the moving bricks are still
    // indexed at their old positions, but `ignore` exempts the whole moving set from
    // ever counting as an obstacle, so what this actually tests is "does the landing
    // position overlap anything outside the set that's moving together."
    for (const b of moving) {
      const part = this.parts.get(b.partId);
      if (!part) continue;
      if (collides(part, landing.get(b.id) as Mat4, this.index, idSet)) return false;
    }

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

    for (const b of moving) {
      const part = this.parts.get(b.partId);
      // Re-index at the landing transform before re-solving mates, so findMates sees
      // the piece where it actually lands rather than where it started.
      if (part) this.index.insert(b.id, part, landing.get(b.id) as Mat4);
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
    return true;
  }

  undo(): void {
    if (!this.canUndo) return;
    const before = this.document;
    this.history = undo(this.history);
    this.reconcile(before); // restoring a brick lands it in place, never flying — see AddBrickOptions
  }

  redo(): void {
    if (!this.canRedo) return;
    const before = this.document;
    this.history = redo(this.history);
    this.reconcile(before); // same as undo
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
  private reconcile(before: SceneDocument, options?: { animateArrivals?: boolean }): void {
    const after = this.document;
    const animateArrivals = options?.animateArrivals ?? false;

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
        void this.scene.addBrick(brick, { animate: animateArrivals });
      } else if (prior.transform !== brick.transform) {
        this.index.insert(id, part, brick.transform);
        this.scene.setBrickTransform(id, brick.transform);
      } else if (prior.colorCode !== brick.colorCode) {
        // No in-place recolor on the renderer's projection: a brick's batch is keyed by
        // (partId, colorCode), so changing color means changing batch. Remove and
        // re-add is exactly that, through the same two SceneSync methods everything
        // else already uses — but never animated: a recolor is not a load, and
        // restyling a loaded model would otherwise launch it off-screen and back
        // (fixed alongside the animate-on-load-only bug this is part of). Deliberately
        // ignores `animateArrivals` rather than inheriting it, since `loadDocument`
        // itself never hits this branch (a fresh document has no `prior` to compare
        // against) but a future caller that reconciles a color change during a load
        // shouldn't get a free pass into flying either.
        this.scene.removeBrick(id);
        void this.scene.addBrick(brick, { animate: false });
      }
    }

    if (this.selectedIds.size > 0) {
      const pruned = [...this.selectedIds].filter((id) => after.bricks.has(id));
      if (pruned.length !== this.selectedIds.size) this.selectedIds = new Set(pruned);
    }

    this.notify();
  }
}
