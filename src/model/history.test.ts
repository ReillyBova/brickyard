import { describe, expect, it } from 'vitest';

import { createDocument, emptyDocument } from './document.ts';
import {
  applyTransaction,
  canRedo,
  canUndo,
  clearHistory,
  commit,
  createHistory,
  invertTransaction,
  redo,
  redoLabel,
  undo,
  undoLabel,
} from './history.ts';
import { IDENTITY, fromTranslation } from '../math.ts';
import {
  brick,
  edge,
  group,
  mate,
  studOffset,
  testBrickId as bid,
  testEdgeId as edgeId,
  testGroupId as gid,
} from './testing.ts';
import type { BrickInstance, ConnectionEdge, SceneDocument, Transaction } from './types.ts';

/** Whole-document comparison: bricks, groups, graph nodes, edges, and their mates. */
const snapshot = (doc: SceneDocument) => ({
  bricks: [...doc.bricks.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)),
  groups: [...doc.groups.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)),
  nodes: [...doc.graph.nodes.values()]
    .map((n) => ({
      brick: n.brick,
      out: [...n.out].sort(),
      in: [...n.in].sort(),
      peer: [...n.peer].sort(),
    }))
    .sort((a, b) => (a.brick < b.brick ? -1 : 1)),
  edges: [...doc.graph.edges.values()]
    .map((e) => ({ id: e.id, a: e.a, b: e.b, mates: e.mates }))
    .sort((a, b) => (a.id < b.id ? -1 : 1)),
});

const base = (): SceneDocument =>
  createDocument([brick('b1', { transform: studOffset(0, 0, 0) })], [group('g1')]);

/** One gesture, several operations: group the brick, move it, and recolor it. */
const multiOp: Transaction = {
  label: 'Place and dress a brick',
  ops: [
    { type: 'add', bricks: [brick('b2', { transform: IDENTITY })] },
    { type: 'reparent', changes: [{ id: bid('b2'), from: undefined, to: gid('g1') }] },
    { type: 'transformMany', ids: [bid('b1'), bid('b2')], delta: fromTranslation([20, -24, 0]) },
    { type: 'recolor', changes: [{ id: bid('b1'), from: 4, to: 25 }] },
  ],
};

describe('invertTransaction', () => {
  it('inverts each op and reverses the order', () => {
    const inv = invertTransaction(multiOp);
    expect(inv.label).toBe(multiOp.label);
    expect(inv.ops.map((o) => o.type)).toEqual([
      'recolor',
      'transformMany',
      'reparent',
      'remove',
    ]);
  });

  it('is its own inverse in effect', () => {
    const doc = base();
    const round = applyTransaction(applyTransaction(doc, multiOp), invertTransaction(multiOp));
    expect(snapshot(round)).toEqual(snapshot(doc));
  });
});

describe('undo and redo', () => {
  it('restores the document exactly across a multi-operation transaction', () => {
    const start = createHistory(base());
    const before = snapshot(start.doc);
    const after = commit(start, multiOp);
    expect(snapshot(after.doc)).not.toEqual(before);

    const undone = undo(after);
    expect(snapshot(undone.doc)).toEqual(before);

    const redone = redo(undone);
    expect(snapshot(redone.doc)).toEqual(snapshot(after.doc));
  });

  it('round-trips a stack of several transactions in reverse order', () => {
    const states = [createHistory(base())];
    const txs: Transaction[] = [
      multiOp,
      { label: 'Group', ops: [{ type: 'addGroup', group: group('g2', 'Two') }] },
      { label: 'Recolor', ops: [{ type: 'recolor', changes: [{ id: bid('b2'), from: 4, to: 71 }] }] },
    ];
    for (const tx of txs) states.push(commit(states[states.length - 1], tx));

    let current = states[states.length - 1];
    for (let i = states.length - 2; i >= 0; i--) {
      current = undo(current);
      expect(snapshot(current.doc), `after undoing to step ${i}`).toEqual(snapshot(states[i].doc));
    }
    for (let i = 1; i < states.length; i++) {
      current = redo(current);
      expect(snapshot(current.doc), `after redoing to step ${i}`).toEqual(snapshot(states[i].doc));
    }
  });

  it('reports availability and labels', () => {
    const start = createHistory(emptyDocument());
    expect(canUndo(start)).toBe(false);
    expect(canRedo(start)).toBe(false);
    expect(undoLabel(start)).toBeUndefined();

    const after = commit(start, { label: 'Place brick', ops: [{ type: 'add', bricks: [brick('b')] }] });
    expect(canUndo(after)).toBe(true);
    expect(undoLabel(after)).toBe('Place brick');

    const undone = undo(after);
    expect(canRedo(undone)).toBe(true);
    expect(redoLabel(undone)).toBe('Place brick');
  });

  it('is a no-op at the ends of the stacks', () => {
    const start = createHistory(base());
    expect(undo(start)).toBe(start);
    expect(redo(start)).toBe(start);
  });

  it('discards the redo stack on a new commit', () => {
    const start = createHistory(emptyDocument());
    const one = commit(start, { label: 'A', ops: [{ type: 'add', bricks: [brick('a')] }] });
    const undone = undo(one);
    expect(canRedo(undone)).toBe(true);
    const forked = commit(undone, { label: 'B', ops: [{ type: 'add', bricks: [brick('b')] }] });
    expect(canRedo(forked)).toBe(false);
    expect([...forked.doc.bricks.keys()]).toEqual(['b']);
  });

  it('leaves the previous history value untouched', () => {
    const start = createHistory(base());
    const after = commit(start, multiOp);
    expect(start.undoStack).toEqual([]);
    expect(snapshot(start.doc)).toEqual(snapshot(base()));
    expect(after.undoStack).toHaveLength(1);
  });

  it('trims the undo stack to the limit', () => {
    let history = createHistory(emptyDocument(), 2);
    for (const label of ['A', 'B', 'C']) {
      history = commit(history, {
        label,
        ops: [{ type: 'add', bricks: [brick(label)] }],
      });
    }
    expect(history.undoStack.map((t) => t.label)).toEqual(['B', 'C']);
  });

  it('clears both stacks but keeps the document', () => {
    const after = commit(createHistory(base()), multiOp);
    const cleared = clearHistory(after);
    expect(cleared.undoStack).toEqual([]);
    expect(cleared.redoStack).toEqual([]);
    expect(cleared.doc).toBe(after.doc);
  });
});

/**
 * Connectivity is first-class, so a gesture that changes it records the change in the
 * same transaction as its geometry. These are the two gestures where that matters.
 */
describe('gestures that change connectivity', () => {
  /** b2 sits on b1 by two studs; b3 stands apart, one stud pitch further along. */
  const stack = (): SceneDocument =>
    createDocument(
      [
        brick('b1', { transform: studOffset(0, 0, 0) }),
        brick('b2', { transform: studOffset(0, 3, 0) }),
        brick('b3', { transform: studOffset(4, 0, 0) }),
      ],
      [],
      [edge('b1', 'b2', [mate('s1', 'k1'), mate('s2', 'k2')])],
    );

  it('deleting a connected brick and undoing restores nodes, edges and mates', () => {
    const start = createHistory(stack());
    const before = snapshot(start.doc);
    const removed = start.doc.bricks.get(bid('b2')) as BrickInstance;

    const deletion: Transaction = {
      label: 'Delete brick',
      ops: [
        { type: 'disconnect', edges: [start.doc.graph.edges.get(edgeId('b1', 'b2')) as ConnectionEdge] },
        { type: 'remove', bricks: [removed] },
      ],
    };

    const after = commit(start, deletion);
    expect(after.doc.bricks.has(bid('b2'))).toBe(false);
    expect(after.doc.graph.nodes.has(bid('b2'))).toBe(false);
    expect(after.doc.graph.edges.size).toBe(0);

    const undone = undo(after);
    expect(snapshot(undone.doc)).toEqual(before);
    const restored = undone.doc.graph.edges.get(edgeId('b1', 'b2')) as ConnectionEdge;
    expect(restored.mates).toEqual([mate('s1', 'k1'), mate('s2', 'k2')]);
    expect([...undone.doc.graph.component(bid('b1'))].sort()).toEqual(['b1', 'b2']);

    expect(snapshot(redo(undone).doc)).toEqual(snapshot(after.doc));
  });

  /** Dragging b2 off b1 and onto b3: old edge broken, new edge formed, one transaction. */
  const drag = (doc: SceneDocument): Transaction => ({
    label: 'Move brick',
    ops: [
      { type: 'disconnect', edges: [doc.graph.edges.get(edgeId('b1', 'b2')) as ConnectionEdge] },
      { type: 'transformMany', ids: [bid('b2')], delta: fromTranslation([4 * 20, 0, 0]) },
      { type: 'connect', edges: [edge('b2', 'b3', [mate('k1', 's1', 'b')])] },
    ],
  });

  it('a drag that breaks one edge and forms another undoes exactly', () => {
    const start = createHistory(stack());
    const before = snapshot(start.doc);
    const after = commit(start, drag(start.doc));

    expect(after.doc.bricks.get(bid('b2'))?.transform).toEqual(studOffset(4, 3, 0));
    expect(after.doc.graph.edges.has(edgeId('b1', 'b2'))).toBe(false);
    expect(after.doc.graph.edges.has(edgeId('b2', 'b3'))).toBe(true);
    expect([...after.doc.graph.component(bid('b3'))].sort()).toEqual(['b2', 'b3']);
    expect([...after.doc.graph.component(bid('b1'))]).toEqual(['b1']);

    const undone = undo(after);
    expect(snapshot(undone.doc)).toEqual(before);
    expect([...undone.doc.graph.component(bid('b1'))].sort()).toEqual(['b1', 'b2']);

    expect(snapshot(redo(undone).doc)).toEqual(snapshot(after.doc));
  });
});
