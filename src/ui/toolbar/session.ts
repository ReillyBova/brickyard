import type { BrickId } from '../../types';
import type { SceneDocument, Transaction } from '../../model/types';
import type { PartDef } from '../../snap/types';

/**
 * The slice of `EditorSession` (`src/scene/interaction/editor.ts`) the toolbar needs.
 * Declared locally rather than importing the class so this module depends on shape, not
 * on scene/interaction internals — the real `EditorSession` satisfies this structurally
 * (confirmed against `canUndo`/`canRedo`/`undoLabel`/`redoLabel`/`undo`/`redo`/`commit`/
 * `selection`/`document`/`subscribe`/`loadDocument`/`mergeDocument`), and so does a test
 * double.
 *
 * Nullable everywhere this is consumed: the toolbar renders before
 * `BuilderCanvas.onSessionReady` fires (see `useEditorSessionOrNull`,
 * `src/scene/interaction/session-context.ts`), so every hook here degrades to
 * disabled-but-visible controls rather than throwing during that first frame.
 */
export interface ToolbarSession {
  readonly document: SceneDocument;
  readonly selection: ReadonlySet<BrickId>;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly undoLabel: string | undefined;
  readonly redoLabel: string | undefined;
  undo(): void;
  redo(): void;
  commit(tx: Transaction): void;
  subscribe(listener: () => void): () => void;
  /** Replace the whole document — opening a saved file, or a fresh sandbox. */
  loadDocument(doc: SceneDocument, parts: Iterable<PartDef>): void;
  /** Add another document's bricks in as a new connected component. Undoable. */
  mergeDocument(doc: SceneDocument, parts: Iterable<PartDef>): void;
}
