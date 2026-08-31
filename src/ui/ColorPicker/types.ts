import type { MaterialClass } from '../../ldraw/types';

/**
 * Reuses `MaterialClass` from the ldraw contract — it is exactly the taxonomy this
 * widget organises around, and it is a type-only import with no runtime dependency on
 * `src/ldraw/`. The colour list itself stays local mock data.
 */
export interface Swatch {
  /** LDraw colour code. */
  code: number;
  name: string;
  /** '#rrggbb' */
  hex: string;
  /** '#rrggbb', used as the swatch's rim so near-white/near-black colours stay legible. */
  edgeHex: string;
  material: MaterialClass;
  /** 0–1. Present only for the transparent class. */
  alpha?: number;
}
