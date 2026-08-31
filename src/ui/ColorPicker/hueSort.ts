/**
 * Sorts LDraw colours for browsing rather than by the arbitrary order `LDConfig.ldr`
 * declares them in. Pure, and operates on `LDrawColor` directly (before the `Swatch`
 * shaping in `palette.ts`), so it only needs `value` (0xRRGGBB) plus whatever the
 * caller wants preserved through the sort.
 *
 * Two groups, in this order:
 *
 * 1. **Achromatics** — white, the greys, black. Very low saturation, so hue is
 *    meaningless for them; interleaving them into the hue wheel would scatter them.
 *    Ordered light to dark.
 * 2. **Hue families** — everything else, binned into red/orange/yellow/green/cyan/
 *    blue/purple/pink by hue angle and ordered around the wheel in that sequence.
 *    Within a family, ordered light to dark. Browns and tans fall out of this
 *    naturally: they're dark, desaturated oranges, so they land at the dark end of
 *    the orange family rather than needing a family of their own.
 */
import type { LDrawColor } from '../../ldraw/types';

interface Hsl {
  h: number;
  s: number;
  l: number;
}

/** `value` is 0xRRGGBB, per `LDrawColor`. */
function rgbToHsl(value: number): Hsl {
  const r = ((value >> 16) & 0xff) / 255;
  const g = ((value >> 8) & 0xff) / 255;
  const b = (value & 0xff) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) return { h: 0, s: 0, l };

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

  let h: number;
  switch (max) {
    case r:
      h = (g - b) / d + (g < b ? 6 : 0);
      break;
    case g:
      h = (b - r) / d + 2;
      break;
    default:
      h = (r - g) / d + 4;
      break;
  }
  h *= 60;

  return { h, s, l };
}

/** Below this saturation a colour reads as neutral rather than any particular hue. */
const ACHROMATIC_SATURATION = 0.08;

type HueFamily = 'red' | 'orange' | 'yellow' | 'green' | 'cyan' | 'blue' | 'purple' | 'pink';

/** Wheel order, matching the order families are described in the task and read visually. */
const FAMILY_ORDER: readonly HueFamily[] = [
  'red',
  'orange',
  'yellow',
  'green',
  'cyan',
  'blue',
  'purple',
  'pink',
];

/** Upper bound (exclusive) of each family's hue range, walked in wheel order from 0°. */
const FAMILY_BOUNDARIES: readonly [HueFamily, number][] = [
  ['red', 15],
  ['orange', 45],
  ['yellow', 70],
  ['green', 165],
  ['cyan', 195],
  ['blue', 255],
  ['purple', 290],
  ['pink', 345],
  // >= 345 wraps back to red.
];

function hueFamily(h: number): HueFamily {
  for (const [family, upperBound] of FAMILY_BOUNDARIES) {
    if (h < upperBound) return family;
  }
  return 'red';
}

/**
 * Sorts a list of LDraw colours by hue for browsing: achromatics grouped and ordered
 * light to dark, then chromatic families walked around the wheel, each ordered light
 * to dark within itself. Stable and pure — same input, same output, no DOM or three.js.
 */
export function sortColorsByHue<T extends LDrawColor>(colors: readonly T[]): T[] {
  const entries = colors.map((color) => ({ color, hsl: rgbToHsl(color.value) }));

  const achromatic = entries.filter((e) => e.hsl.s < ACHROMATIC_SATURATION);
  const chromatic = entries.filter((e) => e.hsl.s >= ACHROMATIC_SATURATION);

  achromatic.sort((a, b) => b.hsl.l - a.hsl.l);

  const familyRank = new Map<HueFamily, number>(FAMILY_ORDER.map((family, i) => [family, i]));
  chromatic.sort((a, b) => {
    const rankA = familyRank.get(hueFamily(a.hsl.h))!;
    const rankB = familyRank.get(hueFamily(b.hsl.h))!;
    if (rankA !== rankB) return rankA - rankB;
    return b.hsl.l - a.hsl.l;
  });

  return [...achromatic, ...chromatic].map((e) => e.color);
}
