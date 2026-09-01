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

import { fromTranslation, fromYRotation, multiplyAll, positionOf } from '../../math';
import { mintBrickId } from '../../model/ids.ts';
import type { BrickInstance, SceneDocument } from '../../model/types';
import type { PartDef } from '../../snap/types';
import type { Mat4, Vec3 } from '../../types';
import { SceneRenderer } from '../SceneRenderer.ts';
import type { SelectionEntry } from '../selectionOverlay.ts';
import { SnapSound } from './click.ts';
import { EditorSession, type SceneSync } from './editor.ts';
import { PlacementController, createPartCatalog } from './placement.ts';

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
        await renderer.addBrick(brick, options);
      },
      removeBrick: (id) => {
        placement.remove(id);
        renderer.removeBrick(id);
      },
      setBrickTransform: (id, transform) => {
        placement.updateTransform(id, transform);
        renderer.setBrickTransform(id, transform);
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
      setBlocked(placement.current.transform !== null && !placement.current.valid);
    };

    /** Commit whatever the ghost is showing. Shared by a placing click and a dblclick's trailing commit-check. */
    const commitHeld = (pos: readonly [number, number]): void => {
      placement.move(...pos);
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
      // happens to move.
      placement.move(...pos);
      setIsHolding(true);
    };

    /** Rotation about the vertical axis, pivoting on the centroid of `positions`. */
    const rotationAbout = (positions: readonly Vec3[], angleRadians: number): Mat4 => {
      const n = Math.max(positions.length, 1);
      const centroid: Vec3 = [
        positions.reduce((s, p) => s + p[0], 0) / n,
        positions.reduce((s, p) => s + p[1], 0) / n,
        positions.reduce((s, p) => s + p[2], 0) / n,
      ];
      const negCentroid: Vec3 = [-centroid[0], -centroid[1], -centroid[2]];
      return multiplyAll(fromTranslation(centroid), fromYRotation(angleRadians), fromTranslation(negCentroid));
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
      const ground = renderer.groundBasis();
      const along = (dir: Vec3, magnitude: number): Mat4 =>
        fromTranslation([dir[0] * magnitude, dir[1] * magnitude, dir[2] * magnitude]);
      const vertical = (magnitude: number): Mat4 => fromTranslation([0, magnitude, 0]);

      if (placement.holding) {
        // Every operation below also exists on a placed selection, applied to the
        // ghost instead — holding is not a separate, poorer mode. `]` and `r` stay
        // scoped to holding: cycling candidates and rolling about a connection axis
        // only mean something while something is mid-placement.
        if (event.key === ']') {
          placement.cycle();
          return;
        }
        if (event.key.toLowerCase() === 'r') {
          placement.rotate(lastPointer);
          return;
        }

        const current = placement.current.transform;
        const rotateGhost = (angleRadians: number): void => {
          if (!current) return;
          placement.nudge(rotationAbout([positionOf(current)], angleRadians));
        };

        switch (event.key) {
          case 'ArrowLeft':
            if (event.shiftKey) rotateGhost((-deg * Math.PI) / 180);
            else placement.nudge(along(ground.right, -xz));
            break;
          case 'ArrowRight':
            if (event.shiftKey) rotateGhost((deg * Math.PI) / 180);
            else placement.nudge(along(ground.right, xz));
            break;
          case 'ArrowUp':
            if (event.shiftKey) placement.nudge(vertical(-vy));
            else placement.nudge(along(ground.forward, xz));
            break;
          case 'ArrowDown':
            if (event.shiftKey) placement.nudge(vertical(vy));
            else placement.nudge(along(ground.forward, -xz));
            break;
          default:
            break;
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

      switch (event.key) {
        case 'ArrowLeft':
          if (event.shiftKey) session.transformSelection(selection, rotationAbout(positions, (-deg * Math.PI) / 180), rotateLabel);
          else session.transformSelection(selection, along(ground.right, -xz), label);
          break;
        case 'ArrowRight':
          if (event.shiftKey) session.transformSelection(selection, rotationAbout(positions, (deg * Math.PI) / 180), rotateLabel);
          else session.transformSelection(selection, along(ground.right, xz), label);
          break;
        case 'ArrowUp':
          if (event.shiftKey) session.transformSelection(selection, vertical(-vy), label);
          else session.transformSelection(selection, along(ground.forward, xz), label);
          break;
        case 'ArrowDown':
          if (event.shiftKey) session.transformSelection(selection, vertical(vy), label);
          else session.transformSelection(selection, along(ground.forward, -xz), label);
          break;
        default:
          break;
      }
    };

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('dblclick', onDoubleClick);
    canvas.addEventListener('keydown', onKey);

    const resize = (): void => {
      const rect = canvas.getBoundingClientRect();
      renderer.resize(Math.max(1, rect.width), Math.max(1, rect.height));
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    return () => {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('dblclick', onDoubleClick);
      canvas.removeEventListener('keydown', onKey);
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
      {(selectedCount > 0 || isHolding) && (
        // Nothing else names these keys — there's no toolbar button or drag gesture
        // for any of them, so the legend appears the moment they start doing
        // something, and it's the same legend whether the piece is selected or still
        // on the cursor: every one of these operations works identically in both
        // modes. Rotate carries the accent variant: it's the one action with no other
        // affordance anywhere in the UI, mouse or menu.
        <div className="by-shortcut-card">
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
          {isHolding ? (
            <span className="by-shortcut-card__item">
              <span className="by-kbd-set">
                <kbd className="by-kbd">Esc</kbd>
              </span>
              Cancel
            </span>
          ) : (
            <span className="by-shortcut-card__item">
              <span className="by-kbd-set">
                <kbd className="by-kbd">⌫</kbd>
              </span>
              Delete
            </span>
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
      </div>
    </>
  );
}

