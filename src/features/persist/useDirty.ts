/**
 * React wrapper over `createDirtyTracker` (`dirty.ts`), scoped to one `EditorSession`
 * lifetime. Re-renders on every session notification (matching `useUndoRedo`'s pattern)
 * so `dirty` always reflects the latest commit.
 */
import { useEffect, useState } from 'react';

import type { SceneDocument } from '../../model/types';
import type { ToolbarSession } from '../../ui/toolbar/session';
import { createDirtyTracker, type DirtyTracker } from './dirty';

export interface DirtyState {
  readonly dirty: boolean;
  /** Moves the baseline to the document's current state — call after a save or a load. */
  markSaved(): void;
}

/** Tags the tracker with the session it was built for, so a session swap (a fresh
 * `EditorSession` from a canvas remount) rebuilds it instead of comparing against a
 * stale baseline from a different document entirely. */
interface Bound {
  session: ToolbarSession;
  tracker: DirtyTracker;
}

export function useDirty(session: ToolbarSession | null): DirtyState {
  const [bound, setBound] = useState<Bound | null>(null);
  const [, forceRender] = useState(0);

  useEffect(() => {
    if (!session) return;
    setBound({ session, tracker: createDirtyTracker(session.document) });
    return session.subscribe(() => forceRender((n) => n + 1));
  }, [session]);

  const doc: SceneDocument | undefined = session?.document;
  const tracker = bound && bound.session === session ? bound.tracker : null;
  const dirty = doc !== undefined && tracker !== null ? tracker.isDirty(doc) : false;

  return {
    dirty,
    markSaved: () => {
      if (doc !== undefined && tracker) {
        tracker.markSaved(doc);
        forceRender((n) => n + 1);
      }
    },
  };
}
