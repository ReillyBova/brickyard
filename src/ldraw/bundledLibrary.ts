/**
 * The one bundled copy of the official LDraw color palette — parsed once at module
 * load from the fixture committed at `__fixtures__/mirror/library/LDConfig.ldr`,
 * imported as raw text and never fetched.
 *
 * This is the single source of truth for what an LDraw color code means anywhere in
 * the app. It used to be two: `src/ui/ColorPicker/palette.ts` parsed this same bundled
 * fixture for the picker's swatches, while `src/scene/colorLibrary.ts` fetched a
 * second copy of `LDConfig.ldr` from the upstream mirror at runtime for the renderer's
 * materials — two independent snapshots of the same file, and they disagree: the
 * upstream mirror's `LDConfig.ldr` at the time of writing carries 204 colors against
 * this fixture's 322, missing well over a hundred codes including plain solids like
 * "Bright Blue Violet" (code 431). A code present in the bundled fixture but absent
 * from whatever the mirror served that day was pickable — the picker only ever knew
 * about the bundled copy — and then rendered as `MaterialCache`'s grey fallback,
 * indistinguishable at a glance from an intentionally muted color. Fetching a second
 * copy of data already sitting in the bundle bought nothing and cost exactly this bug
 * class; every consumer of LDraw colors should import `BUNDLED_COLOR_LIBRARY`.
 */
import ldConfigText from './__fixtures__/mirror/library/LDConfig.ldr?raw';
import { parseColorLibrary } from './colors';
import type { ColorLibrary } from './types';

export const BUNDLED_COLOR_LIBRARY: ColorLibrary = parseColorLibrary(ldConfigText);
