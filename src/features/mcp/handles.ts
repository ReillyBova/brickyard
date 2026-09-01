/**
 * Legible names for bricks, for the MCP channel.
 *
 * A `BrickId` is twelve characters drawn from a 64-character alphabet — unique, cheap
 * to mint, and meaningless to read. A model steering by those identifiers spends
 * accuracy on bookkeeping, so every brick also carries a handle derived from what it
 * is: `brick-2x4-3`, `plate-1x8-1`. Handles are what tools accept and return; ids
 * surface only when asked for.
 *
 * Ordinals are never reused inside a session. Deleting `brick-2x4-2` and placing
 * another 2x4 yields `brick-2x4-4`, not a second `brick-2x4-2` naming a different
 * piece — a stale handle in a model's context should fail to resolve rather than
 * silently address something else.
 *
 * Pure: no three.js imports, no DOM.
 */

import type { BrickId } from '../../types';

/** `'Brick  2 x  4'` -> `'brick-2x4'`. Falls back to the part number. */
export function slugFor(partId: string, title?: string): string {
  if (title === undefined || title.trim() === '') return `part-${partId.toLowerCase()}`;
  const slug = title
    .toLowerCase()
    // Dimensions read as one token: 'brick 2 x 4' is 'brick-2x4', not 'brick-2-x-4'.
    .replace(/(\d)\s*x\s*(\d)/g, '$1x$2')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug === '' ? `part-${partId.toLowerCase()}` : slug;
}

export class HandleTable {
  private readonly toHandle = new Map<BrickId, string>();
  private readonly toBrick = new Map<string, BrickId>();
  /** Next ordinal per slug. Monotonic — see the note on reuse above. */
  private readonly counters = new Map<string, number>();

  /**
   * Name a brick, or return the name it already has. Idempotent, so replaying a
   * document through `sync` does not renumber it.
   */
  assign(brick: BrickId, partId: string, title?: string): string {
    const existing = this.toHandle.get(brick);
    if (existing !== undefined) return existing;

    const slug = slugFor(partId, title);
    const next = (this.counters.get(slug) ?? 0) + 1;
    this.counters.set(slug, next);

    const handle = `${slug}-${next}`;
    this.toHandle.set(brick, handle);
    this.toBrick.set(handle, brick);
    return handle;
  }

  release(brick: BrickId): void {
    const handle = this.toHandle.get(brick);
    if (handle === undefined) return;
    this.toHandle.delete(brick);
    this.toBrick.delete(handle);
  }

  handleFor(brick: BrickId): string | undefined {
    return this.toHandle.get(brick);
  }

  /** Accepts a handle or a raw id, so a model that kept an id is not stranded. */
  resolve(nameOrId: string): BrickId | undefined {
    const byHandle = this.toBrick.get(nameOrId);
    if (byHandle !== undefined) return byHandle;
    return this.toHandle.has(nameOrId as BrickId) ? (nameOrId as BrickId) : undefined;
  }

  get size(): number {
    return this.toHandle.size;
  }
}
