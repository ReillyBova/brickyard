/**
 * Binds `RestylePanel` to a live `EditorSession`. Restyle is not a mode of its own —
 * the app has exactly three (editor, graph, render) — it is an action always available
 * within the editor, so this is what the toolbar's paintbrush slot mounts over
 * whatever is already on the baseplate, not a route of its own.
 *
 * Takes the session as a prop rather than reaching for one itself, because nothing
 * today exposes "the canvas's live `EditorSession`" to a panel outside
 * `src/scene/interaction/` — that's a provider this slice doesn't own, still in
 * flight. Whoever mounts this from the toolbar passes the session they already have;
 * that's the entire integration, once the slot and the provider both exist.
 *
 * Every write goes through `session.commit()` — no second path to the renderer. A
 * mapping row is applied only when the user presses Apply; there is no live preview
 * before that, because the only thing this component is given is the session, and
 * `EditorSession` doesn't expose the renderer or `SceneSync` it drives (deliberately —
 * that's `src/scene/interaction/`'s own boundary, not this slice's to reach past).
 * `session.commit()`'s own document diff already rebatches a recolored brick
 * correctly (`reconcile` in `editor.ts`, keyed by `(partId, colorCode)`), which is
 * what makes Apply's feedback effectively instant without this component doing any
 * rendering of its own.
 */
import { useEffect, useMemo, useState } from 'react';

import type { EditorSession } from '../../scene/interaction/editor';
import { LDRAW_PALETTE } from '../../ui/ColorPicker/palette';
import { colorUsage } from './colorUsage';
import { buildRestyleTransaction, type ColorMapping } from './transaction';
import { RestylePanel } from './RestylePanel';

export interface RestyleContainerProps {
  session: EditorSession;
  onClose: () => void;
}

export function RestyleContainer({ session, onClose }: RestyleContainerProps) {
  // `EditorSession` is a mutable class, not immutable state — bumped by `subscribe`
  // on every commit/undo/redo so this re-renders in step with it, the same pattern
  // `BuilderCanvas.tsx` uses.
  const [, setVersion] = useState(0);
  const [mapping, setMapping] = useState<ColorMapping>(new Map());

  useEffect(() => session.subscribe(() => setVersion((v) => v + 1)), [session]);

  const bricks = useMemo(
    () => [...session.document.bricks.values()],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session, session.document],
  );
  const usage = useMemo(() => colorUsage(bricks), [bricks]);
  const changedBrickCount = useMemo(() => {
    if (mapping.size === 0) return 0;
    let n = 0;
    for (const b of bricks) {
      const to = mapping.get(b.colorCode);
      if (to !== undefined && to !== b.colorCode) n++;
    }
    return n;
  }, [bricks, mapping]);

  const onMap = (from: number, to: number): void => {
    setMapping((prev) => {
      const next = new Map(prev);
      if (to === from) next.delete(from);
      else next.set(from, to);
      return next;
    });
  };
  const onResetRow = (from: number): void => {
    setMapping((prev) => {
      if (!prev.has(from)) return prev;
      const next = new Map(prev);
      next.delete(from);
      return next;
    });
  };
  const onResetAll = (): void => setMapping(new Map());

  const onApply = (): void => {
    const tx = buildRestyleTransaction(session.document.bricks.values(), mapping);
    if (tx === null) return;
    session.commit(tx);
    setMapping(new Map());
  };

  return (
    <RestylePanel
      usage={usage}
      palette={LDRAW_PALETTE}
      mapping={mapping}
      onMap={onMap}
      onResetRow={onResetRow}
      onResetAll={onResetAll}
      onApply={onApply}
      onClose={onClose}
      changedBrickCount={changedBrickCount}
    />
  );
}
