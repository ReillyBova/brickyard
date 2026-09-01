import { describe, expect, it } from 'vitest';

import { createDocument } from '../../model/document';
import { applyTransaction } from '../../model/history';
import { brick, testBrickId as bid } from '../../model/testing';
import { buildRestyleTransaction, restyleChanges } from './transaction';

describe('restyleChanges', () => {
  it('only lists bricks whose color the mapping actually changes', () => {
    const bricks = [
      brick('b1', { colorCode: 4 }),
      brick('b2', { colorCode: 4 }),
      brick('b3', { colorCode: 15 }),
    ];
    // color 15 maps to itself — a no-op that must not appear as a change.
    const mapping = new Map([
      [4, 25],
      [15, 15],
    ]);

    expect(restyleChanges(bricks, mapping)).toEqual([
      { id: bid('b1'), from: 4, to: 25 },
      { id: bid('b2'), from: 4, to: 25 },
    ]);
  });

  it('ignores colors absent from the mapping', () => {
    const bricks = [brick('b1', { colorCode: 4 }), brick('b2', { colorCode: 71 })];
    expect(restyleChanges(bricks, new Map([[4, 25]]))).toEqual([{ id: bid('b1'), from: 4, to: 25 }]);
  });
});

describe('buildRestyleTransaction', () => {
  it('builds one recolor transaction with a user-facing label', () => {
    const bricks = [brick('b1', { colorCode: 4 }), brick('b2', { colorCode: 4 }), brick('b3', { colorCode: 15 })];
    const tx = buildRestyleTransaction(bricks, new Map([[4, 25]]));

    expect(tx).not.toBeNull();
    expect(tx?.label).toBe('Restyle 2 bricks');
    expect(tx?.ops).toEqual([
      {
        type: 'recolor',
        changes: [
          { id: bid('b1'), from: 4, to: 25 },
          { id: bid('b2'), from: 4, to: 25 },
        ],
      },
    ]);
  });

  it('singularises the label for one brick', () => {
    const tx = buildRestyleTransaction([brick('b1', { colorCode: 4 })], new Map([[4, 25]]));
    expect(tx?.label).toBe('Restyle 1 brick');
  });

  it('returns null when nothing would change', () => {
    expect(buildRestyleTransaction([brick('b1', { colorCode: 4 })], new Map())).toBeNull();
    expect(buildRestyleTransaction([brick('b1', { colorCode: 4 })], new Map([[4, 4]]))).toBeNull();
  });

  it('inverts to restore the original colors', () => {
    const original = [brick('b1', { colorCode: 4 }), brick('b2', { colorCode: 15 })];
    const tx = buildRestyleTransaction(original, new Map([[4, 25], [15, 71]]));
    expect(tx).not.toBeNull();

    const doc = createDocument(original);
    const after = applyTransaction(doc, tx!);
    expect(after.bricks.get(bid('b1'))?.colorCode).toBe(25);
    expect(after.bricks.get(bid('b2'))?.colorCode).toBe(71);
  });
});
