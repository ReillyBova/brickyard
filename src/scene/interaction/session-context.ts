/**
 * The context object and hooks for `sessionContext.tsx`'s `EditorSessionProvider`,
 * split into a non-component file so Fast Refresh keeps working — mirrors
 * `src/routes/route-context.ts`, which does the same for `router.tsx`.
 */

import { createContext, useContext } from 'react';

import type { EditorSession } from './editor.ts';

export const EditorSessionContext = createContext<EditorSession | null>(null);

/**
 * The live session. Throws if rendered before `BuilderCanvas` has reported one — every
 * consumer of this hook is chrome around the canvas, and chrome that renders before the
 * canvas exists has no session to bind anyway. Use `useEditorSessionOrNull` for a
 * component that legitimately renders during that first frame (a toolbar that disables
 * its buttons until ready, say).
 */
export function useEditorSession(): EditorSession {
  const session = useContext(EditorSessionContext);
  if (!session) {
    throw new Error(
      'useEditorSession: no EditorSession yet. Render this component under EditorSessionProvider, ' +
        'after BuilderCanvas has reported one via onSessionReady — or use useEditorSessionOrNull if ' +
        'it must render before that.',
    );
  }
  return session;
}

/** Non-throwing variant, for a consumer that must render before the canvas mounts. */
export function useEditorSessionOrNull(): EditorSession | null {
  return useContext(EditorSessionContext);
}
