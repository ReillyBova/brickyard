import { useEffect, useState } from 'react';

import { RedoIcon, UndoIcon } from '../icons';
import type { ToolbarSession } from './session';
import type { ToolbarAction } from './types';

const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);
const MOD = isMac ? '⌘' : 'Ctrl';

/** The bits of a keyboard event this module reads — kept minimal so it's easy to fake in a test. */
export interface UndoRedoKeyEvent {
  target: unknown;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  key: string;
  preventDefault(): void;
}

/**
 * The window-level ⌘Z/⌘⇧Z/⌘Y decision, extracted from the effect below so it's testable
 * without mounting React or a DOM — see `useUndoRedo.test.ts`.
 *
 * `BuilderCanvas.tsx` binds the same combo scoped to its own `<canvas>` element (its
 * "Focusable so it can receive keys without a window-level listener" comment) and never
 * calls `stopPropagation` (asserted by `placement.test.ts`'s "never stops propagation on
 * its keydown handler"), so an event with the canvas as `target` still reaches this
 * window listener too. Skipping it here — rather than skipping in `BuilderCanvas` — is
 * what keeps one keystroke from undoing twice once both sides share one `EditorSession`
 * (`onSessionReady`/`EditorSessionProvider`): the canvas's own handler fires once, and
 * this one declines to fire a second time for the same keystroke.
 */
export function handleGlobalUndoRedoKeydown(event: UndoRedoKeyEvent, session: Pick<ToolbarSession, 'undo' | 'redo'>): void {
  if ((event.target as { tagName?: string } | null)?.tagName === 'CANVAS') return;
  const mod = isMac ? event.metaKey : event.ctrlKey;
  if (!mod) return;
  const key = event.key.toLowerCase();
  if (key === 'z' && !event.shiftKey) {
    event.preventDefault();
    session.undo();
  } else if ((key === 'z' && event.shiftKey) || key === 'y') {
    event.preventDefault();
    session.redo();
  }
}

/**
 * Undo/redo actions bound to `session`, plus the standard shortcuts (⌘Z / ⌘⇧Z, and
 * Ctrl+Y as the redo alternative Windows users reach for) registered on `window` while
 * mounted. `src/model/history.ts` is fully tested and has no interface of its own —
 * this hook, and `EditorSession`'s existing `undo()`/`redo()`/`canUndo`/`undoLabel`
 * wrapper around it, are that interface.
 *
 * `session` is nullable because the toolbar renders before `BuilderCanvas` has reported
 * a live session (`useEditorSessionOrNull`) — with no session yet, both actions render
 * disabled rather than throwing.
 */
export function useUndoRedo(session: ToolbarSession | null): readonly [ToolbarAction, ToolbarAction] {
  // Re-render on every history change; the labels and disabled state are read fresh
  // from `session` each render rather than mirrored into local state.
  const [, forceRender] = useState(0);
  useEffect(() => {
    if (!session) return;
    return session.subscribe(() => forceRender((n) => n + 1));
  }, [session]);

  useEffect(() => {
    if (!session) return;
    const onKeyDown = (event: KeyboardEvent): void => handleGlobalUndoRedoKeydown(event, session);
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [session]);

  const undo: ToolbarAction = {
    id: 'undo',
    icon: <UndoIcon />,
    label: session?.undoLabel ? `Undo ${session.undoLabel}` : 'Undo',
    shortcut: [MOD, 'Z'],
    disabled: !session?.canUndo,
    onClick: () => session?.undo(),
  };

  const redo: ToolbarAction = {
    id: 'redo',
    icon: <RedoIcon />,
    label: session?.redoLabel ? `Redo ${session.redoLabel}` : 'Redo',
    shortcut: [MOD, '⇧', 'Z'],
    disabled: !session?.canRedo,
    onClick: () => session?.redo(),
  };

  return [undo, redo];
}
