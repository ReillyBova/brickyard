import { describe, expect, it } from 'vitest';

import { Graph, buildGraph, emptyGraph, flipMate } from './graph';
import { edge, link, mate, testBrickId as bid, testEdgeId as edgeId } from './testing';

/**
 * Every edge appears in exactly two nodes' adjacency lists, and the sum of node
 * degrees is twice the edge count.
 */
const expectConsistent = (g: Graph) => {
  let degrees = 0;
  for (const node of g.nodes.values()) {
    const all = [...node.out, ...node.in, ...node.peer];
    expect(new Set(all).size).toBe(all.length);
    for (const id of all) {
      const edge = g.edges.get(id);
      expect(edge, `node ${node.brick} references missing edge ${id}`).toBeDefined();
      expect([edge?.a, edge?.b]).toContain(node.brick);
    }
    degrees += all.length;
  }
  for (const edge of g.edges.values()) {
    const holders = [...g.nodes.values()].filter((n) =>
      [...n.out, ...n.in, ...n.peer].includes(edge.id),
    );
    expect(holders.map((n) => n.brick).sort()).toEqual([edge.a, edge.b].sort());
  }
  expect(degrees).toBe(g.edges.size * 2);
};

/** Comparable snapshot of the whole structure, for before/after equality. */
const snapshot = (g: Graph) => ({
  nodes: [...g.nodes.values()]
    .map((n) => ({ brick: n.brick, out: [...n.out].sort(), in: [...n.in].sort(), peer: [...n.peer].sort() }))
    .sort((x, y) => (x.brick < y.brick ? -1 : 1)),
  edges: [...g.edges.values()]
    .map((e) => ({ id: e.id, a: e.a, b: e.b, mates: e.mates }))
    .sort((x, y) => (x.id < y.id ? -1 : 1)),
});

const nodesOnly = (...labels: string[]): Graph =>
  emptyGraph().addBricks(labels.map((label) => ({ brick: bid(label) })));

describe('edge identity', () => {
  it('is orientation independent', () => {
    expect(edgeId('b1', 'b2')).toBe(edgeId('b2', 'b1'));
  });
});

describe('flipMate', () => {
  it('swaps points and polarity, and is its own inverse', () => {
    const m = mate('stud-3', 'socket-1', 'a');
    expect(flipMate(m)).toEqual({
      aPoint: 'socket-1',
      bPoint: 'stud-3',
      kind: 'cyl',
      polarity: 'b',
    });
    expect(flipMate(flipMate(m))).toEqual(m);
    const sym = mate('f1', 'f2', 'symmetric', 'finger');
    expect(flipMate(sym).polarity).toBe('symmetric');
  });
});

describe('addBrick', () => {
  it('adds an isolated node with empty adjacency', () => {
    const g = emptyGraph().addBrick(bid('b1'));
    expect(g.nodes.get(bid('b1'))).toEqual({ brick: 'b1', out: [], in: [], peer: [] });
    expect(g.edges.size).toBe(0);
    expectConsistent(g);
  });

  it('creates one edge carrying every mate for a brick pair', () => {
    // Two staggered 2x2 bricks: one edge, two mates.
    const g = nodesOnly('b1').addBrick(bid('b2'), [
      link('b1', 'b2', [mate('s1', 'k1'), mate('s2', 'k2')]),
    ]);
    expect(g.edges.size).toBe(1);
    const edge = [...g.edges.values()][0];
    expect(edge.mates).toHaveLength(2);
    expect(edge.a).toBe('b1');
    expect(edge.b).toBe('b2');
    expectConsistent(g);
  });

  it('places a gendered edge in out for the male side and in for the female side', () => {
    const g = nodesOnly('b1').addBrick(bid('b2'), [link('b1', 'b2', [mate('s1', 'k1', 'a')])]);
    const id = edgeId('b1', 'b2');
    expect(g.nodes.get(bid('b1'))?.out).toEqual([id]);
    expect(g.nodes.get(bid('b1'))?.in).toEqual([]);
    expect(g.nodes.get(bid('b2'))?.in).toEqual([id]);
    expect(g.nodes.get(bid('b2'))?.out).toEqual([]);
  });

  it('places a symmetric edge in peer on both sides', () => {
    const g = nodesOnly('h1').addBrick(bid('h2'), [
      link('h1', 'h2', [mate('f1', 'f2', 'symmetric', 'finger')]),
    ]);
    const id = edgeId('h1', 'h2');
    expect(g.nodes.get(bid('h1'))?.peer).toEqual([id]);
    expect(g.nodes.get(bid('h2'))?.peer).toEqual([id]);
    expect(g.nodes.get(bid('h1'))?.out).toEqual([]);
    expect(g.nodes.get(bid('h2'))?.in).toEqual([]);
    expectConsistent(g);
  });

  it('classifies an edge with both gendered directions as peer', () => {
    const g = nodesOnly('b1').addBrick(bid('b2'), [
      link('b1', 'b2', [mate('s1', 'k1', 'a'), mate('k2', 's2', 'b')]),
    ]);
    const id = edgeId('b1', 'b2');
    expect(g.nodes.get(bid('b1'))?.peer).toEqual([id]);
    expect(g.nodes.get(bid('b2'))?.peer).toEqual([id]);
    expectConsistent(g);
  });

  it('merges a second link on the same pair into the existing edge', () => {
    const g = nodesOnly('b1')
      .addBrick(bid('b2'), [link('b1', 'b2', [mate('s1', 'k1')])])
      .connect([link('b1', 'b2', [mate('s2', 'k2')])]);
    expect(g.edges.size).toBe(1);
    expect([...g.edges.values()][0].mates).toHaveLength(2);
    expectConsistent(g);
  });

  it('flips mates supplied in the opposite orientation when merging', () => {
    const g = nodesOnly('b1')
      .addBrick(bid('b2'), [link('b1', 'b2', [mate('s1', 'k1', 'a')])])
      .connect([link('b2', 'b1', [mate('k2', 's2', 'b')])]);
    const edge = [...g.edges.values()][0];
    expect(edge.a).toBe('b1');
    // The incoming mate named b2's point first; stored in b1-first orientation it
    // becomes polarity 'a' with b1's point as aPoint.
    expect(edge.mates[1]).toEqual({ aPoint: 's2', bPoint: 'k2', kind: 'cyl', polarity: 'a' });
    expectConsistent(g);
  });

  it('does not duplicate a mate supplied twice', () => {
    const g = nodesOnly('b1')
      .addBrick(bid('b2'), [link('b1', 'b2', [mate('s1', 'k1')])])
      .connect([link('b1', 'b2', [mate('s1', 'k1')])]);
    expect([...g.edges.values()][0].mates).toHaveLength(1);
  });

  it('rejects a link to an unknown brick, a self link, and a link it is not part of', () => {
    expect(() =>
      nodesOnly().addBrick(bid('b1'), [link('b1', 'ghost', [mate('s', 'k')])]),
    ).toThrow(/unknown brick/);
    expect(() =>
      nodesOnly('b1').addBrick(bid('b2'), [link('b2', 'b2', [mate('s', 'k')])]),
    ).toThrow();
    expect(() =>
      nodesOnly('b1', 'b3').addBrick(bid('b2'), [link('b1', 'b3', [mate('s', 'k')])]),
    ).toThrow(/does not involve/);
  });
});

describe('removeBrick', () => {
  it('cleans adjacency in both directions', () => {
    const g = nodesOnly('b1')
      .addBrick(bid('b2'), [link('b1', 'b2', [mate('s1', 'k1')])])
      .removeBrick(bid('b2'));
    expect(g.nodes.has(bid('b2'))).toBe(false);
    expect(g.edges.size).toBe(0);
    expect(g.nodes.get(bid('b1'))).toEqual({ brick: 'b1', out: [], in: [], peer: [] });
    expectConsistent(g);
  });

  it('returns the graph to its prior state after add then remove', () => {
    const base = nodesOnly('b1', 'b2').connect([link('b1', 'b2', [mate('s1', 'k1')])]);
    const before = snapshot(base);
    const after = base
      .addBrick(bid('b3'), [
        link('b2', 'b3', [mate('s2', 'k2')]),
        link('b1', 'b3', [mate('f1', 'f2', 'symmetric', 'finger')]),
      ])
      .removeBrick(bid('b3'));
    expect(snapshot(after)).toEqual(before);
    expectConsistent(after);
  });

  it('ignores an unknown brick', () => {
    const g = nodesOnly('b1');
    expect(snapshot(g.removeBrick(bid('ghost')))).toEqual(snapshot(g));
  });

  it('leaves the source graph untouched', () => {
    const base = nodesOnly('b1', 'b2').connect([link('b1', 'b2', [mate('s1', 'k1')])]);
    const before = snapshot(base);
    base.removeBrick(bid('b1'));
    base.addBrick(bid('b3'));
    expect(snapshot(base)).toEqual(before);
  });
});

describe('neighbors and component', () => {
  const chain = () =>
    nodesOnly('a', 'b', 'c', 'd', 'lonely').connect([
      link('a', 'b', [mate('s1', 'k1', 'a')]),
      link('b', 'c', [mate('s2', 'k2', 'b')]),
      link('c', 'd', [mate('f1', 'f2', 'symmetric', 'finger')]),
    ]);

  it('reports each neighbour once regardless of direction', () => {
    expect([...chain().neighbors(bid('b'))].sort()).toEqual(['a', 'c']);
    expect(chain().neighbors(bid('lonely'))).toEqual([]);
    expect(chain().neighbors(bid('ghost'))).toEqual([]);
  });

  it('traverses out, in and peer alike', () => {
    expect([...chain().component(bid('a'))].sort()).toEqual(['a', 'b', 'c', 'd']);
    expect([...chain().component(bid('d'))].sort()).toEqual(['a', 'b', 'c', 'd']);
    expect([...chain().component(bid('lonely'))]).toEqual(['lonely']);
    expect([...chain().component(bid('ghost'))]).toEqual([]);
  });

  it('splits the component when the joining brick is removed', () => {
    const split = chain().removeBrick(bid('b'));
    expect([...split.component(bid('a'))]).toEqual(['a']);
    expect([...split.component(bid('c'))].sort()).toEqual(['c', 'd']);
    expectConsistent(split);
  });

  it('reports degree and incident edges', () => {
    const g = chain();
    expect(g.degree(bid('b'))).toBe(2);
    expect(g.degree(bid('lonely'))).toBe(0);
    expect(g.edgesOf(bid('b')).map((e) => e.id).sort()).toEqual(
      [edgeId('a', 'b'), edgeId('b', 'c')].sort(),
    );
  });
});

describe('disconnect', () => {
  it('drops the edge but keeps both bricks', () => {
    const g = nodesOnly('b1', 'b2')
      .connect([link('b1', 'b2', [mate('s1', 'k1')])])
      .disconnect([{ a: bid('b2'), b: bid('b1') }]);
    expect(g.edges.size).toBe(0);
    expect(g.nodes.size).toBe(2);
    expectConsistent(g);
  });

  it('rejects connecting an unknown brick', () => {
    expect(() => nodesOnly('b1').connect([link('b1', 'ghost', [mate('s', 'k')])])).toThrow();
  });
});

describe('buildGraph', () => {
  it('builds nodes and edges from a solved edge list', () => {
    const g = buildGraph(['b1', 'b2', 'b3'].map(bid), [
      edge('b1', 'b2', [mate('s1', 'k1'), mate('s2', 'k2')]),
    ]);
    expect(g.nodes.size).toBe(3);
    expect(g.edges.size).toBe(1);
    // Edge ids are canonicalised from the brick pair.
    expect(g.edges.has(edgeId('b1', 'b2'))).toBe(true);
    expectConsistent(g);
  });

  it('rejects an edge referencing an unknown brick', () => {
    expect(() =>
      buildGraph(['b1'].map(bid), [edge('b1', 'ghost', [mate('s', 'k')])]),
    ).toThrow(/unknown brick/);
  });
});

describe('structural sharing', () => {
  it('reuses node objects for untouched bricks', () => {
    const base = nodesOnly('b1', 'b2', 'b3');
    const next = base.addBrick(bid('b4'), [link('b1', 'b4', [mate('s', 'k')])]);
    expect(next.nodes.get(bid('b2'))).toBe(base.nodes.get(bid('b2')));
    expect(next.nodes.get(bid('b3'))).toBe(base.nodes.get(bid('b3')));
    expect(next.nodes.get(bid('b1'))).not.toBe(base.nodes.get(bid('b1')));
  });
});

describe('edge id injectivity', () => {
  // BrickId is an unconstrained string, so the pair encoding must be reversible.
  // A plain separator would render {'x','y~z'} and {'x~y','z'} identically, and a
  // collision merges mates into an unrelated edge rather than failing.
  it('does not collide when ids contain the separator', () => {
    expect(edgeId('x', 'y~z')).not.toBe(edgeId('x~y', 'z'));
  });

  it('keeps colliding-looking pairs as separate edges', () => {
    const g = emptyGraph()
      .addBricks(['x', 'y~z', 'x~y', 'z'].map((brick) => ({ brick: bid(brick) })))
      .connect([
        link('x', 'y~z', [mate('p0', 'p1')]),
        link('x~y', 'z', [mate('p2', 'p3')]),
      ]);

    expect(g.edges.size).toBe(2);
    expect(g.neighbors(bid('x'))).toEqual(['y~z']);
    expect(g.neighbors(bid('z'))).toEqual(['x~y']);
    expectConsistent(g);
  });

  it('is orientation independent and reversible', () => {
    expect(edgeId('a', 'b')).toBe(edgeId('b', 'a'));
    expect(edgeId('aa', 'b')).not.toBe(edgeId('a', 'ab'));
  });
});
