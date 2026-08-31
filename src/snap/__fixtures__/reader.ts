/**
 * A `ReadFile` over the captured library files in this directory.
 *
 * The files are real LDraw and LDCad shadow data, fetched once by
 * `tools/capture-fixtures.mjs` and committed. Tests read them from the bundle, so the
 * suite is offline and deterministic.
 */

import type { ReadFile } from '../resolvePart';

const files = import.meta.glob('./**/*.dat', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** Keyed by the namespaced relative path, e.g. `ldraw/parts/3001.dat`. */
export const fixtureFiles: ReadonlyMap<string, string> = new Map(
  Object.entries(files).map(([path, text]) => [path.replace(/^\.\//, ''), text]),
);

export const fixtureReader: ReadFile = async (relativePath) =>
  fixtureFiles.get(relativePath) ?? null;

/** The same corpus with the shadow library removed, i.e. a part with no coverage. */
export const geometryOnlyReader: ReadFile = async (relativePath) =>
  relativePath.startsWith('shadow/') ? null : (fixtureFiles.get(relativePath) ?? null);

/** Serves an explicit in-memory corpus; for exercising parsing rules without a capture. */
export function readerFor(corpus: Readonly<Record<string, string>>): ReadFile {
  return async (relativePath) => corpus[relativePath] ?? null;
}
