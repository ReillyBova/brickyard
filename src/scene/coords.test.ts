import { describe, expect, it } from 'vitest';

import { flipYZ } from './coords.ts';

describe('flipYZ', () => {
  it('negates y and z, leaves x alone', () => {
    expect(flipYZ(1, 2, 3)).toEqual([1, -2, -3]);
  });

  it('is its own inverse', () => {
    const [x, y, z] = flipYZ(5, -7, 11);
    expect(flipYZ(x, y, z)).toEqual([5, -7, 11]);
  });

  it('is the identity on the origin', () => {
    const [x, y, z] = flipYZ(0, 0, 0);
    expect([x, y, z].map((n) => n + 0)).toEqual([0, 0, 0]);
  });
});
