import { describe, expect, it } from 'vitest';

import { withRetry } from './retry';

describe('withRetry', () => {
  it('returns the result on first success without retrying', async () => {
    let calls = 0;
    const result = await withRetry(async () => {
      calls++;
      return 'ok';
    }, 3, 0);
    expect(result).toBe('ok');
    expect(calls).toBe(1);
  });

  it('retries up to `attempts` times then succeeds', async () => {
    let calls = 0;
    const result = await withRetry(async () => {
      calls++;
      if (calls < 3) throw new Error(`fail ${calls}`);
      return 'ok';
    }, 3, 0);
    expect(result).toBe('ok');
    expect(calls).toBe(3);
  });

  it('throws the last error once attempts are exhausted', async () => {
    let calls = 0;
    await expect(
      withRetry(async () => {
        calls++;
        throw new Error(`fail ${calls}`);
      }, 3, 0),
    ).rejects.toThrow('fail 3');
    expect(calls).toBe(3);
  });

  it('never calls the task more than `attempts` times', async () => {
    let calls = 0;
    await expect(
      withRetry(async () => {
        calls++;
        throw new Error('always fails');
      }, 1, 0),
    ).rejects.toThrow();
    expect(calls).toBe(1);
  });
});
