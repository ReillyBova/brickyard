/**
 * `/restyle` — the mount point for bulk semantic recolor, until the toolbar's
 * paintbrush slot lands and can open this panel over the real editor instead.
 *
 * Built the same way `src/routes/ModelPicker.tsx`'s viewer is: a bundled model loaded
 * through `importModel` straight into `SceneRenderer`, imported from `src/scene/`
 * rather than going through `src/scene/interaction/` (owned elsewhere). At the time this
 * was written, the live `EditorSession` this app will eventually use exposed only
 * `place`/`remove`, with no generic way to commit an arbitrary `Transaction` — so this
 * keeps its own `History` using the exact pure primitives (`commit`, `undo`, `redo`)
 * `EditorSession` wraps internally, seeded from the imported document.
 *
 * `EditorSession` is gaining a generic `commit(tx: Transaction)` (see the in-flight
 * `src/scene/interaction/editor.ts`, not in this worktree yet), whose document diff
 * detects a `colorCode` change and rebatches the renderer itself — remove-plus-re-add,
 * the same trick `syncRenderedColors` below does by hand. `buildRestyleTransaction`
 * already only *builds* a `Transaction` and never commits one itself, so once that
 * lands, swapping the call site below from `setHistory(commit(history, tx))` to
 * `session.commit(tx)` is a one-line change — and at that point `syncRenderedColors`'s
 * manual `removeBrick`/`addBrick` loop becomes redundant with the session's own
 * reconcile-diff and should be deleted, since one rebatch path is better than two.
 *
 * Live preview and Apply share that one write path to the renderer in the meantime:
 * `syncRenderedColors` rebatches whatever differs between what's on screen and
 * "document color, remapped" — Apply changes the document (so the mapping's targets
 * become the new document colors), reset changes the mapping back — and the same
 * effect reconciles the renderer either way. There is no separate preview-only render
 * code today, and there shouldn't be one after the swap either.
 */
import { useEffect, useMemo, useRef, useState } from 'react';

import { SceneRenderer } from '../../scene/SceneRenderer.ts';
import { importModel, RESOLVE_SHARE, type ImportResult } from '../omr/importModel';
import { createNetworkReader } from '../omr/network';
import type { BundledModelEntry } from '../omr/types';
import {
  canRedo,
  canUndo,
  commit,
  createHistory,
  redo,
  redoLabel,
  undo,
  undoLabel,
  type History,
} from '../../model';
import type { BrickId } from '../../types';
import { LDRAW_PALETTE } from '../../ui/ColorPicker/palette';
import { PaintbrushIcon, Redo2Icon, Undo2Icon } from '../../ui/icons';
import { Link } from '../../routes/Link';
import { colorUsage } from './colorUsage';
import { buildRestyleTransaction, type ColorMapping } from './transaction';
import { RestylePanel } from './RestylePanel';
import './RestyleStudio.css';

const MODELS_BASE = `${import.meta.env.BASE_URL}models/`;

// ---------------------------------------------------------------------------
// Model list — trimmed down from ModelPicker.tsx's own list, this route's slice.
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

function ModelList({ onOpen }: { onOpen: (entry: BundledModelEntry) => void }) {
  const state = useModelIndex();

  return (
    <div className="by-restyle-picker">
      <div className="by-restyle-picker__header">
        <PaintbrushIcon />
        <h1 className="by-restyle-picker__heading">Restyle a model</h1>
        <p className="by-restyle-picker__subheading">
          Pick a bundled model, then remap its colors — an autumn version of a set that was never
          sold in those colors.
        </p>
      </div>

      {state.status === 'loading' && <p className="by-empty__body">Loading the model list…</p>}
      {state.status === 'error' && <p className="by-empty__body">Couldn&rsquo;t load the model list: {state.message}</p>}
      {state.status === 'ready' && state.models.length === 0 && (
        <p className="by-empty__body">No bundled models yet.</p>
      )}
      {state.status === 'ready' && state.models.length > 0 && (
        <ul className="by-restyle-picker__list">
          {state.models.map((m) => (
            <li key={m.slug}>
              <button type="button" className="by-restyle-card" onClick={() => onOpen(m)}>
                <span className="by-restyle-card__name">{m.name}</span>
                <span className="by-restyle-card__stats">
                  {m.brickCount.toLocaleString()} bricks · {m.uniquePartCount} unique parts
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <Link to="landing" className="by-btn by-btn--secondary">
        Back
      </Link>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Studio — a loaded model, rendered, with the restyle panel wired to it.
// ---------------------------------------------------------------------------

type LoadState =
  | { status: 'loading'; progress: number; phase: string }
  | { status: 'ready'; result: ImportResult }
  | { status: 'error'; message: string };

function Studio({ entry, onBack }: { entry: BundledModelEntry; onBack: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<SceneRenderer | null>(null);
  const [load, setLoad] = useState<LoadState>({ status: 'loading', progress: 0, phase: 'fetching' });
  const [history, setHistory] = useState<History | null>(null);
  const [mapping, setMapping] = useState<ColorMapping>(new Map());
  const [panelOpen, setPanelOpen] = useState(true);
  /** What color each brick is currently rendered as — diffed against "document color,
   * remapped" on every render to decide what the renderer needs rebatched. */
  const renderedColor = useRef(new Map<BrickId, number>());

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;

    const renderer = new SceneRenderer(canvas);
    rendererRef.current = renderer;
    let disposed = false;

    const run = async (): Promise<void> => {
      setLoad({ status: 'loading', progress: 0, phase: 'fetching' });
      const text = await fetch(`${MODELS_BASE}${entry.mpdFile}`).then((res) => {
        if (!res.ok) throw new Error(`fetching ${entry.mpdFile}: ${res.status} ${res.statusText}`);
        return res.text();
      });
      if (disposed) return;

      const { read } = createNetworkReader();
      const result = await importModel(text, entry.name, {
        read,
        onProgress: (progress) => {
          if (!disposed) {
            setLoad({
              status: 'loading',
              progress,
              phase: progress < RESOLVE_SHARE ? 'resolving parts' : 'solving connection graph',
            });
          }
        },
      });
      if (disposed) return;

      setLoad({ status: 'loading', progress: 1, phase: 'loading geometry' });
      for (const brick of result.document.bricks.values()) {
        if (disposed) return;
        try {
          await renderer.addBrick(brick);
          renderedColor.current.set(brick.id, brick.colorCode);
        } catch {
          // Fallback behaviour per docs/ARCHITECTURE.md: a part that fails to load
          // degrades that brick, never the whole model.
        }
      }
      if (disposed) return;
      renderer.frameAll();
      renderer.start();

      setHistory(createHistory(result.document));
      setLoad({ status: 'ready', result });
    };

    void run().catch((err: unknown) => {
      if (!disposed) setLoad({ status: 'error', message: String(err) });
    });

    const onResize = (): void => renderer.resize(canvas.clientWidth, canvas.clientHeight);
    window.addEventListener('resize', onResize);
    onResize();

    return () => {
      disposed = true;
      window.removeEventListener('resize', onResize);
      renderer.dispose();
      rendererRef.current = null;
    };
    // One renderer + one import per model opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry]);

  // The one place that ever calls addBrick/removeBrick for a color change — preview
  // and Apply both flow through this, never a second render path. Runs whenever the
  // document changes (undo/redo/apply) or the mapping does (live preview).
  useEffect(() => {
    const renderer = rendererRef.current;
    if (renderer === null || history === null) return;

    for (const brick of history.doc.bricks.values()) {
      const target = mapping.get(brick.colorCode) ?? brick.colorCode;
      const rendered = renderedColor.current.get(brick.id) ?? brick.colorCode;
      if (rendered !== target) {
        renderer.removeBrick(brick.id);
        void renderer.addBrick({ ...brick, colorCode: target });
        renderedColor.current.set(brick.id, target);
      }
    }
  }, [history, mapping]);

  const bricks = useMemo(() => (history ? [...history.doc.bricks.values()] : []), [history]);
  const usage = useMemo(() => colorUsage(bricks), [bricks]);
  const changedBrickCount = useMemo(() => {
    if (mapping.size === 0) return 0;
    let n = 0;
    for (const b of bricks) {
      const to = mapping.get(b.colorCode);
      if (to !== undefined && to !== b.colorCode) n++;
    }
    return n;
  }, [bricks, mapping]);

  const setMap = (from: number, to: number): void => {
    setMapping((prev) => {
      const next = new Map(prev);
      if (to === from) next.delete(from);
      else next.set(from, to);
      return next;
    });
  };
  const resetRow = (from: number): void => {
    setMapping((prev) => {
      if (!prev.has(from)) return prev;
      const next = new Map(prev);
      next.delete(from);
      return next;
    });
  };
  const resetAll = (): void => setMapping(new Map());

  const apply = (): void => {
    if (history === null) return;
    const tx = buildRestyleTransaction(history.doc.bricks.values(), mapping);
    if (tx === null) return;
    // A real EditorSession.commit(tx) replaces this call once the interaction slice
    // exposes one — buildRestyleTransaction already hands back a plain Transaction for
    // exactly that swap.
    setHistory(commit(history, tx));
    setMapping(new Map());
  };

  const doUndo = (): void => {
    if (history === null || !canUndo(history)) return;
    setHistory(undo(history));
  };
  const doRedo = (): void => {
    if (history === null || !canRedo(history)) return;
    setHistory(redo(history));
  };

  const progress = load.status === 'loading' ? load.progress : 1;
  const phase = load.status === 'loading' ? load.phase : undefined;

  return (
    <div className="by-restyle-studio">
      <canvas ref={canvasRef} className="by-restyle-studio__canvas" />

      {load.status !== 'ready' && load.status !== 'error' && (
        <div className="by-restyle-studio__overlay">
          <div className="by-progress" role="progressbar" aria-valuenow={Math.round(progress * 100)}>
            <div className="by-progress__fill" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
          <p className="by-restyle-studio__overlay-text">
            {Math.round(progress * 100)}%{phase ? ` · ${phase}` : ''}
          </p>
        </div>
      )}
      {load.status === 'error' && (
        <div className="by-restyle-studio__overlay">
          <p className="by-restyle-studio__overlay-text">Failed: {load.message}</p>
        </div>
      )}

      <div className="by-restyle-studio__toolbar">
        <button type="button" className="by-btn by-btn--secondary by-btn--sm" onClick={onBack}>
          ← Back
        </button>
        <div className="by-tool-group">
          <button
            type="button"
            className={`by-icon-btn${panelOpen ? ' is-active' : ''}`}
            aria-label="Restyle"
            aria-pressed={panelOpen}
            title="Restyle"
            onClick={() => setPanelOpen((v) => !v)}
          >
            <PaintbrushIcon />
          </button>
          <button
            type="button"
            className="by-icon-btn"
            aria-label={history ? `Undo${canUndo(history) ? `: ${undoLabel(history)}` : ''}` : 'Undo'}
            title={history && canUndo(history) ? `Undo: ${undoLabel(history)}` : 'Undo'}
            onClick={doUndo}
            disabled={history === null || !canUndo(history)}
          >
            <Undo2Icon />
          </button>
          <button
            type="button"
            className="by-icon-btn"
            aria-label={history ? `Redo${canRedo(history) ? `: ${redoLabel(history)}` : ''}` : 'Redo'}
            title={history && canRedo(history) ? `Redo: ${redoLabel(history)}` : 'Redo'}
            onClick={doRedo}
            disabled={history === null || !canRedo(history)}
          >
            <Redo2Icon />
          </button>
        </div>
      </div>

      {panelOpen && (
        <div className="by-restyle-studio__panel">
          <RestylePanel
            usage={usage}
            palette={LDRAW_PALETTE}
            mapping={mapping}
            onMap={setMap}
            onResetRow={resetRow}
            onResetAll={resetAll}
            onApply={apply}
            onClose={() => setPanelOpen(false)}
            changedBrickCount={changedBrickCount}
          />
        </div>
      )}

      <div className="by-statusbar by-restyle-studio__status">
        <span>{bricks.length.toLocaleString()} bricks</span>
        <span>{usage.length} colors</span>
        {history && canUndo(history) && <span>{undoLabel(history)}</span>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export function RestyleStudio() {
  const [selected, setSelected] = useState<BundledModelEntry | null>(null);

  if (selected) return <Studio entry={selected} onBack={() => setSelected(null)} />;
  return <ModelList onOpen={setSelected} />;
}
