/**
 * A staleness guard for what `packConnections`/`packOccupancy` write, not merely how — see
 * `SEMANTICS_VERSION` in `./baked.ts` and `docs/PREBAKE.md`.
 *
 * `packKey`'s bit assignments, which section `matingSection` picks, connection id
 * composition, and what `buildOccupancy` counts as solid are all *code*, but the result is
 * baked into shipped bytes nobody re-derives at runtime. A change to any of them silently
 * invalidates every committed bake with no signal — three connectivity PRs already have (see
 * `docs/PREBAKE.md`).
 *
 * `computeFixtureDigest` hashes the PACKED OUTPUT for a fixed, committed fixture corpus, not
 * source text: a comment-only edit to `packKey` must not move the digest, but a real
 * behaviour change must. `src/snap/fixtureDigest.test.ts` pins the result against a digest
 * checked into the test; `src/snap/manifestVersions.test.ts` and `tools/prebake.ts` use it to
 * check whether the committed `manifest.json` still matches what the current code would
 * produce, without needing the mirror.
 *
 * Pure: takes a `ReadFile` and touches no I/O of its own, so it runs the same way under the
 * mirror-backed reader (`tools/`) and the fixture reader (`src/snap/__fixtures__/reader.ts`,
 * built on `import.meta.glob`, which only Vite/vitest understand — not plain Node).
 */

import { boundsFromTriangles, partTriangles } from '../ldraw/bounds.ts';
import {
  packConnections,
  packOccupancy,
  type BakedConnections,
  type BakedOccupancy,
} from './baked.ts';
import { buildOccupancy } from './collision.ts';
import { resolvePart, type ReadFile } from './resolvePart.ts';

/**
 * Parts chosen to give a semantics change somewhere to actually move the digest: multiple
 * `SnapKind`s, both genders, multi-section profiles (so `matingSection` has a real choice
 * to make between a dominant shaft and a shorter end feature), and at least one part with
 * no shadow coverage (occupancy-only, no connections). The same corpus `baked.test.ts`
 * round-trips.
 */
export const FIXTURE_DIGEST_PARTS = ['3001', '4070', '3700', '3818', '2335', '3937', '3947'] as const;

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * sha256 over `packConnections(...)` followed by `packOccupancy(...)` for
 * `FIXTURE_DIGEST_PARTS`, resolved and voxelised through the same `src/snap/` code the bake
 * and the app both run.
 */
export async function computeFixtureDigest(read: ReadFile): Promise<string> {
  const connections: BakedConnections[] = [];
  const occupancy: BakedOccupancy[] = [];
  for (const partId of FIXTURE_DIGEST_PARTS) {
    const [points, triangles] = await Promise.all([
      resolvePart(partId, read),
      partTriangles(partId, read),
    ]);
    connections.push({ partId, points });
    const bounds = boundsFromTriangles(triangles);
    occupancy.push({ partId, bounds, occupancy: buildOccupancy(triangles, bounds, points) });
  }
  const packed = concatBytes(packConnections(connections), packOccupancy(occupancy));
  // `crypto.subtle.digest` wants a concrete `ArrayBuffer`, not a typed array whose backing
  // buffer type is merely `ArrayBufferLike` — `packed` is freshly allocated here, so the
  // slice is exact and never shares bytes with anything else.
  const bytes = packed.buffer.slice(packed.byteOffset, packed.byteOffset + packed.byteLength) as ArrayBuffer;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return toHex(digest);
}
