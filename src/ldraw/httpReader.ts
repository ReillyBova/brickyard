/**
 * A `ReadFile` over the upstream libraries, fetched on demand.
 *
 * `src/ldraw/mirror.ts` notes that a reader is injected into the parser, which then
 * never knows whether bytes came from disk or the network. This is the network half,
 * and it works unchanged in a page and under Node — the MCP bridge resolves real parts
 * with no mirror sync and no prebake.
 *
 * Paths arrive namespaced, `ldraw/parts/3001.dat` or `shadow/parts/3001.dat`, matching
 * the fixture corpus layout.
 */

import type { ReadFile } from '../snap/resolvePart';

export const LDRAW_BASE =
  'https://raw.githubusercontent.com/gkjohnson/ldraw-parts-library/master/complete/ldraw/';
export const SHADOW_BASE =
  'https://raw.githubusercontent.com/RolandMelkert/LDCadShadowLibrary/main/';

export interface HttpReaderOptions {
  ldrawBase?: string;
  shadowBase?: string;
}

export function createHttpReader(options: HttpReaderOptions = {}): ReadFile {
  const ldraw = options.ldrawBase ?? LDRAW_BASE;
  const shadow = options.shadowBase ?? SHADOW_BASE;
  const inFlight = new Map<string, Promise<string | null>>();

  return (relativePath) => {
    const cached = inFlight.get(relativePath);
    if (cached) return cached;

    const base = relativePath.startsWith('shadow/') ? shadow : ldraw;
    const rest = relativePath.replace(/^(shadow|ldraw)\//, '');

    const pending = fetch(base + rest)
      .then((response) => (response.ok ? response.text() : null))
      .catch((error: unknown) => {
        // A 404 is a real answer and worth keeping — the resolver probes paths that
        // legitimately do not exist. A dropped connection is not: caching it would
        // break the part for the rest of the process over one bad request.
        inFlight.delete(relativePath);
        throw error;
      });

    inFlight.set(relativePath, pending);
    return pending;
  };
}
