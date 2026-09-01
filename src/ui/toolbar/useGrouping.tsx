import { useEffect } from 'react';

import { GroupIcon } from '../icons';
import type { BrickId } from '../../types';
import { buildGroupTransaction, buildUngroupTransaction, canGroup, canUngroup } from './grouping';
import type { ToolbarSession } from './session';
import type { ToolbarAction } from './types';

const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);
const MOD = isMac ? '⌘' : 'Ctrl';

const EMPTY_SELECTION: ReadonlySet<BrickId> = new Set();

/**
 * Group / ungroup actions for `session`'s current selection, built as `Transaction`s
 * from `src/model/operations.ts` (see `grouping.ts`) and applied through
 * `session.commit` — the one writer, not a parallel mutation path.
 *
 * `session` is nullable because the toolbar renders before `BuilderCanvas` has reported
 * a live session (`useEditorSessionOrNull`) — with no session yet, both actions render
 * disabled rather than throwing.
 */
export function useGrouping(session: ToolbarSession | null): readonly [ToolbarAction, ToolbarAction] {
  const selection = session?.selection ?? EMPTY_SELECTION;
  const document = session?.document;

  const doGroup = (): void => {
    if (!session || !document) return;
    if (canGroup(selection)) session.commit(buildGroupTransaction(selection, document));
  };
  const doUngroup = (): void => {
    if (!session || !document) return;
    const tx = canUngroup(selection, document) ? buildUngroupTransaction(selection, document) : undefined;
    if (tx) session.commit(tx);
  };

  useEffect(() => {
    if (!session) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      const mod = isMac ? event.metaKey : event.ctrlKey;
      if (!mod || event.key.toLowerCase() !== 'g') return;
      event.preventDefault();
      if (event.shiftKey) doUngroup();
      else doGroup();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, selection, document]);

  const group: ToolbarAction = {
    id: 'group',
    icon: <GroupIcon />,
    label: 'Group',
    shortcut: [MOD, 'G'],
    disabled: !document || !canGroup(selection),
    onClick: doGroup,
  };

  const ungroup: ToolbarAction = {
    id: 'ungroup',
    icon: <GroupIcon />,
    label: 'Ungroup',
    shortcut: [MOD, '⇧', 'G'],
    disabled: !document || !canUngroup(selection, document),
    onClick: doUngroup,
  };

  return [group, ungroup];
}
