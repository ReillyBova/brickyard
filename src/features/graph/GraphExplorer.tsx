/**
 * The graph feature's whole surface: pick a bundled model, import it (the same
 * `importModel`/`createNetworkReader` path `src/routes/ModelPicker.tsx` uses — a
 * separate copy here rather than a shared import, since routing isn't this slice's to
 * edit), render it, and let the explode button bloom every brick outward along the
 * connection graph's edges.
 *
 * A full-screen takeover rather than a rail: the point is the 3D view, and the model
 * list is a means to get one loaded, not a permanent panel.
 */
import { useEffect, useRef, useState } from 'react';

import type { BundledModelEntry } from '../omr/types';
import { importModel, RESOLVE_SHARE, type ImportResult } from '../omr/importModel';
import { createNetworkReader } from '../omr/network';

import { GraphExplodeScene, type ExplodeState, type GraphExplodeSceneStats } from './GraphExplodeScene';
import { computeGraphStats, type GraphStats } from './stats';
import { AssembleIcon, CloseIcon, ExplodeIcon } from './icons';
import './GraphExplorer.css';

const MODELS_BASE = `${import.meta.env.BASE_URL}models/`;

interface GraphExplorerProps {
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Model list
// ---------------------------------------------------------------------------

type IndexState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; models: readonly BundledModelEntry[] };

function useModelIndex(): IndexState {
  const [state, setState] = useState<IndexState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    fetch(`${MODELS_BASE}index.json`)
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        return res.json() as Promise<BundledModelEntry[]>;
      })
      .then((models) => {
        if (!cancelled) setState({ status: 'ready', models });
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ status: 'error', message: String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

interface ModelPickerProps {
  onOpen: (entry: BundledModelEntry) => void;
  onClose: () => void;
}

function ModelPicker({ onOpen, onClose }: ModelPickerProps) {
  const state = useModelIndex();

  return (
    <div className="by-graph-picker">
      <div className="by-graph-picker__panel">
        <div>
          <h2 className="by-panel__title">Explode a model</h2>
          <p className="by-muted">
            Every brick becomes a node, every logged connection an edge. Pick a bundled model to
            solve its connection graph and take it apart.
          </p>
        </div>

        {state.status === 'loading' && <p className="by-muted">Loading the model list…</p>}

        {state.status === 'error' && (
          <div className="by-empty">
            <p className="by-empty__title">Couldn&rsquo;t load the model list</p>
            <p className="by-empty__body">{state.message}</p>
          </div>
        )}

        {state.status === 'ready' && state.models.length === 0 && (
          <div className="by-empty">
            <p className="by-empty__title">No bundled models yet</p>
            <p className="by-empty__body">Add `.mpd` files to `public/models/` and rebuild the manifest.</p>
          </div>
        )}

        {state.status === 'ready' && state.models.length > 0 && (
          <ul className="by-graph-picker__list">
            {state.models.map((m) => (
              <li key={m.slug}>
                <button type="button" className="by-graph-model" onClick={() => onOpen(m)}>
                  <span className="by-graph-model__name">{m.name}</span>
                  <span className="by-graph-model__stats">
                    {m.brickCount.toLocaleString()} bricks · {m.uniquePartCount} unique parts
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <button type="button" className="by-btn by-btn--secondary by-btn--block" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Viewer
// ---------------------------------------------------------------------------

type LoadState =
  | { status: 'fetching' }
  | { status: 'importing'; progress: number }
  | { status: 'rendering' }
  | { status: 'ready'; result: ImportResult; graphStats: GraphStats; skippedParts: number }
  | { status: 'error'; message: string };

interface GraphViewerProps {
  entry: BundledModelEntry;
  onBack: () => void;
}

function GraphViewer({ entry, onBack }: GraphViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<GraphExplodeScene | null>(null);
  const [state, setState] = useState<LoadState>({ status: 'fetching' });
  const [explodeState, setExplodeState] = useState<ExplodeState>('assembled');
  const [sceneStats, setSceneStats] = useState<GraphExplodeSceneStats | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;

    const scene = new GraphExplodeScene(canvas);
    sceneRef.current = scene;
    let disposed = false;

    const run = async (): Promise<void> => {
      const text = await fetch(`${MODELS_BASE}${entry.mpdFile}`).then((res) => {
        if (!res.ok) throw new Error(`fetching ${entry.mpdFile}: ${res.status} ${res.statusText}`);
        return res.text();
      });
      if (disposed) return;

      const { read } = createNetworkReader();
      setState({ status: 'importing', progress: 0 });
      const result = await importModel(text, entry.name, {
        read,
        onProgress: (progress) => {
          if (!disposed) setState({ status: 'importing', progress });
        },
      });
      if (disposed) return;

      setState({ status: 'rendering' });
      const { skippedPartIds } = await scene.setDocument(result.document);
      if (disposed) return;

      scene.start();
      const graphStats = computeGraphStats(result.document);
      setState({ status: 'ready', result, graphStats, skippedParts: skippedPartIds.length });
    };

    void run().catch((err: unknown) => {
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
    // `entry` is a stable object per selection; this effect owns one scene lifecycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry]);

  const toggleExplode = (): void => {
    sceneRef.current?.toggleExplode();
  };

  const progress = state.status === 'importing' ? state.progress : state.status === 'rendering' ? 1 : 0;
  const phase =
    state.status === 'importing'
      ? state.progress < RESOLVE_SHARE
        ? 'resolving parts'
        : 'solving connection graph'
      : state.status === 'rendering'
        ? 'loading geometry'
        : undefined;

  const exploding = explodeState === 'exploding' || explodeState === 'exploded';

  return (
    <>
      <canvas ref={canvasRef} className="by-graph-canvas" />

      {(state.status === 'fetching' || state.status === 'importing' || state.status === 'rendering') && (
        <div className="by-graph-viewer__overlay">
          <div className="by-progress by-graph-viewer__progress" role="progressbar" aria-valuenow={Math.round(progress * 100)}>
            <div className="by-progress__fill" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
          <p className="by-muted">
            {Math.round(progress * 100)}%{phase ? ` · ${phase}` : ''}
          </p>
        </div>
      )}

      {state.status === 'error' && (
        <div className="by-graph-viewer__overlay">
          <p className="by-empty__title">Failed to load</p>
          <p className="by-empty__body">{state.message}</p>
          <button type="button" className="by-btn by-btn--secondary" onClick={onBack}>
            Back to model list
          </button>
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
            <span>{state.graphStats.componentCount} component{state.graphStats.componentCount === 1 ? '' : 's'}</span>
            {sceneStats && <span>{sceneStats.drawCalls} draw calls</span>}
            {state.skippedParts > 0 && (
              <span>{state.skippedParts} part{state.skippedParts === 1 ? '' : 's'} skipped</span>
            )}
          </div>

          <div className="by-graph-legend">
            <span className="by-tag by-tag--structure">out → in</span>
            <span className="by-tag by-tag--outline">peer</span>
          </div>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------

export function GraphExplorer({ onClose }: GraphExplorerProps) {
  const [selected, setSelected] = useState<BundledModelEntry | null>(null);

  return (
    <div className="by-graph-overlay">
      <div className="by-graph-overlay__bar">
        <span className="by-graph-overlay__title">
          {selected ? selected.name : 'Connection graph'}
        </span>
        <button
          type="button"
          className="by-icon-btn"
          aria-label="Close the graph explorer"
          title="Close"
          onClick={onClose}
        >
          <CloseIcon />
        </button>
      </div>

      <div className="by-graph-overlay__body">
        {selected ? (
          <GraphViewer entry={selected} onBack={() => setSelected(null)} />
        ) : (
          <ModelPicker onOpen={setSelected} onClose={onClose} />
        )}
      </div>
    </div>
  );
}
