/**
 * Group / ungroup as `Transaction`s built from the existing operations
 * (`addGroup`/`removeGroup`/`reparent`, `src/model/operations.ts`) — no new mutation
 * path, just the operations the model contract already defines, used the way they're
 * meant to be used. Pure: no three.js, no DOM.
 *
 * A "group" here is a `GroupDef` plus a `reparent` that points the selected bricks at
 * it, in one transaction: undo removes both together. Ungrouping is the inverse pair.
 * Bricks already in *some* group are reparented into the new one — the operation
 * doesn't nest by parentId; see `mintGroupId` for how a fresh id is minted.
 */

import { mintGroupId } from '../../model/ids';
import type { BrickId } from '../../types';
import type { GroupDef, SceneDocument, Transaction } from '../../model/types';

/** At least two bricks, so a group is never a group of one. */
export function canGroup(selection: ReadonlySet<BrickId>): boolean {
  return selection.size >= 2;
}

/** True when the selection is exactly the membership of one existing group. */
export function selectedGroup(
  selection: ReadonlySet<BrickId>,
  doc: SceneDocument,
): GroupDef | undefined {
  if (selection.size === 0) return undefined;
  const ids = [...selection];
  const groupId = doc.bricks.get(ids[0])?.groupId;
  if (!groupId) return undefined;
  const members = [...doc.bricks.values()].filter((b) => b.groupId === groupId);
  if (members.length !== selection.size) return undefined;
  if (!members.every((b) => selection.has(b.id))) return undefined;
  return doc.groups.get(groupId);
}

export function canUngroup(selection: ReadonlySet<BrickId>, doc: SceneDocument): boolean {
  return selectedGroup(selection, doc) !== undefined;
}

/** Group the current selection. Caller should have checked `canGroup` first. */
export function buildGroupTransaction(
  selection: ReadonlySet<BrickId>,
  doc: SceneDocument,
  name = 'Group',
): Transaction {
  const ids = [...selection];
  const groupDef: GroupDef = { id: mintGroupId(), name };
  return {
    label: 'Group',
    ops: [
      { type: 'addGroup', group: groupDef },
      {
        type: 'reparent',
        changes: ids.map((id) => ({
          id,
          from: doc.bricks.get(id)?.groupId,
          to: groupDef.id,
        })),
      },
    ],
  };
}

/** Ungroup. Caller should have checked `canUngroup` first. */
export function buildUngroupTransaction(
  selection: ReadonlySet<BrickId>,
  doc: SceneDocument,
): Transaction | undefined {
  const groupDef = selectedGroup(selection, doc);
  if (!groupDef) return undefined;
  const ids = [...selection];
  return {
    label: 'Ungroup',
    ops: [
      {
        type: 'reparent',
        changes: ids.map((id) => ({
          id,
          from: groupDef.id,
          to: undefined,
        })),
      },
      { type: 'removeGroup', group: groupDef },
    ],
  };
}
