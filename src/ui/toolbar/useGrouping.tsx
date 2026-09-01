import { useEffect } from 'react';

import { GroupIcon } from '../icons';
import type { BrickId } from '../../types';
import type { SceneDocument, Transaction } from '../../model/types';
import { buildGroupTransaction, buildUngroupTransaction, canGroup, canUngroup } from './grouping';
import type { ToolbarAction } from './types';

const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);
const MOD = isMac ? '⌘' : 'Ctrl';

/**
 * Group / ungroup actions for the current selection. Deliberately not bound to
 * `EditorSession` — that class (owned by the concurrent selection slice, in
 * `src/scene/interaction/`) has no selection state and no generic way to commit an
 * arbitrary `Transaction` yet. This hook instead takes the three things grouping
 * actually needs — `selection`, `document`, and a `commit` callback — so it works
 * against today's `EditorSession` (via a thin adapter), a future one that grows a
 * `selection` getter and a `commit` method, or a test double. See the toolbar plan's
 * escalation note for the gap this papers over.
 */
export function useGrouping(
  selection: ReadonlySet<BrickId>,
  document: SceneDocument,
  commit: (tx: Transaction) => void,
): readonly [ToolbarAction, ToolbarAction] {
  const doGroup = (): void => {
    if (canGroup(selection)) commit(buildGroupTransaction(selection, document));
  };
  const doUngroup = (): void => {
    const tx = canUngroup(selection, document) ? buildUngroupTransaction(selection, document) : undefined;
    if (tx) commit(tx);
  };

  useEffect(() => {
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
  }, [selection, document, commit]);

  const group: ToolbarAction = {
    id: 'group',
    icon: <GroupIcon />,
    label: 'Group',
    shortcut: [MOD, 'G'],
    disabled: !canGroup(selection),
    onClick: doGroup,
  };

  const ungroup: ToolbarAction = {
    id: 'ungroup',
    icon: <GroupIcon />,
    label: 'Ungroup',
    shortcut: [MOD, '⇧', 'G'],
    disabled: !canUngroup(selection, document),
    onClick: doUngroup,
  };

  return [group, ungroup];
}
