/**
 * `localStorage` autosave, wired to a live `EditorSession`. Convenience only, per
 * `docs/ROADMAP.md`: it protects against a refresh, not a substitute for Save. Every
 * commit rewrites the stored copy; nothing here participates in the dirty/save system in
 * `useDirty.ts` or `useFileActions.tsx`.
 */
import { useEffect, useRef } from 'react';

import { stringifyDocument } from '../../model/serialize';
import type { ToolbarSession } from '../../ui/toolbar/session';
import { writeAutosave } from './autosave';

/** Bricks below this are cheap enough to stringify synchronously on every commit. */
const DEBOUNCE_MS = 500;

export function useAutosave(session: ToolbarSession | null): void {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!session) return;
    const save = () => writeAutosave(stringifyDocument(session.document));

    const scheduled = () => {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(save, DEBOUNCE_MS);
    };

    const unsubscribe = session.subscribe(scheduled);
    return () => {
      unsubscribe();
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, [session]);
}
