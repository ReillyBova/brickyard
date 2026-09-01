/**
 * React access to the one live `EditorSession` backing the visible canvas.
 *
 * `BuilderCanvas` creates the session imperatively (it's a plain class, not a React
 * value) and reports it upward through `onSessionReady`; the composition root lifts
 * that into state and wraps the tree — canvas, toolbar, chest, restyle panel, graph
 * view — in `EditorSessionProvider` so every one of them binds the same instance
 * `useEditorSession` (`./session-context.ts`) returns. There must be exactly one
 * `EditorSession` alive per canvas: a second one, bound by some other panel because it
 * had no way to reach this one, is precisely the desync the single-writer design in
 * `editor.ts` exists to prevent.
 */

import type { ReactNode } from 'react';

import { EditorSessionContext } from './session-context.ts';
import type { EditorSession } from './editor.ts';

export function EditorSessionProvider({
  session,
  children,
}: {
  session: EditorSession | null;
  children: ReactNode;
}) {
  return <EditorSessionContext.Provider value={session}>{children}</EditorSessionContext.Provider>;
}
