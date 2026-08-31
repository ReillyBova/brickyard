/**
 * The real LDraw palette (322 colours), built at bundle time from the same
 * `LDConfig.ldr` fixture the ldraw slice tests against — imported as raw text, never
 * fetched. `src/ldraw/colors.ts` does the parsing; this module only shapes the result
 * into the local `Swatch` type the picker renders.
 */
import { isSentinelCode, parseColorLibrary } from '../../ldraw/colors';
import type { LDrawColor } from '../../ldraw/types';
import ldConfigText from '../../ldraw/__fixtures__/mirror/library/LDConfig.ldr?raw';
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

const library = parseColorLibrary(ldConfigText);

/**
 * Every real LDraw colour, sentinels (16 "inherit", 24 "edge") excluded because they
 * resolve against a referencing line rather than naming a colour a user can pick.
 * Sorted by colour code for a stable, deterministic order.
 */
export const LDRAW_PALETTE: readonly Swatch[] = Array.from(library.values())
  .filter((color) => !isSentinelCode(color.code))
  .sort((a, b) => a.code - b.code)
  .map(toSwatch);
