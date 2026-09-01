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
 *
 * `BuilderCanvas.tsx` also binds ⌘Z/⌘⇧Z/⌘Y, scoped to its own `<canvas>` element (see
 * its "Focusable so it can receive keys without a window-level listener" comment) — a
 * deliberate choice so the mouse hand's most common shortcut doesn't need window focus
 * plumbing. This window-level binding covers everywhere else (the toolbar itself, the
 * chest, the color panel) per docs/DESIGN.md's "keyboard control is a real mode, not a
 * fallback" rule, and skips the canvas so the two don't both fire off one keystroke.
 */
export function useUndoRedo(session: UndoRedoSession): readonly [ToolbarAction, ToolbarAction] {
  // Re-render on every history change; the labels and disabled state are read fresh
  // from `session` each render rather than mirrored into local state.
  const [, forceRender] = useState(0);
  useEffect(() => session.subscribe(() => forceRender((n) => n + 1)), [session]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.target as HTMLElement | null)?.tagName === 'CANVAS') return;
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
