/**
 * A small FIFO-ordered concurrency limiter.
 *
 * `LDrawPartSource` dedupes by part id already (`cache: Map<string, Promise<LoadedPart>>`),
 * but nothing capped how many *distinct* parts could be resolving over the network at
 * once. A model reuses a small set of parts thousands of times, so dedup was never the
 * problem — an unbounded `Promise.all` over every unique part id was: each part load
 * fans out into its own subfile tree (`docs/ARCHITECTURE.md`: "~20 network fetches" per
 * part cold), so a model with a few hundred unique parts can put thousands of concurrent
 * requests on one third-party host at once. That is a thundering herd, not parallelism.
 *
 * `run` queues work through `limit` slots, FIFO. Callers that enqueue in build order (as
 * `SceneRenderer.addBrick` does — see its module doc) therefore also *start* resolving
 * new parts in build order, without either side needing to know about the other.
 */
export class ConcurrencyPool {
  private readonly limit: number;
  private active = 0;
  private readonly queue: (() => void)[] = [];

  constructor(limit: number) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error(`ConcurrencyPool: limit must be a positive integer, got ${limit}`);
    }
    this.limit = limit;
  }

  /** Currently-running tasks. Exposed for tests and diagnostics. */
  get activeCount(): number {
    return this.active;
  }

  /** Tasks waiting for a free slot. */
  get queuedCount(): number {
    return this.queue.length;
  }

  /**
   * Runs `task` once a slot is free, preserving FIFO order among waiters. The task's
   * result (or rejection) propagates to the returned promise; a slot always frees on
   * settlement, success or failure, so one failing task never stalls the pool.
   */
  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await task();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.queue.push(() => {
        this.active++;
        resolve();
      });
    });
  }

  private release(): void {
    this.active--;
    const next = this.queue.shift();
    if (next) next();
  }
}
