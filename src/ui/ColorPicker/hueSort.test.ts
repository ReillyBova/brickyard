import { describe, expect, it } from 'vitest';

import { isSentinelCode, parseColorLibrary } from '../../ldraw/colors';
import type { LDrawColor } from '../../ldraw/types';
import ldConfigText from '../../ldraw/__fixtures__/mirror/library/LDConfig.ldr?raw';
import { sortColorsByHue } from './hueSort';

const library = parseColorLibrary(ldConfigText);
const REAL_COLORS: readonly LDrawColor[] = Array.from(library.values()).filter(
  (color) => !isSentinelCode(color.code),
);

function toRgb(value: number): { r: number; g: number; b: number } {
  return { r: (value >> 16) & 0xff, g: (value >> 8) & 0xff, b: value & 0xff };
}

function lightness({ r, g, b }: { r: number; g: number; b: number }): number {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  return (Math.max(rn, gn, bn) + Math.min(rn, gn, bn)) / 2;
}

function saturation({ r, g, b }: { r: number; g: number; b: number }): number {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return 0;
  const d = max - min;
  return l > 0.5 ? d / (2 - max - min) : d / (max + min);
}

function hueDegrees({ r, g, b }: { r: number; g: number; b: number }): number {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  if (max === min) return 0;
  const d = max - min;
  let h: number;
  switch (max) {
    case rn:
      h = (gn - bn) / d + (gn < bn ? 6 : 0);
      break;
    case gn:
      h = (bn - rn) / d + 2;
      break;
    default:
      h = (rn - gn) / d + 4;
      break;
  }
  return h * 60;
}

/** Same threshold `hueSort.ts` uses to separate neutrals from hue families. */
const ACHROMATIC_SATURATION = 0.08;

describe('sortColorsByHue', () => {
  it('is a permutation of the input — same colours, count preserved', () => {
    const sorted = sortColorsByHue(REAL_COLORS);
    expect(sorted).toHaveLength(REAL_COLORS.length);
    expect(new Set(sorted.map((c) => c.code))).toEqual(new Set(REAL_COLORS.map((c) => c.code)));
  });

  it('groups every achromatic colour (white/grey/black) together, ahead of the hue wheel', () => {
    const sorted = sortColorsByHue(REAL_COLORS);
    const achromaticFlags = sorted.map((c) => saturation(toRgb(c.value)) < ACHROMATIC_SATURATION);

    // Once a chromatic colour appears, no further achromatic colour should follow —
    // i.e. all `true` flags are contiguous and lead the array.
    const firstChromatic = achromaticFlags.indexOf(false);
    if (firstChromatic === -1) return; // an all-achromatic palette trivially satisfies this
    const laterAchromatic = achromaticFlags.slice(firstChromatic).some((isAchromatic) => isAchromatic);
    expect(laterAchromatic).toBe(false);
  });

  it('orders the achromatic group light to dark', () => {
    const sorted = sortColorsByHue(REAL_COLORS);
    const achromaticLightness = sorted
      .filter((c) => saturation(toRgb(c.value)) < ACHROMATIC_SATURATION)
      .map((c) => lightness(toRgb(c.value)));

    for (let i = 1; i < achromaticLightness.length; i++) {
      expect(achromaticLightness[i]).toBeLessThanOrEqual(achromaticLightness[i - 1] + 1e-9);
    }
  });

  it('keeps each hue family contiguous', () => {
    const sorted = sortColorsByHue(REAL_COLORS);
    const chromatic = sorted.filter((c) => saturation(toRgb(c.value)) >= ACHROMATIC_SATURATION);

    // Bucket by a coarse 8-way hue family using the same boundaries hueSort.ts uses,
    // then confirm the family sequence never revisits a family it already left.
    const familyOf = (h: number): number => {
      const bounds = [15, 45, 70, 165, 195, 255, 290, 345];
      for (let i = 0; i < bounds.length; i++) if (h < bounds[i]) return i;
      return 0; // wraps to red
    };

    const families = chromatic.map((c) => familyOf(hueDegrees(toRgb(c.value))));
    const seen = new Set<number>();
    let lastFamily: number | undefined;
    for (const family of families) {
      if (family !== lastFamily) {
        expect(seen.has(family)).toBe(false); // family reappearing after we left it
        seen.add(family);
        lastFamily = family;
      }
    }
  });

  it('orders lightness within each hue family, light to dark', () => {
    const sorted = sortColorsByHue(REAL_COLORS);
    const chromatic = sorted.filter((c) => saturation(toRgb(c.value)) >= ACHROMATIC_SATURATION);

    const familyOf = (h: number): number => {
      const bounds = [15, 45, 70, 165, 195, 255, 290, 345];
      for (let i = 0; i < bounds.length; i++) if (h < bounds[i]) return i;
      return 0;
    };

    let runStart = 0;
    for (let i = 1; i <= chromatic.length; i++) {
      const prevFamily = familyOf(hueDegrees(toRgb(chromatic[i - 1].value)));
      const curFamily = i < chromatic.length ? familyOf(hueDegrees(toRgb(chromatic[i].value))) : undefined;
      if (curFamily !== prevFamily) {
        const run = chromatic.slice(runStart, i).map((c) => lightness(toRgb(c.value)));
        for (let j = 1; j < run.length; j++) {
          expect(run[j]).toBeLessThanOrEqual(run[j - 1] + 1e-9);
        }
        runStart = i;
      }
    }
  });

  it('is stable and deterministic across repeated calls', () => {
    const first = sortColorsByHue(REAL_COLORS).map((c) => c.code);
    const second = sortColorsByHue(REAL_COLORS).map((c) => c.code);
    expect(second).toEqual(first);
  });
});
