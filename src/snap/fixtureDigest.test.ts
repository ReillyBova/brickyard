/**
 * The staleness guard itself: pins `computeFixtureDigest`'s result against the committed
 * fixture corpus, so a semantics change that nobody remembered to version-bump fails a test
 * instead of shipping silently. See `./fixtureDigest.ts` and `docs/PREBAKE.md`.
 *
 * Needs no mirror — `src/snap/__fixtures__/` is committed — so this runs in ordinary CI.
 */

import { describe, expect, it } from 'vitest';

import { fixtureReader } from './__fixtures__/reader.ts';
import { computeFixtureDigest } from './fixtureDigest.ts';

/**
 * sha256 over the packed connections+occupancy bytes for `FIXTURE_DIGEST_PARTS`.
 *
 * If this test fails, the packed meaning of a baked field changed — `packKey`'s bit
 * assignments, `matingSection`'s selection rule, connection id composition, or occupancy's
 * fill rule. That is either:
 *
 * - Unintentional: you changed something you didn't mean to. Fix it.
 * - Intentional: bump `SEMANTICS_VERSION` in `src/snap/baked.ts`, replace the digest below
 *   with the value this test prints on failure, run `npm run prebake` against a synced
 *   mirror, and commit the re-baked `public/baked/` alongside this change.
 */
const FIXTURE_DIGEST = '4b9f1c88127f50beeb8d1b08873ae9f48123b32720fd32b58ae795dee3ee92ef';

describe('bake semantics staleness guard', () => {
  it('has not silently changed what packKey/matingSection/occupancy fields mean', async () => {
    const digest = await computeFixtureDigest(fixtureReader);
    expect(
      digest,
      `packed fixture digest moved to ${digest} — see the comment above FIXTURE_DIGEST in ` +
        'this file for what to do.',
    ).toBe(FIXTURE_DIGEST);
  });
});
