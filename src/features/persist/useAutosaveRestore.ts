/**
 * Restores the `localStorage` autosave once, on mount — the "a refresh doesn't lose
 * work" half of the persistence slice. Shaped exactly like `App.tsx`'s `useModelLoad`
 * (same `DocumentSeed`/progress-state contract `BuilderCanvas` already accepts) so the
 * composition root can feed either source into the same `seed` prop and progress
 * overlay without a parallel code path.
 *
 * `enabled` lets the caller suppress this when something else already claims the first
 * seed — opening `/sandbox?model=...` from the picker takes priority over an autosave.
 */
import { useEffect, useState } from 'react';

import type { DocumentSeed } from '../../scene/interaction/BuilderCanvas.tsx';
import type { SceneDocument } from '../../model/types';
import { readAutosave } from './autosave';
import { resolveDocumentParts } from './partResolve';
import { parseDocument } from '../../model/serialize';

export type AutosaveRestoreState = { progress: number; phase: string } | { error: string } | null;

export function useAutosaveRestore(enabled: boolean): {
  seed: DocumentSeed | undefined;
  state: AutosaveRestoreState;
  clearSeed: () => void;
} {
  const [seed, setSeed] = useState<DocumentSeed | undefined>(undefined);
  const [state, setState] = useState<AutosaveRestoreState>(null);

  useEffect(() => {
    if (!enabled) return;
    const saved = readAutosave();
    if (!saved) return;

    let cancelled = false;
    let doc: SceneDocument;
    try {
      doc = parseDocument(saved);
    } catch {
      // A corrupted or stale-format autosave shouldn't block opening the app.
      return;
    }
    if (doc.bricks.size === 0) return;

    setState({ progress: 0, phase: 'restoring autosave' });
    void resolveDocumentParts(doc, {
      onProgress: (progress) => {
        if (!cancelled) setState({ progress, phase: 'restoring autosave' });
      },
    })
      .then((parts) => {
        if (cancelled) return;
        setSeed({ document: doc, parts: [...parts.values()] });
        setState(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ error: String(err) });
      });

    return () => {
      cancelled = true;
    };
    // Runs once per `enabled` transition: re-running on every render would re-offer the
    // same autosave after the caller clears its seed.
  }, [enabled]);

  return { seed, state, clearSeed: () => setSeed(undefined) };
}
