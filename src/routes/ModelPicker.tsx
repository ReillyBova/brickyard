/**
 * `/models` — the bundled model picker.
 *
 * Lists the curated corpus in `public/models/` (name, brick count, unique-part count)
 * and opens one into a self-contained viewer built on `SceneRenderer` directly — the
 * same render system the sandbox editor uses, imported from `src/scene/` rather than
 * `src/scene/interaction/`, which this slice does not own. That keeps model loading
 * demonstrably real (a model picked here really renders, with real geometry and a real
 * frame loop) without editing the interaction layer or the composition root.
 *
 * Per `docs/DESIGN.md` rule 7 ("no spinners where we know the number"), import reports
 * `0..1` (`src/features/omr/importModel.ts`) and this shows the bar and the percentage,
 * never an indeterminate spinner once that first progress message arrives.
 */
import { useEffect, useRef, useState } from 'react';

import { Link } from './Link';
import './ModelPicker.css';

import { SceneRenderer, type SceneStats } from '../scene/SceneRenderer.ts';
import { importModel, RESOLVE_SHARE, type ImportResult } from '../features/omr/importModel';
import { createNetworkReader } from '../features/omr/network';
import type { BundledModelEntry } from '../features/omr/types';

const MODELS_BASE = `${import.meta.env.BASE_URL}models/`;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

// ---------------------------------------------------------------------------
// List
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

interface ModelListProps {
  onOpen: (entry: BundledModelEntry) => void;
}

function ModelList({ onOpen }: ModelListProps) {
  const state = useModelIndex();

  if (state.status === 'loading') {
    // A directory listing is a known-fast same-origin fetch, not an open-ended wait —
    // per docs/DESIGN.md this is a placeholder standing in for a known-fast fetch, the
    // same reasoning PartTile.tsx documents for its own thumbnail gap, not a spinner
    // claiming an unknown duration.
    return (
      <div className="by-model-picker">
        <p className="by-empty__body">Loading the model list…</p>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="by-model-picker">
        <div className="by-empty">
          <p className="by-empty__title">Couldn&rsquo;t load the model list</p>
          <p className="by-empty__body">{state.message}</p>
          <Link to="sandbox" className="by-btn by-btn--primary by-model-picker__back">
            Go to sandbox
          </Link>
        </div>
      </div>
    );
  }

  if (state.models.length === 0) {
    return (
      <div className="by-model-picker">
        <div className="by-empty">
          <p className="by-empty__title">No bundled models yet</p>
          <p className="by-empty__body">
            Run <code>npm run build-model-manifests</code> after adding `.mpd` files to{' '}
            <code>public/models/</code>.
          </p>
          <Link to="sandbox" className="by-btn by-btn--primary by-model-picker__back">
            Go to sandbox
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="by-model-picker">
      <div className="by-model-picker__header">
        <h1 className="by-model-picker__heading">Bundled models</h1>
        <p className="by-model-picker__subheading">
          Real published models, fetched once and shipped with the app. Pick one to parse, resolve
          every part, and solve its connection graph, then take it apart.
        </p>
      </div>
      <ul className="by-model-picker__list">
        {state.models.map((m) => (
          <li key={m.slug}>
            <button type="button" className="by-model-card" onClick={() => onOpen(m)}>
              <span className="by-model-card__name">{m.name}</span>
              <span className="by-model-card__stats">
                {m.brickCount.toLocaleString()} bricks · {m.uniquePartCount} unique parts ·{' '}
                {formatBytes(m.sizeBytes)}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <Link to="sandbox" className="by-btn by-btn--secondary by-model-picker__back">
        Go to empty sandbox instead
      </Link>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Viewer
// ---------------------------------------------------------------------------

type LoadState =
  | { status: 'fetching' }
  | { status: 'importing'; progress: number }
  | { status: 'rendering'; result: ImportResult; importMs: number }
  | { status: 'ready'; result: ImportResult; importMs: number; renderMs: number }
  | { status: 'error'; message: string };

interface ModelViewerProps {
  entry: BundledModelEntry;
  onBack: () => void;
}

function ModelViewer({ entry, onBack }: ModelViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<LoadState>({ status: 'fetching' });
  const [stats, setStats] = useState<SceneStats | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;

    const renderer = new SceneRenderer(canvas);
    let disposed = false;
    let statsHandle: number | null = null;

    const run = async (): Promise<void> => {
      const importStart = performance.now();
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
      const importMs = performance.now() - importStart;
      setState({ status: 'rendering', result, importMs });

      const renderStart = performance.now();
      await renderer.loadDocument(result.document.bricks.values());
      if (disposed) return;
      renderer.frameAll();
      const renderMs = performance.now() - renderStart;
      setState({ status: 'ready', result, importMs, renderMs });

      renderer.start();
      statsHandle = window.setInterval(() => {
        if (!disposed) setStats(renderer.getStats());
      }, 500);
    };

    void run().catch((err: unknown) => {
      if (!disposed) setState({ status: 'error', message: String(err) });
    });

    const onResize = (): void => renderer.resize(canvas.clientWidth, canvas.clientHeight);
    window.addEventListener('resize', onResize);

    return () => {
      disposed = true;
      if (statsHandle !== null) window.clearInterval(statsHandle);
      window.removeEventListener('resize', onResize);
      renderer.dispose();
    };
    // `entry` is a stable object per selection; the effect intentionally owns one
    // renderer lifecycle per model opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry]);

  const progress =
    state.status === 'importing'
      ? state.progress
      : state.status === 'rendering' || state.status === 'ready'
        ? 1
        : 0;
  const phase =
    state.status === 'importing'
      ? state.progress < RESOLVE_SHARE
        ? 'resolving parts'
        : 'solving connection graph'
      : state.status === 'rendering'
        ? 'loading geometry'
        : undefined;

  return (
    <div className="by-model-viewer">
      <div className="by-model-viewer__header">
        <button type="button" className="by-btn by-btn--secondary by-btn--sm" onClick={onBack}>
          ← Back
        </button>
        <span className="by-model-viewer__title">{entry.name}</span>
      </div>

      <div className="by-model-viewer__canvas-wrap">
        <canvas ref={canvasRef} className="by-model-viewer__canvas" />
        {state.status !== 'ready' && state.status !== 'error' && (
          <div className="by-model-viewer__overlay">
            <div className="by-progress" role="progressbar" aria-valuenow={Math.round(progress * 100)}>
              <div className="by-progress__fill" style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
            <p className="by-model-viewer__overlay-text">
              {Math.round(progress * 100)}%{phase ? ` · ${phase}` : ''}
            </p>
          </div>
        )}
        {state.status === 'error' && (
          <div className="by-model-viewer__overlay">
            <p className="by-model-viewer__overlay-text">Failed: {state.message}</p>
          </div>
        )}
      </div>

      <div className="by-statusbar by-model-viewer__status">
        {state.status === 'ready' || state.status === 'rendering' ? (
          <>
            <span>{state.result.brickCount.toLocaleString()} bricks</span>
            <span>{state.result.edgeCount.toLocaleString()} edges</span>
            <span>import {Math.round(state.importMs)} ms</span>
            {state.status === 'ready' && <span>geometry {Math.round(state.renderMs)} ms</span>}
            {stats && <span>{stats.frameTimeMs > 0 ? Math.round(1000 / stats.frameTimeMs) : 0} fps</span>}
            {stats && <span>{stats.drawCalls} draw calls</span>}
          </>
        ) : (
          <span>{entry.brickCount.toLocaleString()} bricks · {entry.uniquePartCount} unique parts</span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export function ModelPicker() {
  const [selected, setSelected] = useState<BundledModelEntry | null>(null);

  if (selected) {
    return <ModelViewer entry={selected} onBack={() => setSelected(null)} />;
  }
  return <ModelList onOpen={setSelected} />;
}
