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

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;

    const renderer = new SceneRenderer(canvas);
    const placement = new PlacementController(renderer);
    const catalog = createPartCatalog();
    let disposed = false;
    let dragging = false;

    const start = async (): Promise<void> => {
      const part = await catalog(SEED_PART);
      if (disposed) return;

      // One brick to build against. Everything after this is the user's.
      const seed = {
        id: mintBrickId(),
        partId: SEED_PART,
        colorCode: SEED_COLOR,
        transform: translation(0, -BRICK_HEIGHT, 0),
        part,
      };
      await renderer.addBrick(seed);
      placement.add(seed);
      renderer.frameAll();
      placement.hold(part, 1);
      setCount(1);
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
      placement.move(...ndc(canvas, event));
    };
    const onUp = (event: PointerEvent): void => {
      if (dragging) return;
      placement.move(...ndc(canvas, event));
      const brick = placement.commit(mintBrickId());
      if (brick === null) return;
      void renderer.addBrick(brick);
      setCount((n) => n + 1);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Tab') {
        event.preventDefault();
        placement.cycle();
      } else if (event.key.toLowerCase() === 'r') {
        placement.rotate();
      }
    };

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey);

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
      window.removeEventListener('keydown', onKey);
      observer.disconnect();
      renderer.dispose();
    };
  }, []);

  return (
    <>
      <canvas ref={canvasRef} />
      <div className="by-statusbar">
        <span>
          {count} {count === 1 ? 'brick' : 'bricks'}
        </span>
        <span>{status}</span>
        <span>
          <kbd className="by-kbd">R</kbd> rotate · <kbd className="by-kbd">Tab</kbd> next fit
        </span>
      </div>
    </>
  );
}
