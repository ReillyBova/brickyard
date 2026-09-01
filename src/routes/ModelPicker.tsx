/**
 * `/models` — the bundled model picker.
 *
 * Lists the curated corpus in `public/models/` (name, brick count, unique-part count).
 * Opening one hands off to the sandbox rather than a separate read-only viewer: the
 * composition root (`src/App.tsx`) fetches and imports the model, then seeds the same
 * `EditorSession` the sandbox already runs, through `BuilderCanvas`'s `seed` prop. That
 * is the whole point of routing through here — "load a model" and "open the sandbox"
 * differ only in whether the document starts empty or populated, so a loaded model is
 * exactly as editable (select, move, delete, add to, undo) as anything built by hand.
 */
import { useEffect, useState } from 'react';

import { Link } from './Link';
import './ModelPicker.css';

import { useRoute } from './route-context';
import type { BundledModelEntry } from '../features/omr/types';

const MODELS_BASE = `${import.meta.env.BASE_URL}models/`;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

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
  /** Hands the chosen model up to the composition root, which imports and seeds it. */
  onOpenModel: (entry: BundledModelEntry) => void;
}

/**
 * The `/models` route: browse, then hand off to the sandbox. Opening a model both
 * calls `onOpenModel` (so the composition root starts the import) and navigates to
 * `sandbox`, so the two land on the same commit rather than a stale intermediate frame.
 */
export function ModelPicker({ onOpenModel }: ModelPickerProps) {
  const { navigate } = useRoute();
  const state = useModelIndex();

  const open = (entry: BundledModelEntry): void => {
    onOpenModel(entry);
    navigate('sandbox');
  };

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
            <button type="button" className="by-model-card" onClick={() => open(m)}>
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

export { MODELS_BASE };
