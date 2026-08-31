import { describe, expect, it } from 'vitest';

import {
  allBricks,
  assemblyOf,
  brickCount,
  bricksInGroup,
  bricksInGroupTree,
  connectBricks,
  createDocument,
  disconnectBricks,
  emptyDocument,
  getBrick,
  getGroup,
  groupDescendants,
  requireBrick,
} from './document';
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

const doc = () =>
  createDocument(
    [
      brick('b1', { transform: studOffset(0, 0, 0) }),
      brick('b2', { transform: studOffset(1, 3, 0), groupId: 'g1' }),
      brick('b3', { transform: studOffset(2, 6, 0), groupId: 'g2' }),
      brick('b4'),
    ],
    [group('g1'), group('g2', 'Nested', 'g1'), group('g3')],
  );

describe('construction', () => {
  it('starts empty', () => {
    const d = emptyDocument();
    expect(brickCount(d)).toBe(0);
    expect(d.groups.size).toBe(0);
    expect(d.graph.nodes.size).toBe(0);
  });

  it('creates a node for every brick', () => {
    expect([...doc().graph.nodes.keys()].sort()).toEqual(['b1', 'b2', 'b3', 'b4']);
  });

  it('accepts a solved edge list', () => {
    const d = createDocument(
      [brick('b1'), brick('b2')],
      [],
      [edge('b1', 'b2', [mate('s1', 'k1'), mate('s2', 'k2')])],
    );
    expect(d.graph.edges.size).toBe(1);
    expect([...d.graph.edges.values()][0].mates).toHaveLength(2);
    expect(d.graph.neighbors(bid('b1'))).toEqual(['b2']);
  });

  it('rejects duplicate brick and group ids', () => {
    expect(() => createDocument([brick('b1'), brick('b1')])).toThrow(/duplicate brick/);
    expect(() => createDocument([], [group('g'), group('g')])).toThrow(/duplicate group/);
  });
});

describe('accessors', () => {
  it('reads bricks and groups', () => {
    expect(getBrick(doc(), bid('b1'))?.partId).toBe('3001');
    expect(getBrick(doc(), bid('ghost'))).toBeUndefined();
    expect(requireBrick(doc(), bid('b2')).groupId).toBe('g1');
    expect(() => requireBrick(doc(), bid('ghost'))).toThrow(/unknown brick/);
    expect(getGroup(doc(), gid('g2'))?.parentId).toBe('g1');
    expect(allBricks(doc())).toHaveLength(4);
  });

  it('lists direct group members without flattening nested groups', () => {
    expect(bricksInGroup(doc(), gid('g1')).map((b) => b.id)).toEqual(['b2']);
    expect(bricksInGroup(doc(), gid('g3'))).toEqual([]);
  });

  it('walks the group tree', () => {
    expect([...groupDescendants(doc(), gid('g1'))].sort()).toEqual(['g1', 'g2']);
    expect([...groupDescendants(doc(), gid('g3'))]).toEqual(['g3']);
    expect(bricksInGroupTree(doc(), gid('g1')).map((b) => b.id)).toEqual(['b2', 'b3']);
  });
});

describe('connectivity', () => {
  it('attaches and detaches precomputed mates', () => {
    const connected = connectBricks(doc(), [
      link('b1', 'b2', [mate('s1', 'k1'), mate('s2', 'k2')]),
      link('b2', 'b3', [mate('f1', 'f2', 'symmetric', 'finger')]),
    ]);
    expect(connected.graph.edges.size).toBe(2);
    expect([...assemblyOf(connected, bid('b1'))].sort()).toEqual(['b1', 'b2', 'b3']);
    expect([...assemblyOf(connected, bid('b4'))]).toEqual(['b4']);

    const detached = disconnectBricks(connected, [{ a: bid('b1'), b: bid('b2') }]);
    expect(detached.graph.edges.has(edgeId('b1', 'b2'))).toBe(false);
    expect([...assemblyOf(detached, bid('b1'))]).toEqual(['b1']);
    expect(detached.bricks).toBe(connected.bricks);
  });

  it('rejects connecting a brick the document does not hold', () => {
    expect(() => connectBricks(doc(), [link('b1', 'ghost', [mate('s', 'k')])])).toThrow(
      /unknown brick/,
    );
  });

  it('returns the same document for an empty change', () => {
    const d = doc();
    expect(connectBricks(d, [])).toBe(d);
    expect(disconnectBricks(d, [])).toBe(d);
  });
});
