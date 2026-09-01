/**
 * Holding, placing, selecting, and moving pieces on the baseplate.
 *
 * `EditorSession` is the one writer — see `editor.ts`. This component is where its
 * `SceneSync` is wired to a live `SceneRenderer`, and where the pointer and keyboard
 * turn into the `Transaction`s the session commits. `PlacementController` stays
 * responsible for the live ghost/candidate lookahead while a piece is on the cursor;
 * its own index and brick map are kept in step with the session through the same
 * `SceneSync` adapter, so undo, redo, and a keyboard nudge all leave both correct.
 *
 * The interaction model, stated once here because every handler below exists to
 * implement exactly this and nothing else:
 *
 *   single click    select (replacing the selection)
 *   shift-click     add to selection
 *   double-click    pick up (place mode never fires from a single click)
 *   place           commits AND releases — holding never survives a landed piece
 *   Escape          cancel a hold (restoring what pick-up removed), or clear a
 *                   selection when nothing is held
 *
 * Every keyboard transform (move, rotate, up/down, fine adjust) is available both on a
 * placed selection and on a piece still on the cursor — holding is not a poorer mode.
 */

import { useEffect, useRef, useState } from 'react';

import { axisOf, basisOf, fromAxisAngle, fromTranslation, multiplyAll, positionOf } from '../../math';
import { mintBrickId } from '../../model/ids.ts';
import type { BrickInstance, SceneDocument } from '../../model/types';
import type { PartDef } from '../../snap/types';
import type { Mat3, Mat4, Vec3 } from '../../types';
import { SceneRenderer } from '../SceneRenderer.ts';
import type { SelectionEntry } from '../selectionOverlay.ts';
import { SnapSound } from './click.ts';
import { EditorSession, type SceneSync } from './editor.ts';
import { PlacementController, createPartCatalog } from './placement.ts';
import { makeRaceSafeSceneSync } from './raceSafeSceneSync.ts';

/** Ground-plane and vertical lattice, per CLAUDE.md. */
const STEP_XZ = 20;
const STEP_Y = 8;
const ROTATE_DEG = 90;

/** Held with a step key, a small continuous nudge instead of the lattice snap. */
const FINE_XZ = 1;
const FINE_Y = 1;
const FINE_ROTATE_DEG = 5;

/** Cursor position in normalised device coordinates, which is what picking wants. */
function ndc(canvas: HTMLCanvasElement, event: { clientX: number; clientY: number }): [number, number] {
  const r = canvas.getBoundingClientRect();
  return [((event.clientX - r.left) / r.width) * 2 - 1, -((event.clientY - r.top) / r.height) * 2 + 1];
}

/**
 * Undo/redo, scoped to the canvas so the mouse hand's most common shortcut doesn't need
 * window focus plumbing. `src/ui/toolbar/useUndoRedo.tsx` binds the same combination at
 * `window` level for everywhere else (toolbar, chest, color panel) and explicitly skips
 * when the keydown target is this `<canvas>` — so the split, not a single owner, is what
 * keeps one keystroke from firing undo twice now that both bind the *same* session
 * (via `onSessionReady`/`EditorSessionProvider`). Never stop this keydown event from
 * bubbling: the toolbar's listener relies on it still reaching `window` to see the
 * target and skip it — target-filtering, not propagation, is what dedupes here.
 */
const isUndo = (e: KeyboardEvent): boolean =>
  (e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'z';
const isRedo = (e: KeyboardEvent): boolean =>
  (e.metaKey || e.ctrlKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'));

/** World X/Y/Z — the lattice a selected brick with no anchor (shouldn't happen for a
 * placed piece, but kept for safety) still has. */
const WORLD_BASIS: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

const negate = (v: Vec3): Vec3 => [-v[0], -v[1], -v[2]];

/** Whichever of `candidates` points most toward `desired` — how a screen direction
 * picks a signed axis out of an anchor's basis. */
function mostAligned(candidates: readonly Vec3[], desired: Vec3): Vec3 {
  let best = candidates[0];
  let bestDot = -Infinity;
  for (const c of candidates) {
    const d = c[0] * desired[0] + c[1] * desired[1] + c[2] * desired[2];
    if (d > bestDot) {
      bestDot = d;
      best = c;
    }
  }
  return best;
}

/**
 * A translation of `magnitude` LDU along whichever of `anchor`'s own axes (or the
 * world axes, with no anchor) best matches `screenDirection` — "stud by stud in the
 * coordinate system of what it is anchored to", per the interaction model. `vertical`
 * selects the anchor's connector axis instead of the two axes perpendicular to it.
 */
function anchorStep(anchor: Mat4 | null, vertical: boolean, screenDirection: Vec3, magnitude: number): Mat4 {
  const basis = anchor ? basisOf(anchor) : WORLD_BASIS;
  const axisX: Vec3 = [basis[0], basis[1], basis[2]];
  const axisY: Vec3 = [basis[3], basis[4], basis[5]];
  const axisZ: Vec3 = [basis[6], basis[7], basis[8]];
  const candidates = vertical ? [axisY, negate(axisY)] : [axisX, negate(axisX), axisZ, negate(axisZ)];
  const direction = mostAligned(candidates, screenDirection);
  return fromTranslation([direction[0] * magnitude, direction[1] * magnitude, direction[2] * magnitude]);
}

/** What a caller hands `BuilderCanvas` to replace the document — an imported model. */
export interface DocumentSeed {
  document: SceneDocument;
  /** Every part id the document's bricks reference. */
  parts: readonly PartDef[];
}

interface BuilderCanvasProps {
  /**
   * Hands out the live SceneRenderer so `src/features/pathtrace/` can share this
   * WebGLRenderer, camera and controls rather than opening a second GL context.
   * Called with null on unmount.
   */
  onRendererReady?: (renderer: SceneRenderer | null) => void;
  /** True while another mode owns the canvas — pauses this raster loop. */
  suspended?: boolean;
  /** The part id on the cursor, from the parts chest. `undefined` is selection mode. */
  heldPartId?: string;
  /** The active palette color — applied to a newly held piece, and to one already held. */
  heldColorCode: number;
  /**
   * Fired once a held piece lands, or the hold is cancelled with Escape, so the chest
   * tile that put it on the cursor clears either way.
   */
  onHeldConsumed: () => void;
  /**
   * A whole document to load in place of whatever's on the baseplate — opening a
   * bundled model. Import mechanics (fetch, parse, resolve parts) live above this
   * component, in the composition root: this slice owns the one live session and what
   * happens to it, not how a model gets turned into one.
   */
  seed?: DocumentSeed;
  /** Fired once a seed has been loaded, so the caller can drop its reference to it. */
  onSeedConsumed: () => void;
  /**
   * Reports the live `EditorSession` once it exists (and `null` on unmount), so the
   * composition root can bind it into `EditorSessionProvider` — see
   * `sessionContext.tsx`. Every other panel that reads or drives the canvas (toolbar,
   * restyle, graph view) needs this same instance; without it, each invents its own.
   */
  onSessionReady?: (session: EditorSession | null) => void;
  /**
   * Extra content appended to the status bar's row of spans, after the built-in brick
   * count / selection / mode hint. Render mode uses this to surface path-tracer stats
   * (fps, rays cast, resolution — see `PathtraceToggle`'s `onStats`) without this
   * component needing to know anything about the path tracer.
   */
  statusExtra?: React.ReactNode;
}

export function BuilderCanvas({
  onRendererReady,
  suspended = false,
  heldPartId,
  heldColorCode,
  onHeldConsumed,
  seed,
  onSeedConsumed,
  onSessionReady,
  statusExtra,
}: BuilderCanvasProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState('');
  const [count, setCount] = useState(0);
  const [selectedCount, setSelectedCount] = useState(0);
  const [blocked, setBlocked] = useState(false);
  // Mirrors PlacementController.holding for the shortcut card below — the keyboard
  // vocabulary is identical whether something is selected or on the cursor (item 5),
  // so the legend that explains it has to show in both, not just one.
  const [isHolding, setIsHolding] = useState(false);

  // Reached into from the props-driven effects below, which run outside the mount
  // effect's own closure.
  const rendererRef = useRef<SceneRenderer | null>(null);
  // Callback ref, so passing an inline onRendererReady never re-runs the mount effect
  // and tears down the GL context.
  const onRendererReadyRef = useRef(onRendererReady);
  onRendererReadyRef.current = onRendererReady;
  const suspendedRef = useRef(suspended);
  suspendedRef.current = suspended;
  const placementRef = useRef<PlacementController | null>(null);
  const sessionRef = useRef<EditorSession | null>(null);
  const catalogRef = useRef<ReturnType<typeof createPartCatalog> | null>(null);
  /**
   * Restores whatever a hold in progress would lose if abandoned right now — the one
   * rule item 3 asks for, applied from every exit path rather than each reinventing
   * it: Escape (below), and switching the chest's held part out from under an active
   * pickup (the `heldPartId` effect). A fresh chest hold never touched the document,
   * so there's nothing to restore for it; a picked-up piece was already removed the
   * instant it was picked up, so restoring it is undoing that one transaction.
   */
  const cancelHoldRef = useRef<() => void>(() => {});
  // Read from the mount effect's event handlers, which close over the first render's
  // props — kept current every render so a placement always calls the latest callback.
  const onHeldConsumedRef = useRef(onHeldConsumed);
  onHeldConsumedRef.current = onHeldConsumed;
  const onSeedConsumedRef = useRef(onSeedConsumed);
  onSeedConsumedRef.current = onSeedConsumed;
  const onSessionReadyRef = useRef(onSessionReady);
  onSessionReadyRef.current = onSessionReady;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;

    const renderer = new SceneRenderer(canvas);
    const sound = new SnapSound();
    const catalog = createPartCatalog();

    // `renderer.addBrick` is async (it awaits geometry resolution) but
    // `EditorSession.reconcile` fires it without awaiting — so a brick removed (delete,
    // or an undo) before its add lands would otherwise leave an orphaned instance in the
    // renderer forever, since `removeBrick` is a synchronous "remove if present" no-op
    // for a brick the renderer hasn't tracked yet. See `raceSafeSceneSync.ts`.
    const rendererSync: SceneSync = makeRaceSafeSceneSync({
      addBrick: (brick) => renderer.addBrick(brick),
      removeBrick: (id) => renderer.removeBrick(id),
      setBrickTransform: (id, transform) => renderer.setBrickTransform(id, transform),
    });

    // The bridge between the one writer and everything that renders it: the visible
    // scene, and the placement lookahead's own index (so a brick that arrives via
    // undo/redo or a keyboard nudge is exactly as reachable for the next ghost as one
    // that arrived by a fresh placement).
    const sceneSync: SceneSync = {
      addBrick: async (brick: BrickInstance, options) => {
        const part = session.partFor(brick.partId);
        if (part) placement.add({ id: brick.id, partId: brick.partId, colorCode: brick.colorCode, transform: brick.transform, part });
        // Forwarded verbatim: `EditorSession` decides whether this add is part of a
        // model load (animate) or ordinary editing (instant) — see `AddBrickOptions`.
        // Routed through the race-safe wrapper so a remove landing mid-fetch cannot
        // leave an orphan instance behind.
        await rendererSync.addBrick(brick, options);
      },
      removeBrick: (id) => {
        placement.remove(id);
        rendererSync.removeBrick(id);
      },
      setBrickTransform: (id, transform) => {
        placement.updateTransform(id, transform);
        rendererSync.setBrickTransform(id, transform);
      },
    };

    const session = new EditorSession(sceneSync);
    const placement = new PlacementController(renderer);

    rendererRef.current = renderer;
    onRendererReadyRef.current?.(renderer);
    placementRef.current = placement;
    sessionRef.current = session;
    catalogRef.current = catalog;
    onSessionReadyRef.current?.(session);

    /**
     * The single place "abandon this hold" is decided, so Escape and switching the
     * chest's held part agree. `else if` on purpose, not two ifs: a picked-up piece
     * that's mid-undo has nothing left for `onHeldConsumed` to correct (there was
     * never a chest tile involved), and a fresh chest hold has no transaction to
     * undo.
     */
    const cancelHold = (): void => {
      if (!placement.holding) return;
      if (placement.pickedUp) session.undo();
      else onHeldConsumedRef.current();
      placement.hold(null);
      setIsHolding(false);
      setBlocked(false);
    };
    cancelHoldRef.current = cancelHold;

    const syncSelection = (): void => {
      const entries: SelectionEntry[] = [];
      for (const id of session.selection) {
        const found = session.lookup(id);
        if (found) entries.push({ id, transform: found.transform, bounds: found.part.bounds });
      }
      renderer.setSelection(entries);
      setSelectedCount(session.selection.size);
      setCount(session.document.bricks.size);
    };
    const unsubscribe = session.subscribe(syncSelection);

    renderer.start();
    if (suspendedRef.current) renderer.stop();
    renderer.frameAll();

    let dragging = false;
    // Kept so a key press can re-solve at the current pointer position.
    let lastPointer: [number, number] | undefined;
    /**
     * A brief window after any placement lands, during which a double-click doesn't
     * pick up. Without this, double-clicking to place a fresh chest piece — the two
     * clicks a `dblclick` is built from — lands it on the first click and then, when
     * `dblclick` fires immediately after, picks the very same piece right back up:
     * a real double-click aimed at the ordinary single-click "place" gesture would
     * silently undo itself. 400ms comfortably covers a `dblclick`'s own timing
     * window without lingering into a genuinely later, deliberate double-click.
     */
    let suppressPickupUntil = 0;
    const PICKUP_SUPPRESS_MS = 400;

    /**
     * Mirrors PlacementController's current valid/transform into the statusbar's
     * "Blocked" text. Every place that can change the ghost's transform or validity
     * outside a mouse hover has to call this explicitly — React state doesn't know
     * `placement.current` changed just because the imperative controller's internals
     * did. Before this existed, only `onMove` called it, so resolving a collision (or
     * causing one) with a keyboard nudge, a roll, a candidate cycle, or a fresh
     * pick-up left the statusbar reporting whatever it last saw from the mouse —
     * "Blocked" could sit there for good after the piece was actually clear again,
     * reading as broken rotation rather than a stale label.
     */
    const syncBlocked = (): void => {
      setBlocked(placement.current.transform !== null && !placement.current.valid);
    };

    const onDown = (): void => {
      dragging = false;
    };
    const onMove = (event: PointerEvent): void => {
      if (event.buttons !== 0) {
        dragging = true;
        return;
      }
      lastPointer = ndc(canvas, event);
      placement.move(...lastPointer);
      syncBlocked();
    };

    /** Commit whatever the ghost is showing. Shared by a placing click and a dblclick's trailing commit-check. */
    /**
     * Whatever the ghost is showing is exactly what gets committed — never a fresh
     * re-solve at the click position. Re-solving here used to be unconditional, which
     * silently discarded any keyboard adjustment made since the last real cursor
     * move (a translate nudge, or — before rotateManually existed — a rotation):
     * `resolveSnap` would recompute a transform from the cursor and the *pre-nudge*
     * roll, and that recomputed transform, not the nudged one, is what got placed.
     * The one legitimate reason to resolve here is a placement that has never been
     * resolved at all — `state.transform` is still null because no pointermove has
     * run since `hold()`/`pickUp()`, which needs literally zero cursor movement over
     * the canvas between picking something up and clicking, an edge case worth
     * covering but not one that should cost every ordinary placement its nudges.
     */
    const commitHeld = (pos: readonly [number, number]): void => {
      if (placement.current.transform === null) placement.move(...pos);
      const placed = placement.commit(mintBrickId());
      if (placed === null) return;

      session.registerPart(placed.part);
      const mates = session.place(
        { id: placed.id, partId: placed.partId, colorCode: placed.colorCode, transform: placed.transform },
        placed.part,
      );
      // Placement is the gesture; the next keystroke should nudge or rotate what just
      // landed, which is why it becomes the selection immediately. commit() itself
      // already released the hold — see placement.ts — so there is nothing left to
      // clear here.
      session.setSelection([placed.id]);
      sound.play(Math.max(1, mates));
      onHeldConsumedRef.current();
      suppressPickupUntil = performance.now() + PICKUP_SUPPRESS_MS;
      setIsHolding(false);
      setBlocked(false);
    };

    /**
     * Single click: select, add to selection, or clear — never pick up. A single
     * click landing on an already-selected brick used to pick it up, which is
     * exactly the ambiguity the interaction model rules out: the second click of a
     * genuine double-click still runs this handler first (a `dblclick` fires after
     * both underlying clicks), so it has to be a plain, idempotent-feeling select or
     * the two gestures blur together. Pick-up lives only in `onDoubleClick` below.
     */
    const onUp = (event: PointerEvent): void => {
      if (dragging) return;
      const pos = ndc(canvas, event);

      if (placement.holding) {
        commitHeld(pos);
        return;
      }

      const hit = renderer.pick(...pos);
      if (hit === null) {
        session.setSelection([]);
      } else if (event.shiftKey) {
        session.setSelection([...session.selection, hit.brick]);
      } else {
        session.setSelection([hit.brick]);
      }
    };

    /**
     * Double-click: pick up. A native `dblclick` only fires when the browser's own
     * timing-and-proximity heuristic agrees two clicks were one gesture on the same
     * spot — a far more reliable signal than anything hand-rolled from click
     * timestamps, and it's what keeps this from firing on two separate, deliberate
     * single clicks that just happen to land close together in time.
     */
    const onDoubleClick = (event: MouseEvent): void => {
      if (placement.holding) return;
      if (performance.now() < suppressPickupUntil) return;
      const pos = ndc(canvas, event);
      const hit = renderer.pick(...pos);
      if (hit === null) return;

      const brick = session.document.bricks.get(hit.brick);
      const found = session.lookup(hit.brick);
      if (!brick || !found) return;

      // Removed immediately, not only on commit: this is what lets the rest of the
      // scene re-mate to the space it vacated, the same reason a keyboard nudge
      // excludes the moving set from its own collision/mating check
      // (EditorSession.transformSelection).
      session.remove([hit.brick]);
      session.setSelection([]);
      placement.pickUp(found.part, brick.colorCode, brick.transform);
      // Paint immediately at the current cursor position rather than waiting for the
      // next pointermove — otherwise the piece vanishes with no ghost until the mouse
      // happens to move. Also records it as lastPointer, so a rotate key pressed
      // before the mouse next moves (rotateManually needs a pointer to re-solve
      // against once a connector is mated — see PlacementController.rotateManually)
      // has one to use, rather than whatever stale position preceded the pick-up.
      lastPointer = pos;
      placement.move(...pos);
      syncBlocked();
      setIsHolding(true);
    };

    /**
     * Rotation by `angleRadians`, pivoting on `anchor`'s connector — its position, about
     * its own axis — so the mated connector stays fixed and the rest of the piece turns
     * around it, the way a brick actually turns on the stud holding it. Per the bug this
     * fixes: pivoting on the selection centroid instead swings that connector off the
     * lattice whenever it isn't at the centroid, which is true of most parts, breaking
     * the mate and reading as a collision.
     *
     * No anchor (nothing mated) falls back to the previous behaviour — world Y through
     * the centroid of `positions` — since there is no connector to pivot on instead.
     */
    const rotationAbout = (anchor: Mat4 | null, positions: readonly Vec3[], angleRadians: number): Mat4 => {
      let pivot: Vec3;
      let axis: Vec3;
      if (anchor) {
        pivot = positionOf(anchor);
        axis = axisOf(anchor);
      } else {
        const n = Math.max(positions.length, 1);
        pivot = [
          positions.reduce((s, p) => s + p[0], 0) / n,
          positions.reduce((s, p) => s + p[1], 0) / n,
          positions.reduce((s, p) => s + p[2], 0) / n,
        ];
        axis = [0, 1, 0];
      }
      const negPivot: Vec3 = [-pivot[0], -pivot[1], -pivot[2]];
      return multiplyAll(fromTranslation(pivot), fromAxisAngle(axis, angleRadians), fromTranslation(negPivot));
    };

    // Candidate cycling deliberately does NOT use Tab. Tab is the browser's own
    // navigation key, and swallowing it here trapped keyboard users on the canvas with
    // no way out — the canvas is the first focusable element in the document, so tabbing
    // in made the toolbar, chest and palette permanently unreachable. Bracket keys carry
    // no browser meaning and sit under the same hand as R.
    //
    // Selection and ghost transforms use neither: arrows are self-describing, and
    // Shift is the one modifier that means "the other axis" throughout — Shift+Left/
    // Right rotates instead of translating, Shift+Up/Down moves vertically instead of
    // on the ground plane. Page Up/Down are gone: they need Fn on a MacBook with no
    // numeric keypad, which is not "laptop-friendly, directional keys only."
    const onKey = (event: KeyboardEvent): void => {
      if (isUndo(event)) {
        session.undo();
        return;
      }
      if (isRedo(event)) {
        session.redo();
        return;
      }

      if (event.key === 'Escape') {
        // Cancel a hold if there is one; otherwise Escape clears a selection instead
        // of doing nothing — it was previously scoped to holding only, so a selected
        // piece with nothing held had no keyboard way out.
        if (placement.holding) cancelHoldRef.current();
        else session.setSelection([]);
        return;
      }

      const fine = event.altKey;
      const xz = fine ? FINE_XZ : STEP_XZ;
      const vy = fine ? FINE_Y : STEP_Y;
      const deg = fine ? FINE_ROTATE_DEG : ROTATE_DEG;

      // Screen-relative, not world-relative: read fresh on every keypress, because the
      // camera can have orbited since the last one. Without this, "left" reads as
      // world -X regardless of where the camera is looking — correct only until
      // someone orbits behind the model, at which point every arrow reads reversed.
      // Only the selection branch below still needs it — a held ghost no longer takes
      // keyboard translation at all.
      const ground = renderer.groundBasis();

      if (placement.holding) {
        // A held piece already follows the cursor — that's the whole mechanism of
        // placement — so keyboard translation would just fight the pointer for
        // control of the same thing. Rotation has no mouse equivalent, so it stays:
        // Shift+Left/Right (persistent — see PlacementController.rotateManually), `r`
        // (a discrete quarter-turn about the connection axis) and `]` (cycle
        // candidates) are the only keys that do anything while holding.
        if (event.key === ']') {
          placement.cycle();
          syncBlocked();
          return;
        }
        if (event.key.toLowerCase() === 'r') {
          placement.rotate(lastPointer);
          syncBlocked();
          return;
        }
        if (event.shiftKey && event.key === 'ArrowLeft') {
          placement.rotateManually((-deg * Math.PI) / 180, lastPointer);
          syncBlocked();
        } else if (event.shiftKey && event.key === 'ArrowRight') {
          placement.rotateManually((deg * Math.PI) / 180, lastPointer);
          syncBlocked();
        }
        return;
      }

      const selection = [...session.selection];
      if (selection.length === 0) return;

      if (event.key === 'Delete' || event.key === 'Backspace') {
        session.remove(selection);
        session.setSelection([]);
        return;
      }

      const label = selection.length === 1 ? 'Move brick' : `Move ${selection.length} bricks`;
      const rotateLabel = selection.length === 1 ? 'Rotate brick' : `Rotate ${selection.length} bricks`;
      const positions = selection
        .map((id) => session.lookup(id)?.transform)
        .filter((t): t is Mat4 => t !== undefined)
        .map(positionOf);

      // Stud by stud in the coordinate system of whatever the piece is anchored to —
      // that's the whole point of the snapping. The first selected brick stands in
      // for the group on a multi-select: simple and deterministic, and a rigid group
      // move already keeps every member's relative pose fixed, so one anchor speaks
      // for all of them. No anchor (nothing mated) falls back to world axes inside
      // anchorStep itself.
      const anchor = session.anchorFrame(selection[0]);

      switch (event.key) {
        case 'ArrowLeft':
          if (event.shiftKey) session.transformSelection(selection, rotationAbout(anchor, positions, (-deg * Math.PI) / 180), rotateLabel);
          else session.transformSelection(selection, anchorStep(anchor, false, negate(ground.right), xz), label);
          break;
        case 'ArrowRight':
          if (event.shiftKey) session.transformSelection(selection, rotationAbout(anchor, positions, (deg * Math.PI) / 180), rotateLabel);
          else session.transformSelection(selection, anchorStep(anchor, false, ground.right, xz), label);
          break;
        case 'ArrowUp':
          if (event.shiftKey) session.transformSelection(selection, anchorStep(anchor, true, [0, -1, 0], vy), label);
          else session.transformSelection(selection, anchorStep(anchor, false, ground.forward, xz), label);
          break;
        case 'ArrowDown':
          if (event.shiftKey) session.transformSelection(selection, anchorStep(anchor, true, [0, 1, 0], vy), label);
          else session.transformSelection(selection, anchorStep(anchor, false, negate(ground.forward), xz), label);
          break;
        default:
          break;
      }
    };

    // Suspended means another mode owns the canvas — graph, or the path tracer sharing
    // this GL context. Editing gestures must be inert there: `suspended` previously only
    // stopped the render loop, so a click still selected a brick behind a rendered image.
    const whenActive =
      <E extends Event>(handler: (event: E) => void) =>
      (event: E): void => {
        if (suspendedRef.current) return;
        handler(event);
      };

    const onDownGated = whenActive(onDown);
    const onMoveGated = whenActive(onMove);
    const onUpGated = whenActive(onUp);
    const onDoubleClickGated = whenActive(onDoubleClick);
    const onKeyGated = whenActive(onKey);

    canvas.addEventListener('pointerdown', onDownGated);
    canvas.addEventListener('pointermove', onMoveGated);
    canvas.addEventListener('pointerup', onUpGated);
    canvas.addEventListener('dblclick', onDoubleClickGated);
    canvas.addEventListener('keydown', onKeyGated);

    const resize = (): void => {
      const rect = canvas.getBoundingClientRect();
      renderer.resize(Math.max(1, rect.width), Math.max(1, rect.height));
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    return () => {
      canvas.removeEventListener('pointerdown', onDownGated);
      canvas.removeEventListener('pointermove', onMoveGated);
      canvas.removeEventListener('pointerup', onUpGated);
      canvas.removeEventListener('dblclick', onDoubleClickGated);
      canvas.removeEventListener('keydown', onKeyGated);
      observer.disconnect();
      unsubscribe();
      sound.dispose();
      renderer.dispose();
      rendererRef.current = null;
      onRendererReadyRef.current?.(null);
      placementRef.current = null;
      sessionRef.current = null;
      catalogRef.current = null;
      cancelHoldRef.current = () => {};
      onSessionReadyRef.current?.(null);
    };
  }, []);

  // A whole document to load — opening a bundled model. The import itself already
  // happened above this component; this just hands the result to the one session.
  useEffect(() => {
    const session = sessionRef.current;
    if (!session || !seed) return;
    session.loadDocument(seed.document, seed.parts);
    rendererRef.current?.frameAll();
    onSeedConsumedRef.current();
  }, [seed]);

  // Clicking a part in the chest puts it on the cursor — the hold gesture — and clears
  // whatever was selected, since a placement gesture is starting, not a selection edit.
  useEffect(() => {
    const placement = placementRef.current;
    const session = sessionRef.current;
    const catalog = catalogRef.current;
    if (!placement || !session || !catalog) return;

    // Switching the chest's held part (or clearing it) while a picked-up piece is
    // still on the cursor must not silently drop that piece — the same "cancelling a
    // hold restores it" rule Escape follows. Deliberately not `cancelHoldRef.current()`
    // here: that also calls `onHeldConsumed`, which would immediately clear the
    // `selectedPartId` this effect exists to honour when it's a genuine new chest
    // pick, not a cancellation.
    if (placement.holding && placement.pickedUp) session.undo();

    if (heldPartId === undefined) {
      placement.hold(null);
      setStatus('');
      setIsHolding(false);
      setBlocked(false);
      return;
    }

    session.setSelection([]);
    let cancelled = false;
    setStatus('resolving part…');
    void catalog(heldPartId).then((part) => {
      if (cancelled) return;
      placement.hold(part, heldColorCode);
      setStatus(`${part.connections.length} connection points · click to place`);
      setIsHolding(true);
    });
    return () => {
      cancelled = true;
    };
    // heldColorCode intentionally excluded: a color change while holding is handled by
    // the recolor effect below, without re-resolving or re-holding the part.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heldPartId]);

  // Clicking a color in the palette recolors what is held.
  useEffect(() => {
    placementRef.current?.recolor(heldColorCode);
  }, [heldColorCode]);

  return (
    <>
      {/* Focusable so it can receive keys without a window-level listener. */}
      <canvas ref={canvasRef} tabIndex={0} aria-label="Building canvas" />
      {!suspended && (selectedCount > 0 || isHolding) && (
        // A held ghost already follows the cursor for position, so only rotation (no
        // mouse equivalent) has a keyboard path while holding — the legend shows just
        // that. A selection has no pointer-driven move at all, so it gets the full
        // set. Rotate carries the accent variant: it's the one action with no other
        // affordance anywhere in the UI, mouse or menu.
        <div className="by-shortcut-card">
          {isHolding ? (
            <>
              <span className="by-shortcut-card__item by-shortcut-card__item--accent">
                <span className="by-kbd-set">
                  <kbd className="by-kbd">Shift</kbd>
                  <kbd className="by-kbd">◄</kbd>
                  <kbd className="by-kbd">►</kbd>
                </span>
                Rotate
              </span>
              <span className="by-shortcut-card__item">
                <span className="by-kbd-set">
                  <kbd className="by-kbd">Esc</kbd>
                </span>
                Cancel
              </span>
            </>
          ) : (
            <>
              <span className="by-shortcut-card__item">
                <span className="by-kbd-set">
                  <kbd className="by-kbd">◄</kbd>
                  <kbd className="by-kbd">▲</kbd>
                  <kbd className="by-kbd">▼</kbd>
                  <kbd className="by-kbd">►</kbd>
                </span>
                Move
              </span>
              <span className="by-shortcut-card__item">
                <span className="by-kbd-set">
                  <kbd className="by-kbd">Shift</kbd>
                  <kbd className="by-kbd">▲</kbd>
                  <kbd className="by-kbd">▼</kbd>
                </span>
                Up / down
              </span>
              <span className="by-shortcut-card__item by-shortcut-card__item--accent">
                <span className="by-kbd-set">
                  <kbd className="by-kbd">Shift</kbd>
                  <kbd className="by-kbd">◄</kbd>
                  <kbd className="by-kbd">►</kbd>
                </span>
                Rotate
              </span>
              <span className="by-shortcut-card__item">
                <span className="by-kbd-set">
                  <kbd className="by-kbd">Alt</kbd>
                </span>
                Fine step
              </span>
              <span className="by-shortcut-card__item">
                <span className="by-kbd-set">
                  <kbd className="by-kbd">⌫</kbd>
                </span>
                Delete
              </span>
            </>
          )}
        </div>
      )}
      <div className="by-statusbar">
        <span>
          {count} {count === 1 ? 'brick' : 'bricks'}
        </span>
        <span>
          {selectedCount === 1
            ? '1 selected — double-click to pick back up'
            : selectedCount > 1
              ? `${selectedCount} selected`
              : blocked
                ? 'Blocked — that space is taken'
                : 'Ready'}
        </span>
        <span>{status}</span>
        {statusExtra}
      </div>
    </>
  );
}

