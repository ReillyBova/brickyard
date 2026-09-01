import { describe, expect, it } from 'vitest';

import { createDocument } from '../../model/document';
import { brick, edge, mate, testBrickId as bid } from '../../model/testing';

import { computeGraphStats } from './stats';

describe('computeGraphStats', () => {
  it('reports one component with no isolated bricks for a fully connected model', () => {
    const doc = createDocument(
      [brick('b1'), brick('b2'), brick('b3')],
      [],
      [
        edge('b1', 'b2', [mate('s1', 'k1')]),
        edge('b2', 'b3', [mate('f1', 'f2', 'symmetric', 'finger')]),
      ],
    );

    const stats = computeGraphStats(doc);
    expect(stats.brickCount).toBe(3);
    expect(stats.edgeCount).toBe(2);
    expect(stats.directedEdgeCount).toBe(1); // b1-b2, gendered
    expect(stats.peerEdgeCount).toBe(1); // b2-b3, symmetric finger
    expect(stats.componentCount).toBe(1);
    expect(stats.componentSizes).toEqual([3]);
    expect(stats.isolatedBrickIds).toEqual([]);
  });

  it('counts a brick with no connections as its own component', () => {
    const doc = createDocument(
      [brick('b1'), brick('b2'), brick('loner')],
      [],
      [edge('b1', 'b2', [mate('s1', 'k1')])],
    );

    const stats = computeGraphStats(doc);
    expect(stats.componentCount).toBe(2);
    expect(stats.componentSizes).toEqual([2, 1]);
    expect(stats.isolatedBrickIds).toEqual([bid('loner')]);
  });

  it('handles the empty document', () => {
    const stats = computeGraphStats(createDocument());
    expect(stats).toMatchObject({
      brickCount: 0,
      edgeCount: 0,
      componentCount: 0,
      componentSizes: [],
      isolatedBrickIds: [],
    });
  });
});
