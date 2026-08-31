import { describe, expect, it } from 'vitest';

import type { Mat4 } from '../types';
import { connectBricks, createDocument, emptyDocument } from './document';
import { IDENTITY, fromTranslation, invert as invertMatrix, multiply } from '../math';
import { applyOperation, applyOperations, invertOperation } from './operations';
import {
  brick,
  edge,
  group,
  link,
  mate,
  studOffset,
  testBrickId as bid,
  testEdgeId as edgeId,
  testGroupId as gid,
} from './testing';
import type { ConnectionEdge, Operation, SceneDocument } from './types';

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

/** Three bricks, two groups, and one edge already joining b1 and b2. */
const base = (): SceneDocument =>
  createDocument(
    [
      brick('b1', { transform: studOffset(0, 0, 0), colorCode: 4 }),
      brick('b2', { transform: studOffset(1, 3, 0), colorCode: 15, groupId: 'g1' }),
      brick('b3', { transform: studOffset(2, 6, 0), colorCode: 0 }),
    ],
    [group('g1'), group('g2', 'Nested', 'g1')],
    [edge('b1', 'b2', [mate('s1', 'k1'), mate('s2', 'k2')])],
  );

/** The edge as the document stores it, which is what a real caller would pass. */
const storedEdge = (doc: SceneDocument, a: string, b: string) =>
  doc.graph.edges.get(edgeId(a, b)) as ConnectionEdge;

const delta: Mat4 = fromTranslation([20, -24, 0]);

/** One representative operation of every variant in the contract. */
const everyVariant = (): readonly Operation[] => [
  { type: 'add', bricks: [brick('new1'), brick('new2', { groupId: 'g1' })] },
  { type: 'remove', bricks: [base().bricks.get(bid('b3')) as ReturnType<typeof brick>] },
  { type: 'transformMany', ids: [bid('b1'), bid('b2')], delta },
  {
    type: 'transform',
    changes: [
      { id: bid('b1'), from: studOffset(0, 0, 0), to: studOffset(4, 2, 1) },
      { id: bid('b3'), from: studOffset(2, 6, 0), to: IDENTITY },
    ],
  },
  {
    type: 'recolor',
    changes: [
      { id: bid('b1'), from: 4, to: 25 },
      { id: bid('b3'), from: 0, to: 71 },
    ],
  },
  {
    type: 'reparent',
    changes: [
      { id: bid('b1'), from: undefined, to: gid('g1') },
      { id: bid('b2'), from: gid('g1'), to: undefined },
      { id: bid('b3'), from: undefined, to: gid('g2') },
    ],
  },
  { type: 'addGroup', group: group('g3', 'Fresh') },
  { type: 'removeGroup', group: group('g1') },
  { type: 'connect', edges: [edge('b2', 'b3', [mate('s3', 'k3', 'b')])] },
  { type: 'disconnect', edges: [storedEdge(base(), 'b1', 'b2')] },
];

describe('applyOperation', () => {
  it('add inserts bricks and graph nodes', () => {
    const doc = applyOperation(base(), { type: 'add', bricks: [brick('b4')] });
    expect(doc.bricks.size).toBe(4);
    expect(doc.graph.nodes.get(bid('b4'))).toEqual({ brick: 'b4', out: [], in: [], peer: [] });
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
      bricks: [doc.bricks.get(bid('b2')) as ReturnType<typeof brick>],
    });
    expect(after.bricks.has(bid('b2'))).toBe(false);
    expect(after.graph.nodes.has(bid('b2'))).toBe(false);
    expect(after.graph.edges.size).toBe(0);
    expect(after.graph.nodes.get(bid('b1'))?.out).toEqual([]);
    expect(after.graph.nodes.get(bid('b3'))?.in).toEqual([]);
  });

  it('remove rejects an unknown brick', () => {
    expect(() =>
      applyOperation(base(), { type: 'remove', bricks: [brick('ghost')] }),
    ).toThrow(/unknown brick/);
  });

  it('transformMany applies the delta on the left of each world transform', () => {
    const doc = applyOperation(base(), { type: 'transformMany', ids: [bid('b1'), bid('b2')], delta });
    expect(doc.bricks.get(bid('b1'))?.transform).toEqual(multiply(delta, studOffset(0, 0, 0)));
    expect(doc.bricks.get(bid('b2'))?.transform).toEqual(multiply(delta, studOffset(1, 3, 0)));
    expect(doc.bricks.get(bid('b3'))?.transform).toEqual(studOffset(2, 6, 0));
  });

  it('transform sets absolute transforms', () => {
    const doc = applyOperation(base(), {
      type: 'transform',
      changes: [{ id: bid('b1'), from: studOffset(0, 0, 0), to: IDENTITY }],
    });
    expect(doc.bricks.get(bid('b1'))?.transform).toEqual(IDENTITY);
  });

  it('recolor sets the colour code', () => {
    const doc = applyOperation(base(), {
      type: 'recolor',
      changes: [{ id: bid('b1'), from: 4, to: 25 }],
    });
    expect(doc.bricks.get(bid('b1'))?.colorCode).toBe(25);
    expect(doc.bricks.get(bid('b2'))?.colorCode).toBe(15);
  });

  it('reparent sets and clears groupId', () => {
    const doc = applyOperation(base(), {
      type: 'reparent',
      changes: [
        { id: bid('b1'), from: undefined, to: gid('g1') },
        { id: bid('b2'), from: gid('g1'), to: undefined },
      ],
    });
    expect(doc.bricks.get(bid('b1'))?.groupId).toBe('g1');
    expect('groupId' in (doc.bricks.get(bid('b2')) as object)).toBe(false);
  });

  it('addGroup and removeGroup maintain the group map', () => {
    const added = applyOperation(base(), { type: 'addGroup', group: group('g3') });
    expect(added.groups.size).toBe(3);
    expect(() => applyOperation(added, { type: 'addGroup', group: group('g3') })).toThrow(
      /already exists/,
    );
    const removed = applyOperation(added, { type: 'removeGroup', group: group('g3') });
    expect(removed.groups.has(gid('g3'))).toBe(false);
    expect(() =>
      applyOperation(removed, { type: 'removeGroup', group: group('g3') }),
    ).toThrow(/unknown group/);
  });

  it('connect installs whole edges with all their mates', () => {
    const doc = applyOperation(base(), {
      type: 'connect',
      edges: [edge('b2', 'b3', [mate('s3', 'k3'), mate('s4', 'k4')])],
    });
    expect(doc.graph.edges.size).toBe(2);
    const added = storedEdge(doc, 'b2', 'b3');
    expect(added.mates).toHaveLength(2);
    expect(doc.graph.nodes.get(bid('b2'))?.out).toEqual([edgeId('b2', 'b3')]);
    expect(doc.graph.nodes.get(bid('b3'))?.in).toEqual([edgeId('b2', 'b3')]);
  });

  it('connect rejects a pair that is already connected, or an unknown brick', () => {
    expect(() =>
      applyOperation(base(), { type: 'connect', edges: [edge('b1', 'b2', [mate('x', 'y')])] }),
    ).toThrow(/already connected/);
    expect(() =>
      applyOperation(base(), { type: 'connect', edges: [edge('b1', 'ghost', [mate('x', 'y')])] }),
    ).toThrow(/unknown brick/);
  });

  it('disconnect drops the whole edge and leaves both bricks', () => {
    const doc = applyOperation(base(), {
      type: 'disconnect',
      edges: [storedEdge(base(), 'b1', 'b2')],
    });
    expect(doc.graph.edges.size).toBe(0);
    expect(doc.bricks.size).toBe(3);
    expect(doc.graph.nodes.get(bid('b1'))?.out).toEqual([]);
    expect(doc.graph.nodes.get(bid('b2'))?.in).toEqual([]);
  });

  it('disconnect rejects a pair that is not connected', () => {
    expect(() =>
      applyOperation(base(), { type: 'disconnect', edges: [edge('b2', 'b3', [mate('x', 'y')])] }),
    ).toThrow(/not connected/);
  });

  it('treats an empty connectivity change as a no-op', () => {
    const doc = base();
    expect(applyOperation(doc, { type: 'connect', edges: [] })).toBe(doc);
    expect(applyOperation(doc, { type: 'disconnect', edges: [] })).toBe(doc);
  });

  it('does not mutate the input document', () => {
    const doc = base();
    const before = snapshot(doc);
    for (const op of everyVariant()) applyOperation(doc, op);
    expect(snapshot(doc)).toEqual(before);
  });

  it('shares untouched entries rather than copying them', () => {
    const doc = base();
    const next = applyOperation(doc, {
      type: 'recolor',
      changes: [{ id: bid('b1'), from: 4, to: 25 }],
    });
    expect(next.bricks.get(bid('b2'))).toBe(doc.bricks.get(bid('b2')));
    expect(next.groups).toBe(doc.groups);
    expect(next.graph).toBe(doc.graph);
  });

  it('applyOperations folds a sequence in order', () => {
    const doc = applyOperations(emptyDocument(), [
      { type: 'add', bricks: [brick('b1')] },
      { type: 'recolor', changes: [{ id: bid('b1'), from: 4, to: 1 }] },
    ]);
    expect(doc.bricks.get(bid('b1'))?.colorCode).toBe(1);
  });
});

describe('operation coverage', () => {
  it('exercises every variant the contract declares', () => {
    expect(everyVariant().map((o) => o.type).sort()).toEqual([
      'add',
      'addGroup',
      'connect',
      'disconnect',
      'recolor',
      'remove',
      'removeGroup',
      'reparent',
      'transform',
      'transformMany',
    ]);
  });
});

describe('invertOperation', () => {
  it('maps each variant to its counterpart', () => {
    expect(invertOperation({ type: 'add', bricks: [brick('b')] }).type).toBe('remove');
    expect(invertOperation({ type: 'remove', bricks: [brick('b')] }).type).toBe('add');
    expect(invertOperation({ type: 'addGroup', group: group('g') }).type).toBe('removeGroup');
    expect(invertOperation({ type: 'removeGroup', group: group('g') }).type).toBe('addGroup');
    const edges = [edge('b1', 'b2', [mate('s', 'k')])];
    expect(invertOperation({ type: 'connect', edges })).toEqual({ type: 'disconnect', edges });
    expect(invertOperation({ type: 'disconnect', edges })).toEqual({ type: 'connect', edges });
    for (const type of ['transformMany', 'transform', 'recolor', 'reparent'] as const) {
      const op = everyVariant().find((o) => o.type === type) as Operation;
      expect(invertOperation(op).type).toBe(type);
    }
  });

  it('inverts transformMany by inverting its delta', () => {
    const op: Operation = { type: 'transformMany', ids: [bid('b1')], delta };
    const inv = invertOperation(op);
    expect(inv).toEqual({ type: 'transformMany', ids: [bid('b1')], delta: invertMatrix(delta) });
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

  it('leaves untouched edges in place when a brick is removed', () => {
    const op: Operation = {
      type: 'remove',
      bricks: [base().bricks.get(bid('b3')) as ReturnType<typeof brick>],
    };
    const doc = base();
    const round = applyOperation(applyOperation(doc, op), invertOperation(op));
    expect(snapshot(round)).toEqual(snapshot(doc));
    expect(round.graph.edges.has(edgeId('b1', 'b2'))).toBe(true);
  });

  it('restores mates through a disconnect regardless of the orientation supplied', () => {
    const doc = base();
    // A caller that names the pair in the other order still round-trips exactly.
    const reversed = edge(
      'b2',
      'b1',
      storedEdge(doc, 'b1', 'b2').mates.map((m) => ({
        aPoint: m.bPoint,
        bPoint: m.aPoint,
        kind: m.kind,
        polarity: m.polarity === 'a' ? ('b' as const) : ('a' as const),
      })),
    );
    const op: Operation = { type: 'disconnect', edges: [reversed] };
    const round = applyOperation(applyOperation(doc, op), invertOperation(op));
    expect(snapshot(round)).toEqual(snapshot(doc));
  });
});
