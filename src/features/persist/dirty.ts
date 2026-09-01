/**
 * Dirty tracking: "have there been commits since the last save."
 *
 * `EditorSession` (`src/scene/interaction/editor.ts`) doesn't expose a commit counter, and
 * this slice doesn't own that file, so the marker is tracked from the outside using only
 * `EditorSession`'s existing public surface: `document` and `subscribe`. `SceneDocument` is
 * immutable and every `commit`/`undo`/`redo`/`loadDocument` produces a fresh object (see
 * `docs/ARCHITECTURE.md`'s "Operations and undo"), so comparing the current document by
 * reference against a remembered baseline is exactly "has anything happened since the
 * marker was set" — cheap, and it never diffs content.
 *
 * The baseline moves on `markSaved()` (after a successful Save) and is meant to be reset
 * by the caller after any document *load* too — opening a file, importing one, or picking
 * a bundled model all start a fresh "nothing to lose yet" state, the same way opening a
 * file in any editor doesn't leave it marked unsaved.
 *
 * Pure: no DOM, no localStorage, no React. `useDirty.ts` wraps this for components.
 */

import type { SceneDocument } from '../../model/types';

export interface DirtyTracker {
  isDirty(doc: SceneDocument): boolean;
  markSaved(doc: SceneDocument): void;
}

export function createDirtyTracker(initial: SceneDocument): DirtyTracker {
  let baseline: SceneDocument = initial;
  return {
    isDirty: (doc) => doc !== baseline,
    markSaved: (doc) => {
      baseline = doc;
    },
  };
}
