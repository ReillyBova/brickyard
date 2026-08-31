/**
 * Colour materials for rendering. Fetches and parses `LDConfig.ldr` once, then hands
 * out a cached three.js material per LDraw colour code.
 *
 * This intentionally reuses `src/ldraw/colors.ts` — the same palette parser the rest of
 * the app uses — rather than re-parsing colour lines here.
 */

import * as THREE from 'three';

import { parseColorLibrary } from '../ldraw/colors.ts';
import type { ColorLibrary, LDrawColor } from '../ldraw/types.ts';

export type { ColorLibrary, LDrawColor };

/** Fetches and parses the official colour palette from `baseUrl + 'LDConfig.ldr'`. */
export async function fetchColorLibrary(baseUrl: string): Promise<ColorLibrary> {
  const response = await fetch(`${baseUrl}LDConfig.ldr`);
  if (!response.ok) {
    throw new Error(`colorLibrary: failed to fetch LDConfig.ldr (${response.status})`);
  }
  const text = await response.text();
  return parseColorLibrary(text);
}

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

  constructor(library: ColorLibrary) {
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
