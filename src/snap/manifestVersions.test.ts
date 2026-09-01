/**
 * Checks the COMMITTED `public/baked/manifest.json` against the code that would produce it
 * today. `public/baked/` is tracked and nothing bakes in CI (`docs/PREBAKE.md`), so a commit
 * that bumps `SEMANTICS_VERSION` (or either format version) without re-running
 * `npm run prebake` and committing the result would otherwise ship silently: the running app
 * would read a bake that still matches its own version fields — the guard in
 * `src/snap/baked.ts`/`src/ldraw/geometryBaked.ts` only catches a version MISMATCH between
 * file and code, not a manifest that was never regenerated to begin with.
 *
 * This is that second check: it recomputes every version and the fixture digest from the
 * current code and fails if the committed manifest disagrees with any of them, so a stale
 * commit fails the build rather than shipping. Needs no mirror — `manifest.json` is
 * committed and `src/snap/__fixtures__/` is committed — so this runs in ordinary CI.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { BAKED_FORMAT_VERSION, SEMANTICS_VERSION } from './baked.ts';
import { fixtureReader } from './__fixtures__/reader.ts';
import { computeFixtureDigest } from './fixtureDigest.ts';
import { GEOMETRY_FORMAT_VERSION, GEOMETRY_SEMANTICS_VERSION } from '../ldraw/geometryBaked.ts';
import type { BakedManifest } from '../ldraw/types.ts';

const MANIFEST_PATH = path.resolve(process.cwd(), 'public/baked/manifest.json');

async function readManifest(): Promise<BakedManifest | null> {
  try {
    return JSON.parse(await readFile(MANIFEST_PATH, 'utf8')) as BakedManifest;
  } catch {
    return null;
  }
}

describe('public/baked/manifest.json', () => {
  it('agrees with the code that would produce it', async () => {
    const manifest = await readManifest();
    if (manifest === null) {
      // Nothing to check against — a fresh clone before the first `npm run prebake` has no
      // baked output at all, and the app falls back to source resolution (see
      // `src/scene/bakedParts.ts`). Not this test's job to require a bake exist.
      return;
    }

    const explain =
      'public/baked/manifest.json is stale relative to the code that would produce it. ' +
      'Run `npm run prebake` against a synced mirror and commit the result, including ' +
      'public/baked/.';

    expect(manifest.bakedFormatVersion, explain).toBe(BAKED_FORMAT_VERSION);
    expect(manifest.semanticsVersion, explain).toBe(SEMANTICS_VERSION);
    expect(manifest.geometryFormatVersion, explain).toBe(GEOMETRY_FORMAT_VERSION);
    expect(manifest.geometrySemanticsVersion, explain).toBe(GEOMETRY_SEMANTICS_VERSION);
    expect(manifest.fixtureDigest, explain).toBe(await computeFixtureDigest(fixtureReader));
  });
});
