/**
 * Holding, placing, selecting, and moving pieces on the baseplate.
 *
 * `EditorSession` is the one writer — see `editor.ts`. This component is where its
 * `SceneSync` is wired to a live `SceneRenderer`, and where the pointer and keyboard
 * turn into the `Transaction`s the session commits. `PlacementController` stays
 * responsible for the live ghost/candidate lookahead while a piece is on the cursor;
 * its own index and brick map are kept in step with the session through the same
 * `SceneSync` adapter, so undo, redo, and a keyboard nudge all leave both correct.
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
function ndc(canvas: HTMLCanvasElement, event: PointerEvent): [number, number] {
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
  /** The part id on the cursor, from the parts chest. `undefined` is selection mode. */
  heldPartId?: string;
  /** The active palette color — applied to a newly held piece, and to one already held. */
  heldColorCode: number;
  /** Fired once a held piece lands, so the chest tile that put it on the cursor clears. */
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

  // Reached into from the props-driven effects below, which run outside the mount
  // effect's own closure.
  const rendererRef = useRef<SceneRenderer | null>(null);
  const placementRef = useRef<PlacementController | null>(null);
  const sessionRef = useRef<EditorSession | null>(null);
  const catalogRef = useRef<ReturnType<typeof createPartCatalog> | null>(null);
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
      addBrick: async (brick: BrickInstance) => {
        const part = session.partFor(brick.partId);
        if (part) placement.add({ id: brick.id, partId: brick.partId, colorCode: brick.colorCode, transform: brick.transform, part });
        await renderer.addBrick(brick);
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
    placementRef.current = placement;
    sessionRef.current = session;
    catalogRef.current = catalog;
    onSessionReadyRef.current?.(session);

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
    renderer.frameAll();

    let dragging = false;
    // Kept so a key press can re-solve at the current pointer position.
    let lastPointer: [number, number] | undefined;

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
    const onUp = (event: PointerEvent): void => {
      if (dragging) return;
      const pos = ndc(canvas, event);

      if (placement.holding) {
        placement.move(...pos);
        const placed = placement.commit(mintBrickId());
        if (placed === null) return;

        session.registerPart(placed.part);
        const mates = session.place(
          { id: placed.id, partId: placed.partId, colorCode: placed.colorCode, transform: placed.transform },
          placed.part,
        );
        // Placement is the gesture; the next keystroke should nudge or rotate what
        // just landed, which is why it becomes the selection immediately.
        session.setSelection([placed.id]);
        sound.play(Math.max(1, mates));
        onHeldConsumedRef.current();
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

    /** Rotation about the vertical axis, pivoting on the selection's own centroid. */
    const rotationDelta = (angleRadians: number): Mat4 => {
      const positions = [...session.selection]
        .map((id) => session.lookup(id)?.transform)
        .filter((t): t is Mat4 => t !== undefined)
        .map(positionOf);
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
    // Selection transforms use neither: arrows and Page Up/Down are self-describing —
    // no mnemonic to reject.
    const onKey = (event: KeyboardEvent): void => {
      if (isUndo(event)) {
        session.undo();
        return;
      }
      if (isRedo(event)) {
        session.redo();
        return;
      }

      if (placement.holding) {
        if (event.key === ']') placement.cycle();
        else if (event.key.toLowerCase() === 'r') placement.rotate(lastPointer);
        return;
      }

      const selection = [...session.selection];
      if (selection.length === 0) return;

      if (event.key === 'Delete' || event.key === 'Backspace') {
        session.remove(selection);
        session.setSelection([]);
        return;
      }

      const fine = event.altKey;
      const label = selection.length === 1 ? 'Move brick' : `Move ${selection.length} bricks`;
      const rotateLabel = selection.length === 1 ? 'Rotate brick' : `Rotate ${selection.length} bricks`;
      const xz = fine ? FINE_XZ : STEP_XZ;
      const y = fine ? FINE_Y : STEP_Y;
      const deg = fine ? FINE_ROTATE_DEG : ROTATE_DEG;

      switch (event.key) {
        case 'ArrowLeft':
          if (event.shiftKey) session.transformSelection(selection, rotationDelta((-deg * Math.PI) / 180), rotateLabel);
          else session.transformSelection(selection, fromTranslation([-xz, 0, 0]), label);
          break;
        case 'ArrowRight':
          if (event.shiftKey) session.transformSelection(selection, rotationDelta((deg * Math.PI) / 180), rotateLabel);
          else session.transformSelection(selection, fromTranslation([xz, 0, 0]), label);
          break;
        case 'ArrowUp':
          if (!event.shiftKey) session.transformSelection(selection, fromTranslation([0, 0, -xz]), label);
          break;
        case 'ArrowDown':
          if (!event.shiftKey) session.transformSelection(selection, fromTranslation([0, 0, xz]), label);
          break;
        case 'PageUp':
          session.transformSelection(selection, fromTranslation([0, -y, 0]), label);
          break;
        case 'PageDown':
          session.transformSelection(selection, fromTranslation([0, y, 0]), label);
          break;
        default:
          break;
      }
    };

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
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
      canvas.removeEventListener('keydown', onKey);
      observer.disconnect();
      unsubscribe();
      sound.dispose();
      renderer.dispose();
      rendererRef.current = null;
      placementRef.current = null;
      sessionRef.current = null;
      catalogRef.current = null;
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

    if (heldPartId === undefined) {
      placement.hold(null);
      setStatus('');
      return;
    }

    session.setSelection([]);
    let cancelled = false;
    setStatus('resolving part…');
    void catalog(heldPartId).then((part) => {
      if (cancelled) return;
      placement.hold(part, heldColorCode);
      setStatus(`${part.connections.length} connection points · click to place`);
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
      <div className="by-statusbar">
        <span>
          {count} {count === 1 ? 'brick' : 'bricks'}
        </span>
        <span>
          {selectedCount > 0
            ? `${selectedCount} selected`
            : blocked
              ? 'Blocked — that space is taken'
              : 'Ready'}
        </span>
        <span>{status}</span>
        <span className="by-kbd-set">
          <kbd className="by-kbd">◄▲▼►</kbd> move ·{' '}
          <kbd className="by-kbd">Pg Up/Dn</kbd> up/down ·{' '}
          <kbd className="by-kbd">Shift</kbd>+<kbd className="by-kbd">◄►</kbd> rotate
        </span>
      </div>
    </>
  );
}
