import { describe, expect, it } from 'vitest';

import { createDocument } from '../../model/document';
import { applyOperations, invertOperation } from '../../model/operations';
import { brick, group, testBrickId, testGroupId } from '../../model/testing';
import {
  buildGroupTransaction,
  buildUngroupTransaction,
  canGroup,
  canUngroup,
  selectedGroup,
} from './grouping';

describe('canGroup', () => {
  it('requires at least two bricks', () => {
    expect(canGroup(new Set())).toBe(false);
    expect(canGroup(new Set([testBrickId('a')]))).toBe(false);
    expect(canGroup(new Set([testBrickId('a'), testBrickId('b')]))).toBe(true);
  });
});

describe('buildGroupTransaction', () => {
  it('adds a group and reparents the selection to it in one transaction', () => {
    const doc = createDocument([brick('a'), brick('b'), brick('c')]);
    const selection = new Set([testBrickId('a'), testBrickId('b')]);

    const tx = buildGroupTransaction(selection, doc);
    expect(tx.ops).toHaveLength(2);
    expect(tx.ops[0]).toMatchObject({ type: 'addGroup' });
    expect(tx.ops[1]).toMatchObject({ type: 'reparent' });

    const after = applyOperations(doc, tx.ops);
    const groupId = after.bricks.get(testBrickId('a'))?.groupId;
    expect(groupId).toBeDefined();
    expect(after.bricks.get(testBrickId('b'))?.groupId).toBe(groupId);
    expect(after.bricks.get(testBrickId('c'))?.groupId).toBeUndefined();
    expect(after.groups.has(groupId!)).toBe(true);
  });

  it('reparents a brick out of its old group into the new one', () => {
    const doc = createDocument(
      [brick('a', { groupId: 'g1' }), brick('b')],
      [group('g1')],
    );
    const selection = new Set([testBrickId('a'), testBrickId('b')]);
    const tx = buildGroupTransaction(selection, doc);
    const after = applyOperations(doc, tx.ops);
    const newGroupId = after.bricks.get(testBrickId('a'))?.groupId;
    expect(newGroupId).toBeDefined();
    expect(newGroupId).not.toBe(testGroupId('g1'));
  });

  it('round-trips through undo (invert applied in reverse)', () => {
    const doc = createDocument([brick('a'), brick('b')]);
    const selection = new Set([testBrickId('a'), testBrickId('b')]);
    const tx = buildGroupTransaction(selection, doc);
    const after = applyOperations(doc, tx.ops);

    const inverted = [...tx.ops].reverse().map(invertOperation);
    const restored = applyOperations(after, inverted);

    expect(restored.groups.size).toBe(doc.groups.size);
    expect(restored.bricks.get(testBrickId('a'))?.groupId).toBeUndefined();
  });
});

describe('selectedGroup / canUngroup', () => {
  it('recognizes a selection that is exactly one group', () => {
    const doc = createDocument(
      [brick('a', { groupId: 'g1' }), brick('b', { groupId: 'g1' }), brick('c')],
      [group('g1', 'My group')],
    );
    const selection = new Set([testBrickId('a'), testBrickId('b')]);
    expect(selectedGroup(selection, doc)?.id).toBe(testGroupId('g1'));
    expect(canUngroup(selection, doc)).toBe(true);
  });

  it('rejects a partial selection of a group', () => {
    const doc = createDocument(
      [brick('a', { groupId: 'g1' }), brick('b', { groupId: 'g1' })],
      [group('g1')],
    );
    const selection = new Set([testBrickId('a')]);
    expect(canUngroup(selection, doc)).toBe(false);
  });

  it('rejects a selection spanning two groups', () => {
    const doc = createDocument(
      [brick('a', { groupId: 'g1' }), brick('b', { groupId: 'g2' })],
      [group('g1'), group('g2')],
    );
    const selection = new Set([testBrickId('a'), testBrickId('b')]);
    expect(canUngroup(selection, doc)).toBe(false);
  });

  it('rejects an ungrouped selection', () => {
    const doc = createDocument([brick('a'), brick('b')]);
    const selection = new Set([testBrickId('a'), testBrickId('b')]);
    expect(canUngroup(selection, doc)).toBe(false);
  });
});

describe('buildUngroupTransaction', () => {
  it('removes the group and clears groupId on every member', () => {
    const doc = createDocument(
      [brick('a', { groupId: 'g1' }), brick('b', { groupId: 'g1' })],
      [group('g1')],
    );
    const selection = new Set([testBrickId('a'), testBrickId('b')]);
    const tx = buildUngroupTransaction(selection, doc);
    expect(tx).toBeDefined();
    const after = applyOperations(doc, tx!.ops);
    expect(after.bricks.get(testBrickId('a'))?.groupId).toBeUndefined();
    expect(after.bricks.get(testBrickId('b'))?.groupId).toBeUndefined();
    expect(after.groups.has(testGroupId('g1'))).toBe(false);
  });

  it('returns undefined when the selection is not exactly one group', () => {
    const doc = createDocument([brick('a'), brick('b')]);
    const selection = new Set([testBrickId('a'), testBrickId('b')]);
    expect(buildUngroupTransaction(selection, doc)).toBeUndefined();
  });
});
