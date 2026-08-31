import type { MaterialClass } from '../../ldraw/types';

/**
 * Reuses `MaterialClass` from the ldraw contract — it is exactly the taxonomy this
 * widget organizes around, and it is a type-only import with no runtime dependency on
 * `src/ldraw/`. The color list itself (`palette.ts`) is built from the real LDConfig.ldr
 * fixture, not from ldraw's runtime — this type still carries no import of it.
 */
export interface Swatch {
  /** LDraw color code. */
  code: number;
  name: string;
  /** '#rrggbb' */
  hex: string;
  /** '#rrggbb', used as the swatch's rim so near-white/near-black colors stay legible. */
  edgeHex: string;
  material: MaterialClass;
  /** 0–1. Present only for the transparent class. */
  alpha?: number;
}
