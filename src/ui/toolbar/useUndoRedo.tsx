import { useEffect, useState } from 'react';

import { RedoIcon, UndoIcon } from '../icons';
import type { ToolbarAction } from './types';

/**
 * The read-only slice of `EditorSession` (`src/scene/interaction/editor.ts`) this hook
 * needs. Declared locally rather than importing the class so this file only depends on
 * shape, not on scene/interaction internals — any object satisfying this (the real
 * session, a test double) works.
 */
export interface UndoRedoSession {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly undoLabel: string | undefined;
  readonly redoLabel: string | undefined;
  undo(): void;
  redo(): void;
  subscribe(listener: () => void): () => void;
}

const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);
const MOD = isMac ? '⌘' : 'Ctrl';

/**
 * Undo/redo actions bound to `session`, plus the standard shortcuts (⌘Z / ⌘⇧Z, and
 * Ctrl+Y as the redo alternative Windows users reach for) registered on `window` while
 * mounted. `src/model/history.ts` is fully tested and has no interface of its own —
 * this hook, and `EditorSession`'s existing `undo()`/`redo()`/`canUndo`/`undoLabel`
 * wrapper around it, are that interface.
 */
export function useUndoRedo(session: UndoRedoSession): readonly [ToolbarAction, ToolbarAction] {
  // Re-render on every history change; the labels and disabled state are read fresh
  // from `session` each render rather than mirrored into local state.
  const [, forceRender] = useState(0);
  useEffect(() => session.subscribe(() => forceRender((n) => n + 1)), [session]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
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
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [session]);

  const undo: ToolbarAction = {
    id: 'undo',
    icon: <UndoIcon />,
    label: session.undoLabel ? `Undo ${session.undoLabel}` : 'Undo',
    shortcut: [MOD, 'Z'],
    disabled: !session.canUndo,
    onClick: () => session.undo(),
  };

  const redo: ToolbarAction = {
    id: 'redo',
    icon: <RedoIcon />,
    label: session.redoLabel ? `Redo ${session.redoLabel}` : 'Redo',
    shortcut: [MOD, '⇧', 'Z'],
    disabled: !session.canRedo,
    onClick: () => session.redo(),
  };

  return [undo, redo];
}
