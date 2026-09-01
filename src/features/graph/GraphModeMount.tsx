/**
 * The unit to drop into the toolbar's mode switch: reads the live document out of the
 * shared `EditorSession` (`src/scene/interaction/session-context.ts`) and hands it to
 * `GraphMode`, so "the loaded model" and "the sandbox document" explode identically —
 * PR #29 unified the two into one session.
 *
 * `GraphMode` itself stays document-driven and prop-testable; this is the only piece
 * that knows a session exists, kept separate so `GraphMode.tsx` has no compile-time
 * dependency on `src/scene/interaction/`.
 *
 * Uses `useEditorSessionOrNull` rather than the throwing `useEditorSession`: the mode
 * switch could in principle render this before `BuilderCanvas` has reported a session
 * (a deep link straight into graph mode, say), and there's nothing to explode yet in
 * that instant regardless — the empty state `GraphMode` already renders for zero
 * bricks covers both "no session" and "session with nothing placed" the same way.
 *
 * IMPORTANT for whoever wires the mode switch: `BuilderCanvas` reports `null` through
 * `onSessionReady` on unmount (see its cleanup effect), which resets `session` to
 * `null` wherever `App.tsx` holds it. Swapping the viewport with
 * `mode === 'editor' ? <BuilderCanvas ... /> : <GraphModeMount />` therefore destroys
 * the session — and everything it holds, selection included — the instant you leave
 * editor mode, which then shows this component's empty state even with bricks on the
 * baseplate. Keep `BuilderCanvas` mounted across all three modes (toggle its
 * visibility instead, e.g. a wrapping `<div style={{ display: mode === 'editor' ?
 * 'contents' : 'none' }}>`) so the one `EditorSession` survives the switch. Verified
 * this both ways against a real session in the browser while building this.
 */
import { emptyDocument } from '../../model/document.ts';
import { useEditorSessionOrNull } from '../../scene/interaction/session-context.ts';

import { GraphMode } from './GraphMode';

export function GraphModeMount() {
  const session = useEditorSessionOrNull();
  return <GraphMode document={session ? session.document : emptyDocument()} />;
}
