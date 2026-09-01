/**
 * Regression coverage for a restyle-shaped scenario: a brick recolored to a code the
 * renderer has never batched before must resolve to that color's real LDConfig value,
 * not silently fall back to `FALLBACK_COLOR`'s grey. The fallback and the resolved
 * color both being plausible-looking neutrals is exactly what makes a lookup miss here
 * easy to miss by eye — pinned numerically instead.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { parseColorLibrary } from '../ldraw/colors';
import { MaterialCache } from './colorLibrary';

const fixturePath = fileURLToPath(
  new URL('../ldraw/__fixtures__/mirror/library/LDConfig.ldr', import.meta.url),
);
const ldConfigText = readFileSync(fixturePath, 'utf8');

const FALLBACK_HEX = 0xa0a0a0;

describe('MaterialCache', () => {
  it("resolves a remapped brick's material to the real LDConfig color, not the grey fallback", () => {
    const library = parseColorLibrary(ldConfigText);
    const cache = new MaterialCache(library);

    // 14 (Yellow) stands in for a brick's original color; 25 (Orange) for a restyle
    // target the renderer has not batched yet — the exact shape of "recolor a brick to
    // a code nothing on screen currently uses."
    const original = cache.get(14);
    const restyled = cache.get(25);

    expect(library.get(14)?.value).toBeDefined();
    expect(library.get(25)?.value).toBeDefined();
    expect(original.color.getHex()).toBe(library.get(14)!.value);
    expect(restyled.color.getHex()).toBe(library.get(25)!.value);
    expect(restyled.color.getHex()).not.toBe(FALLBACK_HEX);
  });

  it('caches one material per color code, so re-resolving after a recolor reuses it', () => {
    const library = parseColorLibrary(ldConfigText);
    const cache = new MaterialCache(library);

    const first = cache.get(25);
    const second = cache.get(25);
    expect(second).toBe(first);
  });

  it('falls back to grey only for a code genuinely absent from the library', () => {
    const library = parseColorLibrary(ldConfigText);
    const cache = new MaterialCache(library);

    expect(library.has(999999)).toBe(false);
    expect(cache.get(999999).color.getHex()).toBe(FALLBACK_HEX);
  });
});
