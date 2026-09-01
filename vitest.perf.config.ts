import { defineConfig } from 'vitest/config';

/**
 * Performance budgets, run on demand with `npm run test:perf`.
 *
 * Separate from the unit suite because these assert wall clock. The budgets are loose —
 * each sits far below the cost of the algorithm it guards against returning to, not near
 * the current measurement — so they catch a complexity regression without failing on a
 * busy laptop. Read a failure as "this got asymptotically worse", never as a benchmark.
 *
 * `fileParallelism: false` keeps the timings off a worker pool that is also busy running
 * other files.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.perf.test.ts'],
    fileParallelism: false,
    testTimeout: 600_000,
  },
});
