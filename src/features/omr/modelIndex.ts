/**
 * Fetches the bundled model catalog (`public/models/index.json`) — the one piece of
 * state anything that lists bundled models needs, shared between the full `/models`
 * route (`src/routes/ModelPicker.tsx`) and the toolbar's compact in-editor loader
 * (`LoadModelPanel.tsx`) so both read the same index through the same fetch.
 */
import { useEffect, useState } from 'react';

import type { BundledModelEntry } from './types';

export const MODELS_BASE = `${import.meta.env.BASE_URL}models/`;

export type ModelIndexState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; models: readonly BundledModelEntry[] };

export function useModelIndex(): ModelIndexState {
  const [state, setState] = useState<ModelIndexState>({ status: 'loading' });

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
