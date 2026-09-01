/**
 * Colour materials for rendering: one cached three.js material per LDraw colour code,
 * resolved from `src/ldraw/bundledLibrary.ts` — the same bundled `LDConfig.ldr` the
 * color picker (`src/ui/ColorPicker/palette.ts`) builds its swatches from.
 *
 * This used to fetch its own copy of `LDConfig.ldr` from the upstream mirror at
 * runtime. That bought nothing — the data was already sitting in the bundle — and
 * cost a real bug: the mirror's copy and the bundled fixture disagree on which codes
 * exist, so a color the picker offered (bundled) could come back unresolved here
 * (fetched) and silently render as `FALLBACK_COLOR`'s grey. One bundled copy, shared
 * by both, makes that divergence structurally impossible rather than something a test
 * has to keep catching after the fact.
 */

import * as THREE from 'three';

import { BUNDLED_COLOR_LIBRARY } from '../ldraw/bundledLibrary.ts';
import type { ColorLibrary, LDrawColor } from '../ldraw/types.ts';

export type { ColorLibrary, LDrawColor };

/**
 * Only reachable for a color code truly absent from the bundled library — malformed
 * or hand-authored input, not anything the picker can offer, since the picker is
 * built from this same library.
 */
const FALLBACK_COLOR: LDrawColor = {
  code: 16,
  name: 'Main_Colour',
  value: 0xa0a0a0,
  edge: 0x333333,
  material: 'solid',
};

/**
 * Caches one `MeshStandardMaterial` per colour code so N bricks of the same colour
 * share a material instance, same as they share geometry.
 */
export class MaterialCache {
  private readonly library: ColorLibrary;
  private readonly cache = new Map<number, THREE.MeshStandardMaterial>();

  constructor(library: ColorLibrary = BUNDLED_COLOR_LIBRARY) {
    this.library = library;
  }

  get(colorCode: number): THREE.MeshStandardMaterial {
    const cached = this.cache.get(colorCode);
    if (cached !== undefined) return cached;

    const entry = this.library.get(colorCode) ?? FALLBACK_COLOR;
    const material = new THREE.MeshStandardMaterial({
      color: entry.value,
      roughness: 0.45,
      metalness: entry.material === 'metallic' || entry.material === 'chrome' ? 0.8 : 0.05,
    });
    if (entry.alpha !== undefined) {
      material.transparent = true;
      material.opacity = entry.alpha / 255;
    }
    this.cache.set(colorCode, material);
    return material;
  }

  dispose(): void {
    for (const material of this.cache.values()) material.dispose();
    this.cache.clear();
  }
}
