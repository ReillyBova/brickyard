/**
 * A network-backed `ReadFile` for `resolvePart` and `partTriangles`, fetching directly
 * from the same upstream mirrors `src/scene/partSource.ts` uses for render geometry.
 *
 * This is the "fetched" tier from `docs/PREBAKE.md`: a part not covered by a baked
 * catalog still has to come from somewhere, and this is where. It is deliberately not a
 * bulk mirror sync — `tools/sync-mirror.ts` owns that, and its 145 MB archive is out of
 * scope for one feature slice. Fetching only the parts a specific bundled model actually
 * references is bounded by that model's unique-part count, which is exactly the
 * politeness case `docs/PREBAKE.md` describes as the reason bundled models ship a
 * manifest: known, small, and requested once per part rather than crawled.
 *
 * Every request is deduplicated and cached for the lifetime of the reader, so a part
 * primitive referenced by dozens of other parts (`p/stud.dat`) is fetched once no matter
 * how many parts pull it in.
 */

import type { ReadFile } from '../../snap/resolvePart';

const LDRAW_BASE = 'https://raw.githubusercontent.com/gkjohnson/ldraw-parts-library/master/complete/ldraw/';
const SHADOW_BASE = 'https://raw.githubusercontent.com/RolandMelkert/LDCadShadowLibrary/main/';

export interface NetworkReaderStats {
  /** Distinct URLs actually fetched over the network (cache misses). */
  requests: number;
  /** Lookups served from the in-memory cache without a network round trip. */
  cacheHits: number;
}

export interface NetworkReaderOptions {
  ldrawBaseUrl?: string;
  shadowBaseUrl?: string;
  /** Injectable for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

/**
 * Builds a `ReadFile` over the upstream mirrors. Paths are namespaced exactly the way
 * `resolvePart` and `partTriangles` expect: `ldraw/parts/3001.dat`, `shadow/p/stud.dat`.
 *
 * Returns the reader plus a live `stats` accessor, so callers building manifests or
 * measuring load time can report how many requests a cold import actually cost.
 */
export function createNetworkReader(
  options: NetworkReaderOptions = {},
): { read: ReadFile; stats: () => NetworkReaderStats } {
  const ldrawBase = options.ldrawBaseUrl ?? LDRAW_BASE;
  const shadowBase = options.shadowBaseUrl ?? SHADOW_BASE;
  const fetchImpl = options.fetchImpl ?? fetch;

  const cache = new Map<string, Promise<string | null>>();
  let requests = 0;
  let cacheHits = 0;

  const fetchOne = async (url: string): Promise<string | null> => {
    requests++;
    try {
      const res = await fetchImpl(url);
      if (!res.ok) return null;
      return await res.text();
    } catch {
      return null;
    }
  };

  const read: ReadFile = (relativePath: string): Promise<string | null> => {
    const cached = cache.get(relativePath);
    if (cached !== undefined) {
      cacheHits++;
      return cached;
    }

    let promise: Promise<string | null>;
    if (relativePath.startsWith('ldraw/')) {
      promise = fetchOne(ldrawBase + relativePath.slice('ldraw/'.length));
    } else if (relativePath.startsWith('shadow/')) {
      promise = fetchOne(shadowBase + relativePath.slice('shadow/'.length));
    } else {
      promise = Promise.resolve(null);
    }
    cache.set(relativePath, promise);
    return promise;
  };

  return { read, stats: () => ({ requests, cacheHits }) };
}
