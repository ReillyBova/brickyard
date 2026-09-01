/**
 * The `graph` mode's content: whatever document is currently live in the editor —
 * hand-built in the sandbox or loaded from a bundled model, the two are the same
 * `SceneDocument` now — rendered as an explodable graph. Every brick a node, every
 * logged `ConnectionEdge` an edge, one button to bloom them apart.
 *
 * Deliberately document-driven rather than session-driven: this component takes a
 * `SceneDocument` prop instead of calling a session hook itself, so it has no
 * compile-time dependency on `src/scene/interaction/`'s session context and is easy to
 * mount directly against a hand-built document, in a test or otherwise. `GraphModeMount`
 * (`./GraphModeMount.tsx`) is the zero-prop wrapper that reads `useEditorSession()` and
 * passes its document in here — that's what the toolbar's mode switch should render.
 */
import { useEffect, useRef, useState } from 'react';

import type { SceneDocument } from '../../model/types';

import { GraphExplodeScene, type ExplodeState, type GraphExplodeSceneStats } from './GraphExplodeScene';
import { computeGraphStats, type GraphStats } from './stats';
import { AssembleIcon, ExplodeIcon } from './icons';
import './GraphMode.css';

export interface GraphModeProps {
  document: SceneDocument;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; graphStats: GraphStats; skippedParts: number }
  | { status: 'error'; message: string };

export function GraphMode({ document }: GraphModeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<GraphExplodeScene | null>(null);
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [explodeState, setExplodeState] = useState<ExplodeState>('assembled');
  const [sceneStats, setSceneStats] = useState<GraphExplodeSceneStats | null>(null);

  const empty = document.bricks.size === 0;

  useEffect(() => {
    if (empty) return;
    const canvas = canvasRef.current;
    if (canvas === null) return;

    const scene = new GraphExplodeScene(canvas);
    sceneRef.current = scene;
    let disposed = false;

    setState({ status: 'loading' });
    scene
      .setDocument(document)
      .then(({ skippedPartIds }) => {
        if (disposed) return;
        scene.start();
        const graphStats = computeGraphStats(document);
        setState({ status: 'ready', graphStats, skippedParts: skippedPartIds.length });
      })
      .catch((err: unknown) => {
        if (!disposed) setState({ status: 'error', message: String(err) });
      });

    const onResize = (): void => scene.resize(canvas.clientWidth, canvas.clientHeight);
    window.addEventListener('resize', onResize);

    const poll = window.setInterval(() => {
      if (disposed) return;
      setExplodeState(scene.getState());
      setSceneStats(scene.getStats());
    }, 200);

    return () => {
      disposed = true;
      window.clearInterval(poll);
      window.removeEventListener('resize', onResize);
      scene.dispose();
      sceneRef.current = null;
    };
    // `document` is a new object identity on every commit (SceneDocument is immutable,
    // per docs/ARCHITECTURE.md), so re-running this effect on every change would tear
    // down and rebuild the whole scene on every edit. Entering the mode fresh is the
    // deliberate scope for now — see index.ts's note on the live-update follow-up.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empty]);

  if (empty) {
    return (
      <div className="by-graph-mode">
        <div className="by-empty">
          <p className="by-empty__title">Nothing to explode yet</p>
          <p className="by-empty__body">Place a few bricks, or load a model, then switch back here.</p>
        </div>
      </div>
    );
  }

  const toggleExplode = (): void => {
    sceneRef.current?.toggleExplode();
  };

  const exploding = explodeState === 'exploding' || explodeState === 'exploded';

  return (
    <div className="by-graph-mode">
      <canvas ref={canvasRef} className="by-graph-canvas" />

      {state.status === 'loading' && (
        <div className="by-graph-mode__overlay">
          <p className="by-muted">Loading geometry…</p>
        </div>
      )}

      {state.status === 'error' && (
        <div className="by-graph-mode__overlay">
          <p className="by-empty__title">Failed to load</p>
          <p className="by-empty__body">{state.message}</p>
        </div>
      )}

      {state.status === 'ready' && (
        <div className="by-graph-toolbar">
          <button
            type="button"
            className="by-btn by-btn--primary"
            onClick={toggleExplode}
            title={exploding ? 'Fly the model back together' : 'Explode the connection graph'}
          >
            {exploding ? <AssembleIcon /> : <ExplodeIcon />}
            {exploding ? 'Reassemble' : 'Explode'}
          </button>

          <div className="by-statusbar">
            <span>{state.graphStats.brickCount.toLocaleString()} bricks</span>
            <span>{state.graphStats.edgeCount.toLocaleString()} edges</span>
            <span>
              {state.graphStats.componentCount} component{state.graphStats.componentCount === 1 ? '' : 's'}
            </span>
            {sceneStats && <span>{sceneStats.drawCalls} draw calls</span>}
            {state.skippedParts > 0 && (
              <span>
                {state.skippedParts} part{state.skippedParts === 1 ? '' : 's'} skipped
              </span>
            )}
          </div>

          <div className="by-graph-legend">
            <span className="by-tag by-tag--structure">out → in</span>
            <span className="by-tag by-tag--outline">peer</span>
          </div>
        </div>
      )}
    </div>
  );
}
