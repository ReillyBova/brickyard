/**
 * A `PartSource` built from a `ReadFile`.
 *
 * Composes the three things a `PartDef` needs — connections from the shadow reader,
 * bounds and occupancy from the triangles — so an adapter supplies only where bytes
 * come from. Cold-resolving one part costs roughly twenty fetches, so results are
 * memoised per source for the life of the process.
 */

import { boundsFromTriangles, partTriangles } from '../../ldraw/bounds.ts';
import { buildOccupancy } from '../../snap/collision.ts';
import type { ReadFile } from '../../snap/resolvePart.ts';
import { resolvePart } from '../../snap/resolvePart.ts';
import type { PartDef } from '../../snap/types.ts';
import type { PartSource } from './session.ts';

export interface PartSourceOptions {
  /** Part titles, when the caller has a catalog. Falls back to the part number. */
  titles?: Readonly<Record<string, string>>;
}

export function createPartSource(read: ReadFile, options: PartSourceOptions = {}): PartSource {
  const cache = new Map<string, Promise<PartDef>>();

  return (id) => {
    let pending = cache.get(id);
    if (!pending) {
      pending = (async () => {
        // The resolvers treat an unreadable file as an absent one, which is right for
        // probing paths that legitimately do not exist but erases the difference
        // between "no such part" and "the network is down". Watching the reader keeps
        // that distinction, so a transient failure is not reported as a bad part number.
        let readFailure: unknown;
        const watched: ReadFile = async (relativePath) => {
          try {
            return await read(relativePath);
          } catch (error) {
            readFailure ??= error;
            throw error;
          }
        };

        const [connections, triangles] = await Promise.all([
          resolvePart(id, watched),
          partTriangles(id, watched),
        ]);
        if (readFailure !== undefined) {
          const reason = readFailure instanceof Error ? readFailure.message : String(readFailure);
          throw new Error(`part ${id} could not be read: ${reason}`);
        }
        if (triangles.length === 0) {
          throw new Error(`no geometry for part ${id} — check the part number`);
        }
        const bounds = boundsFromTriangles(triangles);
        return {
          id,
          title: options.titles?.[id] ?? id,
          connections,
          bounds,
          occupancy: buildOccupancy(triangles, bounds, connections),
        };
      })().catch((error: unknown) => {
        // Let a later call retry: a failed fetch should not poison the part forever.
        cache.delete(id);
        throw error;
      });
      cache.set(id, pending);
    }
    return pending;
  };
}
