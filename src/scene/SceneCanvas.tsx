/**
 * Demo entry point for the render slice: mounts a `SceneRenderer` into a canvas, loads
 * a few hard-coded bricks, and prints picking + performance info to the console so the
 * slice is visible and verifiable in a browser without any UI (that's another slice).
 */

import { useEffect, useRef, useState } from 'react';

import { mintBrickId } from '../model/ids.ts';
import type { BrickInstance } from '../model/types';
import type { Mat4 } from '../types';

import { SceneRenderer } from './SceneRenderer.ts';
import type { SceneStats } from './SceneRenderer.ts';

const BRICK_HEIGHT = 24;

/** Column-major 4x4, translation-only — matches `Mat4`/`Matrix4.elements` layout. */
function translation(x: number, y: number, z: number): Mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
}

/** A short stack of 2x4 bricks in different colours, plus one laid sideways. */
function demoBricks(): BrickInstance[] {
  return [
    { id: mintBrickId(), partId: '3001', colorCode: 4, transform: translation(0, -BRICK_HEIGHT, 0) },
    { id: mintBrickId(), partId: '3001', colorCode: 1, transform: translation(0, -BRICK_HEIGHT * 2, 0) },
    { id: mintBrickId(), partId: '3001', colorCode: 14, transform: translation(0, -BRICK_HEIGHT * 3, 0) },
    { id: mintBrickId(), partId: '3001', colorCode: 2, transform: translation(100, -BRICK_HEIGHT, 0) },
  ];
}

export function SceneCanvas(): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stats, setStats] = useState<SceneStats | null>(null);
  const [status, setStatus] = useState('loading parts…');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;

    const renderer = new SceneRenderer(canvas);
    let disposed = false;

    renderer
      .loadDocument(demoBricks())
      .then(() => {
        if (disposed) return;
        renderer.frameAll();
        setStatus('ready');

        // Log a sample pick from the centre of the canvas so the console shows the
        // picking primitives working end to end, per the verification brief.
        const hit = renderer.pick(0, 0);
        // eslint-disable-next-line no-console
        console.log('scene: center pick', JSON.stringify(hit));
        const ray = renderer.pickRay(0, 0);
        // eslint-disable-next-line no-console
        console.log('scene: center ray (LDU)', JSON.stringify(ray));
      })
      .catch((error: unknown) => {
        if (disposed) return;
        setStatus(`failed to load parts: ${String(error)}`);
        // eslint-disable-next-line no-console
        console.error('scene: failed to load demo bricks', error);
      });

    renderer.start();

    const resize = (): void => {
      const rect = canvas.getBoundingClientRect();
      renderer.resize(Math.max(1, rect.width), Math.max(1, rect.height));
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const statsInterval = window.setInterval(() => setStats(renderer.getStats()), 500);

    return () => {
      disposed = true;
      window.clearInterval(statsInterval);
      observer.disconnect();
      renderer.dispose();
    };
  }, []);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
      <div
        style={{
          position: 'absolute',
          top: 8,
          left: 8,
          fontFamily: 'monospace',
          fontSize: 12,
          color: '#fff',
          background: 'rgba(0,0,0,0.55)',
          padding: '6px 8px',
          borderRadius: 4,
          pointerEvents: 'none',
          lineHeight: 1.5,
        }}
      >
        <div>{status}</div>
        {stats !== null && (
          <>
            <div>draw calls: {stats.drawCalls}</div>
            <div>triangles: {stats.triangles}</div>
            <div>batches: {stats.batchCount}</div>
            <div>instances: {stats.instanceCount}</div>
            <div>frame: {stats.frameTimeMs.toFixed(2)} ms</div>
          </>
        )}
      </div>
    </div>
  );
}
