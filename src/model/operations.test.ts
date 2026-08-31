import { describe, expect, it } from 'vitest';

import type { Mat4 } from '../types';
import { connectBricks, createDocument, emptyDocument } from './document';
import { edgeIdFor } from './graph';
import { fromTranslation, identity, invert as invertMatrix, multiply } from './matrix';
import { applyOperation, applyOperations, invertOperation } from './operations';
import { brick, group, link, mate, studOffset } from './testing';
import type { Operation, SceneDocument } from './types';

/** Comparable form of a document, including the full graph structure. */
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
  edges: [...doc.graph.edges.values()].sort((a, b) => (a.id < b.id ? -1 : 1)),
});

const base = (): SceneDocument =>
  createDocument(
    [
      brick('b1', { transform: studOffset(0, 0, 0), colorCode: 4 }),
      brick('b2', { transform: studOffset(1, 3, 0), colorCode: 15, groupId: 'g1' }),
      brick('b3', { transform: studOffset(2, 6, 0), colorCode: 0 }),
    ],
    [group('g1'), group('g2', 'Nested', 'g1')],
  );

const delta: Mat4 = fromTranslation([20, -24, 0]);

/** One representative operation of every variant in the contract. */
const everyVariant = (): readonly Operation[] => [
  { type: 'add', bricks: [brick('new1'), brick('new2', { groupId: 'g1' })] },
  { type: 'remove', bricks: [base().bricks.get('b3') as ReturnType<typeof brick>] },
  { type: 'transformMany', ids: ['b1', 'b2'], delta },
  {
    type: 'transform',
    changes: [
      { id: 'b1', from: studOffset(0, 0, 0), to: studOffset(4, 2, 1) },
      { id: 'b3', from: studOffset(2, 6, 0), to: identity() },
    ],
  },
  { type: 'recolor', changes: [{ id: 'b1', from: 4, to: 25 }, { id: 'b3', from: 0, to: 71 }] },
  {
    type: 'reparent',
    changes: [
      { id: 'b1', from: undefined, to: 'g1' },
      { id: 'b2', from: 'g1', to: undefined },
      { id: 'b3', from: undefined, to: 'g2' },
    ],
  },
  { type: 'addGroup', group: group('g3', 'Fresh') },
  { type: 'removeGroup', group: group('g1') },
];

describe('applyOperation', () => {
  it('add inserts bricks and graph nodes', () => {
    const doc = applyOperation(base(), { type: 'add', bricks: [brick('b4')] });
    expect(doc.bricks.size).toBe(4);
    expect(doc.graph.nodes.get('b4')).toEqual({ brick: 'b4', out: [], in: [], peer: [] });
  });

  it('add rejects a duplicate id', () => {
    expect(() => applyOperation(base(), { type: 'add', bricks: [brick('b1')] })).toThrow(
      /already exists/,
    );
  });

  it('remove drops the brick and every edge touching it', () => {
    const doc = connectBricks(base(), [
      link('b1', 'b2', [mate('s1', 'k1')]),
      link('b2', 'b3', [mate('s2', 'k2')]),
    ]);
    expect(doc.graph.edges.size).toBe(2);
    const after = applyOperation(doc, {
      type: 'remove',
      bricks: [doc.bricks.get('b2') as ReturnType<typeof brick>],
    });
    expect(after.bricks.has('b2')).toBe(false);
    expect(after.graph.nodes.has('b2')).toBe(false);
    expect(after.graph.edges.size).toBe(0);
    expect(after.graph.nodes.get('b1')?.out).toEqual([]);
    expect(after.graph.nodes.get('b3')?.in).toEqual([]);
  });

  it('remove rejects an unknown brick', () => {
    expect(() =>
      applyOperation(base(), { type: 'remove', bricks: [brick('ghost')] }),
    ).toThrow(/unknown brick/);
  });

  it('transformMany applies the delta on the left of each world transform', () => {
    const doc = applyOperation(base(), { type: 'transformMany', ids: ['b1', 'b2'], delta });
    expect(doc.bricks.get('b1')?.transform).toEqual(multiply(delta, studOffset(0, 0, 0)));
    expect(doc.bricks.get('b2')?.transform).toEqual(multiply(delta, studOffset(1, 3, 0)));
    expect(doc.bricks.get('b3')?.transform).toEqual(studOffset(2, 6, 0));
  });

  it('transform sets absolute transforms', () => {
    const doc = applyOperation(base(), {
      type: 'transform',
      changes: [{ id: 'b1', from: studOffset(0, 0, 0), to: identity() }],
    });
    expect(doc.bricks.get('b1')?.transform).toEqual(identity());
  });

  it('recolor sets the colour code', () => {
    const doc = applyOperation(base(), {
      type: 'recolor',
      changes: [{ id: 'b1', from: 4, to: 25 }],
    });
    expect(doc.bricks.get('b1')?.colorCode).toBe(25);
    expect(doc.bricks.get('b2')?.colorCode).toBe(15);
  });

  it('reparent sets and clears groupId', () => {
    const doc = applyOperation(base(), {
      type: 'reparent',
      changes: [
        { id: 'b1', from: undefined, to: 'g1' },
        { id: 'b2', from: 'g1', to: undefined },
      ],
    });
    expect(doc.bricks.get('b1')?.groupId).toBe('g1');
    expect('groupId' in (doc.bricks.get('b2') as object)).toBe(false);
  });

  it('addGroup and removeGroup maintain the group map', () => {
    const added = applyOperation(base(), { type: 'addGroup', group: group('g3') });
    expect(added.groups.size).toBe(3);
    expect(() => applyOperation(added, { type: 'addGroup', group: group('g3') })).toThrow(
      /already exists/,
    );
    const removed = applyOperation(added, { type: 'removeGroup', group: group('g3') });
    expect(removed.groups.has('g3')).toBe(false);
    expect(() =>
      applyOperation(removed, { type: 'removeGroup', group: group('g3') }),
    ).toThrow(/unknown group/);
  });

  it('does not mutate the input document', () => {
    const doc = base();
    const before = snapshot(doc);
    for (const op of everyVariant()) applyOperation(doc, op);
    expect(snapshot(doc)).toEqual(before);
  });

  it('shares untouched entries rather than copying them', () => {
    const doc = base();
    const next = applyOperation(doc, { type: 'recolor', changes: [{ id: 'b1', from: 4, to: 25 }] });
    expect(next.bricks.get('b2')).toBe(doc.bricks.get('b2'));
    expect(next.groups).toBe(doc.groups);
    expect(next.graph).toBe(doc.graph);
  });

  it('applyOperations folds a sequence in order', () => {
    const doc = applyOperations(emptyDocument(), [
      { type: 'add', bricks: [brick('b1')] },
      { type: 'recolor', changes: [{ id: 'b1', from: 4, to: 1 }] },
    ]);
    expect(doc.bricks.get('b1')?.colorCode).toBe(1);
  });
});

describe('invertOperation', () => {
  it('maps each variant to its counterpart', () => {
    expect(invertOperation({ type: 'add', bricks: [brick('b')] }).type).toBe('remove');
    expect(invertOperation({ type: 'remove', bricks: [brick('b')] }).type).toBe('add');
    expect(invertOperation({ type: 'addGroup', group: group('g') }).type).toBe('removeGroup');
    expect(invertOperation({ type: 'removeGroup', group: group('g') }).type).toBe('addGroup');
    for (const type of ['transformMany', 'transform', 'recolor', 'reparent'] as const) {
      const op = everyVariant().find((o) => o.type === type) as Operation;
      expect(invertOperation(op).type).toBe(type);
    }
  });

  it('inverts transformMany by inverting its delta', () => {
    const op: Operation = { type: 'transformMany', ids: ['b1'], delta };
    const inv = invertOperation(op);
    expect(inv).toEqual({ type: 'transformMany', ids: ['b1'], delta: invertMatrix(delta) });
  });

  it('consults nothing but the operation', () => {
    // The op carries both sides, so inversion needs no document argument at all.
    expect(invertOperation.length).toBe(1);
  });

  it('invert(invert(op)) equals op, for every variant', () => {
    for (const op of everyVariant()) {
      const round = invertOperation(invertOperation(op));
      if (op.type === 'transformMany') {
        // Matrix inversion is exact for this delta, but compare numerically anyway.
        expect(round.type).toBe('transformMany');
        const r = round as Extract<Operation, { type: 'transformMany' }>;
        expect(r.ids).toEqual(op.ids);
        for (let i = 0; i < 16; i++) expect(r.delta[i]).toBeCloseTo(op.delta[i], 12);
      } else {
        expect(round).toEqual(op);
      }
    }
  });
});

describe('round trip', () => {
  it('apply(apply(doc, op), invert(op)) equals doc, for every variant', () => {
    for (const op of everyVariant()) {
      const doc = base();
      const round = applyOperation(applyOperation(doc, op), invertOperation(op));
      expect(snapshot(round), `variant ${op.type}`).toEqual(snapshot(doc));
    }
  });

  it('restores the graph when the removed brick had no edges', () => {
    const doc = connectBricks(base(), [link('b1', 'b2', [mate('s1', 'k1')])]);
    const op: Operation = { type: 'remove', bricks: [doc.bricks.get('b3') as ReturnType<typeof brick>] };
    const round = applyOperation(applyOperation(doc, op), invertOperation(op));
    expect(snapshot(round)).toEqual(snapshot(doc));
    expect(round.graph.edges.has(edgeIdFor('b1', 'b2'))).toBe(true);
  });

  it('does not restore edges of a connected brick: connectivity is not carried by Operation', () => {
    const doc = connectBricks(base(), [link('b1', 'b2', [mate('s1', 'k1')])]);
    const op: Operation = { type: 'remove', bricks: [doc.bricks.get('b2') as ReturnType<typeof brick>] };
    const round = applyOperation(applyOperation(doc, op), invertOperation(op));
    expect(snapshot(round).bricks).toEqual(snapshot(doc).bricks);
    expect(round.graph.edges.size).toBe(0);
  });
});
