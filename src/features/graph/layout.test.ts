import { describe, expect, it } from 'vitest';

import { createDocument } from '../../model/document';
import { brick, edge, mate, studOffset, testBrickId as bid } from '../../model/testing';

import { computeExplodeLayout } from './layout';

describe('computeExplodeLayout', () => {
  it('explodes radially outward from the centroid, scaled by distance from it', () => {
    const doc = createDocument([
      brick('b1', { transform: studOffset(0, 0, 0) }),
      brick('b2', { transform: studOffset(1, 0, 0) }), // sits exactly at the centroid
      brick('b3', { transform: studOffset(2, 0, 0) }),
    ]);

    const layout = computeExplodeLayout(doc, { baseDistance: 60, spreadFactor: 1.4 });

    expect(layout.get(bid('b1'))?.origin).toEqual([0, 0, 0]);
    expect(layout.get(bid('b1'))?.target).toEqual([-88, 0, 0]); // 60 + 20*1.4, outward = -x

    expect(layout.get(bid('b3'))?.origin).toEqual([40, 0, 0]);
    expect(layout.get(bid('b3'))?.target).toEqual([128, 0, 0]); // 60 + 20*1.4, outward = +x

    // At the centroid: no distance-based push, but the fallback direction (explode
    // "up", i.e. -Y in LDraw's Y-down world) still gives it somewhere to go.
    expect(layout.get(bid('b2'))?.origin).toEqual([20, 0, 0]);
    expect(layout.get(bid('b2'))?.target).toEqual([20, -60, 0]);
  });

  it('assigns hop distance by BFS from the brick nearest the centroid', () => {
    const doc = createDocument(
      [
        brick('b1', { transform: studOffset(0, 0, 0) }),
        brick('b2', { transform: studOffset(1, 0, 0) }),
        brick('b3', { transform: studOffset(2, 0, 0) }),
      ],
      [],
      [
        edge('b1', 'b2', [mate('s1', 'k1')]),
        edge('b2', 'b3', [mate('s2', 'k2')]),
      ],
    );

    const layout = computeExplodeLayout(doc);
    expect(layout.get(bid('b2'))?.hop).toBe(0); // sits at the centroid, becomes the root
    expect(layout.get(bid('b1'))?.hop).toBe(1);
    expect(layout.get(bid('b3'))?.hop).toBe(1);
  });

  it('gives every isolated brick its own single-brick component and zero hop', () => {
    const doc = createDocument([brick('lonely', { transform: studOffset(5, 0, 0) })]);
    const layout = computeExplodeLayout(doc);
    expect(layout.get(bid('lonely'))?.hop).toBe(0);
  });

  it('returns an empty layout for an empty document', () => {
    expect(computeExplodeLayout(createDocument()).size).toBe(0);
  });
});
