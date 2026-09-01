import { describe, expect, it } from 'vitest';

import { ConcurrencyPool } from './concurrencyPool';

/** Resolves after `ms`, recording enter/exit order in `log`. */
function task(log: string[], id: string, ms: number): () => Promise<void> {
  return async () => {
    log.push(`start:${id}`);
    await new Promise((resolve) => setTimeout(resolve, ms));
    log.push(`end:${id}`);
  };
}

describe('ConcurrencyPool', () => {
  it('rejects a non-positive or non-integer limit', () => {
    expect(() => new ConcurrencyPool(0)).toThrow();
    expect(() => new ConcurrencyPool(-1)).toThrow();
    expect(() => new ConcurrencyPool(1.5)).toThrow();
  });

  it('never runs more than `limit` tasks at once', async () => {
    const pool = new ConcurrencyPool(3);
    let active = 0;
    let maxActive = 0;
    const tasks = Array.from({ length: 20 }, () => async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
    });
    await Promise.all(tasks.map((t) => pool.run(t)));
    expect(maxActive).toBeLessThanOrEqual(3);
  });

  it('starts queued work in FIFO order', async () => {
    const pool = new ConcurrencyPool(1);
    const log: string[] = [];
    const runs = ['a', 'b', 'c'].map((id) => pool.run(task(log, id, 5)));
    await Promise.all(runs);
    expect(log).toEqual(['start:a', 'end:a', 'start:b', 'end:b', 'start:c', 'end:c']);
  });

  it('frees its slot when a task rejects, so later work still runs', async () => {
    const pool = new ConcurrencyPool(1);
    const failing = pool.run(async () => {
      throw new Error('boom');
    });
    await expect(failing).rejects.toThrow('boom');

    let ran = false;
    await pool.run(async () => {
      ran = true;
    });
    expect(ran).toBe(true);
  });

  it('exposes active and queued counts while work is outstanding', async () => {
    const pool = new ConcurrencyPool(2);
    let release: (() => void) | undefined;
    const blocker = new Promise<void>((resolve) => {
      release = resolve;
    });
    const p1 = pool.run(() => blocker);
    const p2 = pool.run(() => blocker);
    const p3 = pool.run(async () => undefined);

    // Give the microtask queue a turn so acquire() has run for all three.
    await Promise.resolve();
    expect(pool.activeCount).toBe(2);
    expect(pool.queuedCount).toBe(1);

    release?.();
    await Promise.all([p1, p2, p3]);
    expect(pool.activeCount).toBe(0);
    expect(pool.queuedCount).toBe(0);
  });

  it('a bounded pool is not slower than serial execution for independent tasks', async () => {
    const pool = new ConcurrencyPool(5);
    const start = Date.now();
    await Promise.all(Array.from({ length: 10 }, () => pool.run(() => new Promise((r) => setTimeout(r, 20)))));
    const elapsed = Date.now() - start;
    // Serial would be ~200ms (10 * 20ms); with 5 concurrent slots it should be ~2 batches (~40ms).
    expect(elapsed).toBeLessThan(150);
  });
});
