import { describe, expect, it } from 'vitest';

import { brick } from '../../model/testing';
import { colorUsage } from './colorUsage';

describe('colorUsage', () => {
  it('counts bricks per color, most-used first', () => {
    const bricks = [
      brick('b1', { colorCode: 4 }),
      brick('b2', { colorCode: 4 }),
      brick('b3', { colorCode: 4 }),
      brick('b4', { colorCode: 15 }),
      brick('b5', { colorCode: 15 }),
      brick('b6', { colorCode: 71 }),
    ];

    expect(colorUsage(bricks)).toEqual([
      { code: 4, count: 3 },
      { code: 15, count: 2 },
      { code: 71, count: 1 },
    ]);
  });

  it('breaks ties by color code, ascending', () => {
    const bricks = [brick('b1', { colorCode: 15 }), brick('b2', { colorCode: 4 })];
    expect(colorUsage(bricks)).toEqual([
      { code: 4, count: 1 },
      { code: 15, count: 1 },
    ]);
  });

  it('is empty for an empty document', () => {
    expect(colorUsage([])).toEqual([]);
  });
});
