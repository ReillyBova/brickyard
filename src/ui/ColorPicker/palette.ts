/**
 * The real LDraw palette (322 colours), shaped for the picker from
 * `src/ldraw/bundledLibrary.ts` — the app's single bundled copy of `LDConfig.ldr`,
 * shared with `src/scene/colorLibrary.ts` so the picker and the renderer can never
 * disagree about what a color code means. This module only shapes the result into
 * the local `Swatch` type the picker renders.
 */
import { isSentinelCode } from '../../ldraw/colors';
import { BUNDLED_COLOR_LIBRARY } from '../../ldraw/bundledLibrary';
import type { LDrawColor } from '../../ldraw/types';
import { sortColorsByHue } from './hueSort';
import type { Swatch } from './types';

function toHex(value: number): string {
  return `#${value.toString(16).padStart(6, '0')}`;
}

/** LDConfig names are underscore-separated, e.g. `Trans_Light_Blue`. */
function displayName(name: string): string {
  return name.replace(/_/g, ' ');
}

function toSwatch(color: LDrawColor): Swatch {
  const swatch: Swatch = {
    code: color.code,
    name: displayName(color.name),
    hex: toHex(color.value),
    edgeHex: toHex(color.edge),
    material: color.material,
  };
  if (color.alpha !== undefined) swatch.alpha = color.alpha / 255;
  return swatch;
}

/**
 * Every real LDraw colour, sentinels (16 "inherit", 24 "edge") excluded because they
 * resolve against a referencing line rather than naming a colour a user can pick.
 * Sorted by hue (`sortColorsByHue`) so a particular colour can be found by scanning
 * rather than by knowing its LDraw code — see `hueSort.ts`. The color-picker's
 * solid/accordion split groups the result further by material; hue order applies
 * within each of those groups.
 */
export const LDRAW_PALETTE: readonly Swatch[] = sortColorsByHue(
  Array.from(BUNDLED_COLOR_LIBRARY.values()).filter((color) => !isSentinelCode(color.code)),
).map(toSwatch);
