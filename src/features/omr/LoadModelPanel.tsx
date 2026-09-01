/**
 * The toolbar's "Load model" action: a compact panel over the chest rail that browses
 * the same bundled corpus `/models` does, without leaving the editor. Building and
 * loading were previously separate places — pick a model, land in the sandbox — this
 * makes loading a second model (or a first one, from a blank sandbox) an action within
 * the editor, the same way restyle is.
 *
 * Picking a model imports it and merges it into the live document
 * (`EditorSession.mergeDocument`) as a new connected component, rather than replacing
 * whatever is already on the baseplate — see `docs/ARCHITECTURE.md`: one scene graph,
 * loaded models are its components.
 */
import { useMemo, useState } from 'react';

import { createNetworkReader } from './network';
import { importModel, RESOLVE_SHARE } from './importModel';
import { useModelIndex, MODELS_BASE } from './modelIndex';
import type { BundledModelEntry } from './types';
import type { SceneDocument } from '../../model/types';
import type { PartDef } from '../../snap/types';
import { PackageIcon, SearchIcon, XIcon } from '../../ui/icons';
import { useTooltip } from '../../ui/tooltip';
import './LoadModelPanel.css';

export interface LoadModelPanelProps {
  /** Called once a picked model has finished importing, with the document to merge in. */
  onLoad: (doc: SceneDocument, parts: Iterable<PartDef>) => void;
  onClose: () => void;
}

type ImportState = { progress: number; phase: string } | { error: string } | null;

export function LoadModelPanel({ onLoad, onClose }: LoadModelPanelProps) {
  const index = useModelIndex();
  const [query, setQuery] = useState('');
  const [importState, setImportState] = useState<ImportState>(null);
  const closeTip = useTooltip({ id: 'load-model-close', label: 'Close load model panel' });

  const models = useMemo(() => (index.status === 'ready' ? index.models : []), [index]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length === 0) return models;
    return models.filter((m) => `${m.name} ${m.setNumber}`.toLowerCase().includes(q));
  }, [models, query]);

  const open = (entry: BundledModelEntry): void => {
    setImportState({ progress: 0, phase: 'fetching' });
    void (async () => {
      try {
        const text = await fetch(`${MODELS_BASE}${entry.mpdFile}`).then((res) => {
          if (!res.ok) throw new Error(`fetching ${entry.mpdFile}: ${res.status} ${res.statusText}`);
          return res.text();
        });
        const { read } = createNetworkReader();
        const result = await importModel(text, entry.name, {
          read,
          onProgress: (progress) =>
            setImportState({
              progress,
              phase: progress < RESOLVE_SHARE ? 'resolving parts' : 'solving connection graph',
            }),
        });
        onLoad(result.document, result.partDefs.values());
        setImportState(null);
        onClose();
      } catch (err) {
        setImportState({ error: String(err) });
      }
    })();
  };

  const busy = importState !== null && !('error' in importState);

  return (
    <div className="by-panel by-load-model-panel">
      <div className="by-panel__head">
        <PackageIcon className="by-load-model-panel__icon" />
        <div className="by-panel__title">Load model</div>
        <button type="button" className="by-icon-btn" aria-label="Close load model panel" onClick={onClose} {...closeTip}>
          <XIcon />
        </button>
      </div>

      <div className="by-panel__body">
        <div className="by-search by-load-model-panel__search">
          <SearchIcon />
          <input
            className="by-input"
            type="search"
            autoFocus
            placeholder={`Search ${models.length || ''} bundled models`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            disabled={busy}
          />
        </div>

        {index.status === 'loading' && <p className="by-faint by-load-model-panel__status">Loading the model list…</p>}
        {index.status === 'error' && (
          <p className="by-faint by-load-model-panel__status">Couldn&rsquo;t load the model list: {index.message}</p>
        )}
        {importState && 'error' in importState && (
          <p className="by-faint by-load-model-panel__status">Couldn&rsquo;t load that model: {importState.error}</p>
        )}
        {importState && !('error' in importState) && (
          <p className="by-faint by-load-model-panel__status by-mono">
            {Math.round(importState.progress * 100)}% · {importState.phase}
          </p>
        )}

        {index.status === 'ready' && (
          <ul className="by-load-model-panel__list">
            {filtered.map((m) => (
              <li key={m.slug}>
                <button
                  type="button"
                  className="by-load-model-panel__item"
                  onClick={() => open(m)}
                  disabled={busy}
                >
                  <span className="by-load-model-panel__item-name">{m.name}</span>
                  <span className="by-load-model-panel__item-meta by-faint">
                    {m.theme} · {m.year} · {m.brickCount.toLocaleString()} bricks
                  </span>
                </button>
              </li>
            ))}
            {filtered.length === 0 && (
              <li className="by-faint by-load-model-panel__status">No models match.</li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
