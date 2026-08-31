/**
 * The first playable: hover a brick, see the ghost, click to place.
 *
 * Deliberately thin. It exists so placement can be judged by using it, which is the only
 * way this part of the project can be judged at all.
 */

import { useEffect, useRef, useState } from 'react';

import { mintBrickId } from '../../model/ids.ts';
import { SceneRenderer } from '../SceneRenderer.ts';
import { PlacementController, createPartCatalog, translation } from './placement.ts';

const BRICK_HEIGHT = 24;
const SEED_PART = '3001';
const SEED_COLOR = 4;

/** Cursor position in normalised device coordinates, which is what picking wants. */
function ndc(canvas: HTMLCanvasElement, event: PointerEvent): [number, number] {
  const r = canvas.getBoundingClientRect();
  return [((event.clientX - r.left) / r.width) * 2 - 1, -((event.clientY - r.top) / r.height) * 2 + 1];
}

export function BuilderCanvas(): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState('resolving part…');
  const [count, setCount] = useState(0);
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;

    const renderer = new SceneRenderer(canvas);
    const placement = new PlacementController(renderer);
    const catalog = createPartCatalog();
    let disposed = false;
    let dragging = false;
    // Kept so a key press can re-solve at the current pointer position.
    let lastPointer: [number, number] | undefined;

    const start = async (): Promise<void> => {
      const part = await catalog(SEED_PART);
      if (disposed) return;

      // A brick to build on, and an obstacle hanging where the next brick would go.
      // The gap is deliberately less than a brick tall — an exactly-one-brick gap fits
      // perfectly and is correctly not a collision, which makes it useless as a test.
      const seeds = [
        { id: mintBrickId(), partId: SEED_PART, colorCode: SEED_COLOR, transform: translation(0, -BRICK_HEIGHT, 0), part },
        { id: mintBrickId(), partId: SEED_PART, colorCode: 14, transform: translation(0, -BRICK_HEIGHT - 16, 0), part },
      ];
      for (const seed of seeds) {
        await renderer.addBrick(seed);
        placement.add(seed);
      }
      renderer.frameAll();
      placement.hold(part, 1);
      setCount(seeds.length);
      setStatus(`${part.connections.length} connection points · click to place`);
    };

    void start().catch((e: unknown) => {
      if (!disposed) setStatus(`failed: ${String(e)}`);
    });

    renderer.start();

    // The camera owns drag; a click that moved is an orbit, not a placement.
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
      placement.move(...ndc(canvas, event));
      const brick = placement.commit(mintBrickId());
      if (brick === null) return;
      void renderer.addBrick(brick);
      setCount((n) => n + 1);
    };
    // Scoped to the canvas, not the window: Tab is the browser's own navigation key and
    // swallowing it globally would trap keyboard users once the chest and palette are
    // mounted alongside this.
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Tab') {
        event.preventDefault();
        placement.cycle();
      } else if (event.key.toLowerCase() === 'r') {
        placement.rotate(lastPointer);
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
      disposed = true;
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('keydown', onKey);
      observer.disconnect();
      renderer.dispose();
    };
  }, []);

  return (
    <>
      {/* Focusable so it can receive keys without a window-level listener. */}
      <canvas ref={canvasRef} tabIndex={0} aria-label="Building canvas" />
      <div className="by-statusbar">
        <span>
          {count} {count === 1 ? 'brick' : 'bricks'}
        </span>
        <span>{blocked ? 'Blocked — that space is taken' : 'Ready'}</span>
        <span>{status}</span>
        <span>
          <kbd className="by-kbd">R</kbd> rotate · <kbd className="by-kbd">Tab</kbd> next fit
        </span>
      </div>
    </>
  );
}
