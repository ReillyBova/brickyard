/**
 * `MaterialCache` used to resolve colors from a copy of `LDConfig.ldr` fetched from
 * the upstream mirror at runtime, separate from the bundled fixture
 * `src/ui/ColorPicker/palette.ts` builds the picker's swatches from — two independent
 * snapshots of the same file that disagreed on which codes exist. A code the picker
 * offered (bundled) could come back unresolved here (fetched) and silently render as
 * `FALLBACK_COLOR`'s grey, which looks like a plausible muted color rather than a
 * missing one. Pinning individual codes (as the tests below still do, for a concrete
 * restyle scenario) is exactly what let that regression through undetected — it only
 * ever exercised codes present in both copies. The test that actually matters is the
 * set relationship: every code `LDRAW_PALETTE` offers must resolve to a real color
 * here, not just the ones this file happens to name.
 */
import { describe, expect, it } from 'vitest';

import { BUNDLED_COLOR_LIBRARY } from '../ldraw/bundledLibrary';
import { LDRAW_PALETTE } from '../ui/ColorPicker/palette';
import { MaterialCache } from './colorLibrary';

const FALLBACK_HEX = 0xa0a0a0;

describe('MaterialCache', () => {
  it('resolves every color the picker offers to its real color, never the grey fallback', () => {
    // The set-relationship assertion, not a spot check: the picker and the renderer
    // share one bundled library (`bundledLibrary.ts`) precisely so this can never be
    // false for a code that exists — a future regression back to two sources, or a
    // hand-edited fixture missing an entry, fails this rather than surfacing as a
    // grey brick someone has to notice by eye.
    //
    // Checked by library membership, not by comparing the resolved hex against
    // `FALLBACK_HEX` — one real LDraw color ("Pearl Light Grey", 135) happens to
    // share the fallback's exact `#a0a0a0` value, which would read as "fell back"
    // under a color-value check even though it resolved correctly.
    const cache = new MaterialCache();
    const missing = LDRAW_PALETTE.filter((swatch) => !BUNDLED_COLOR_LIBRARY.has(swatch.code));
    expect(missing).toEqual([]);

    // And, for every code, the cache's resolved color really does match the library
    // entry it's supposed to — not just that a lookup happened to succeed.
    for (const swatch of LDRAW_PALETTE) {
      expect(cache.get(swatch.code).color.getHex()).toBe(BUNDLED_COLOR_LIBRARY.get(swatch.code)!.value);
    }
  });

  it("resolves a remapped brick's material to the real LDConfig color, not the grey fallback", () => {
    const cache = new MaterialCache();

    // 14 (Yellow) stands in for a brick's original color; 25 (Orange) for a restyle
    // target the renderer has not batched yet — the exact shape of "recolor a brick to
    // a code nothing on screen currently uses."
    const original = cache.get(14);
    const restyled = cache.get(25);

    expect(BUNDLED_COLOR_LIBRARY.get(14)?.value).toBeDefined();
    expect(BUNDLED_COLOR_LIBRARY.get(25)?.value).toBeDefined();
    expect(original.color.getHex()).toBe(BUNDLED_COLOR_LIBRARY.get(14)!.value);
    expect(restyled.color.getHex()).toBe(BUNDLED_COLOR_LIBRARY.get(25)!.value);
    expect(restyled.color.getHex()).not.toBe(FALLBACK_HEX);
  });

  it('resolves code 431 (Bright Blue Violet) — missing from the upstream mirror\'s copy of LDConfig.ldr at the time of writing, present in the bundled fixture', () => {
    // The concrete reproduction for the reported bug: a purple that displayed grey.
    // Regressing to a runtime-fetched library (or any second, divergent source) would
    // make this fail again for exactly the reason it failed originally.
    const cache = new MaterialCache();
    expect(BUNDLED_COLOR_LIBRARY.get(431)?.name).toBe('Bright_Blue_Violet');
    expect(cache.get(431).color.getHex()).toBe(BUNDLED_COLOR_LIBRARY.get(431)!.value);
    expect(cache.get(431).color.getHex()).not.toBe(FALLBACK_HEX);
  });

  it('caches one material per color code, so re-resolving after a recolor reuses it', () => {
    const cache = new MaterialCache();
    const first = cache.get(25);
    const second = cache.get(25);
    expect(second).toBe(first);
  });

  it('falls back to grey only for a code genuinely absent from the bundled library', () => {
    const cache = new MaterialCache();
    expect(BUNDLED_COLOR_LIBRARY.has(999999)).toBe(false);
    expect(cache.get(999999).color.getHex()).toBe(FALLBACK_HEX);
  });
});
