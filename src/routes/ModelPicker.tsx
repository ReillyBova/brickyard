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
 *
 * `index.json` is the only thing loaded on route entry — a few dozen small records, one
 * per model. The `.mpd` text for a specific model is fetched only once someone opens it
 * (`App.tsx`'s `useModelLoad`), same-origin from `public/models/`. That is the "hosted,
 * fetched on demand" tier `docs/PREBAKE.md` uses for part geometry, applied to whole
 * models: the OMR upstream (`library.ldraw.org`) sends no CORS header, so a browser
 * can't fetch a model file directly from it at runtime — every `.mpd` here was mirrored
 * once at curation time (see `tools/modelCatalog.ts`) rather than proxied live.
 */
import { useEffect, useMemo, useState } from 'react';

import { Link } from './Link';
import './ModelPicker.css';

import { useRoute } from './route-context';
import type { BundledModelEntry } from '../features/omr/types';
import { CategoryMenu } from '../ui/PartsChest/CategoryMenu';
import { SearchIcon } from '../ui/icons';

const MODELS_BASE = `${import.meta.env.BASE_URL}models/`;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

type SizeBucket = 'Small (under 500pc)' | 'Medium (500-2000pc)' | 'Large (2000-5000pc)' | 'Jumbo (5000pc+)';

function sizeBucket(officialPieceCount: number): SizeBucket {
  if (officialPieceCount < 500) return 'Small (under 500pc)';
  if (officialPieceCount < 2000) return 'Medium (500-2000pc)';
  if (officialPieceCount < 5000) return 'Large (2000-5000pc)';
  return 'Jumbo (5000pc+)';
}

const SIZE_BUCKETS: readonly SizeBucket[] = [
  'Small (under 500pc)',
  'Medium (500-2000pc)',
  'Large (2000-5000pc)',
  'Jumbo (5000pc+)',
];

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

interface ModelCardProps {
  entry: BundledModelEntry;
  onOpen: (entry: BundledModelEntry) => void;
}

function ModelCard({ entry, onOpen }: ModelCardProps) {
  return (
    <button
      type="button"
      className="by-model-card"
      onClick={() => onOpen(entry)}
      title={`Open ${entry.name} — ${entry.theme}, ${entry.year}`}
    >
      <span className="by-model-card__name">{entry.name}</span>
      <span className="by-model-card__meta">
        <span className="by-tag by-tag--neutral">{entry.theme}</span>
        <span className="by-tag by-tag--outline">{entry.year}</span>
        {entry.curated === 'jumbo' && (
          <span
            className="by-tag by-tag--accent"
            title="A genuinely large model — good for finding where import and render performance break down."
          >
            stress test size
          </span>
        )}
      </span>
      <span className="by-model-card__stats">
        {entry.officialPieceCount.toLocaleString()} official pieces ·{' '}
        {entry.brickCount.toLocaleString()} bricks · {entry.uniquePartCount} unique parts ·{' '}
        {formatBytes(entry.sizeBytes)}
      </span>
    </button>
  );
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
  const [query, setQuery] = useState('');
  const [theme, setTheme] = useState<string | undefined>(undefined);
  const [size, setSize] = useState<string | undefined>(undefined);

  const models = useMemo(() => (state.status === 'ready' ? state.models : []), [state]);

  const themes = useMemo(
    () => Array.from(new Set(models.map((m) => m.theme))).sort((a, b) => a.localeCompare(b)),
    [models],
  );

  const filtering = query.trim().length > 0 || theme !== undefined || size !== undefined;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return models.filter((m) => {
      if (q.length > 0 && !`${m.name} ${m.setNumber}`.toLowerCase().includes(q)) return false;
      if (theme !== undefined && m.theme !== theme) return false;
      if (size !== undefined && sizeBucket(m.officialPieceCount) !== size) return false;
      return true;
    });
  }, [models, query, theme, size]);

  const popular = useMemo(() => models.filter((m) => m.curated === 'popular'), [models]);

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
          Real published models, sourced from the LDraw Official Model Repository. Pick one to parse,
          resolve every part, and solve its connection graph, then take it apart.
        </p>
      </div>

      <div className="by-model-picker__controls">
        <div className="by-search by-model-picker__search" title="Search by set name or number">
          <SearchIcon />
          <input
            className="by-input"
            type="search"
            placeholder={`Search ${models.length} models by name or set number`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <CategoryMenu categories={themes} value={theme} onChange={setTheme} allLabel="All themes" />
        <CategoryMenu categories={SIZE_BUCKETS} value={size} onChange={setSize} allLabel="Any size" />
      </div>

      {!filtering && popular.length > 0 && (
        <div className="by-model-picker__section">
          <div className="by-eyebrow by-model-picker__section-label">Popular</div>
          <p className="by-model-picker__section-hint">
            Recognisable, quick to load, visually interesting — a deliberate pick, not a sort order.
          </p>
          <ul className="by-model-picker__list">
            {popular.map((m) => (
              <li key={m.slug}>
                <ModelCard entry={m} onOpen={open} />
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="by-model-picker__section">
        {!filtering && <div className="by-eyebrow by-model-picker__section-label">All models</div>}
        {filtering && filtered.length === 0 ? (
          <div className="by-empty">
            <p className="by-empty__title">No models match</p>
            <p className="by-empty__body">
              Try a different set name, number, theme or size — or clear the filters.
            </p>
          </div>
        ) : (
          <ul className="by-model-picker__list">
            {filtered.map((m) => (
              <li key={m.slug}>
                <ModelCard entry={m} onOpen={open} />
              </li>
            ))}
          </ul>
        )}
      </div>

      <Link
        to="sandbox"
        className="by-btn by-btn--secondary by-model-picker__back"
        title="Start with an empty baseplate instead"
      >
        Go to empty sandbox instead
      </Link>
    </div>
  );
}

export { MODELS_BASE };
