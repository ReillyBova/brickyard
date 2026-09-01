import { describe, expect, it } from 'vitest';

import { createDocument } from '../../model/document';
import { brick, edge, mate, testBrickId as bid, testEdgeId as eid } from '../../model/testing';

import { classifyEdges } from './edges';

describe('classifyEdges', () => {
  it('classifies an a-out mate as directed from a to b', () => {
    const doc = createDocument(
      [brick('b1'), brick('b2')],
      [],
      [edge('b1', 'b2', [mate('s1', 'k1', 'a')])],
    );
    expect(classifyEdges(doc)).toEqual([
      { kind: 'directed', id: eid('b1', 'b2'), from: bid('b1'), to: bid('b2') },
    ]);
  });

  it('classifies a b-out mate as directed from b to a', () => {
    const doc = createDocument(
      [brick('b1'), brick('b2')],
      [],
      [edge('b1', 'b2', [mate('s1', 'k1', 'b')])],
    );
    expect(classifyEdges(doc)).toEqual([
      { kind: 'directed', id: eid('b1', 'b2'), from: bid('b2'), to: bid('b1') },
    ]);
  });

  it('classifies a symmetric mate, and a mix of both genders, as peer', () => {
    const doc = createDocument(
      [brick('b1'), brick('b2'), brick('b3'), brick('b4')],
      [],
      [
        edge('b1', 'b2', [mate('f1', 'f2', 'symmetric', 'finger')]),
        edge('b3', 'b4', [mate('s1', 'k1', 'a'), mate('s2', 'k2', 'b')]),
      ],
    );
    const classified = classifyEdges(doc);
    expect(classified).toContainEqual({ kind: 'peer', id: eid('b1', 'b2'), a: bid('b1'), b: bid('b2') });
    expect(classified).toContainEqual({ kind: 'peer', id: eid('b3', 'b4'), a: bid('b3'), b: bid('b4') });
  });
});
