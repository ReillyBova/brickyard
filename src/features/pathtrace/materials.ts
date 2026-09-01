/**
 * LDraw finish classes to physical shading parameters. Pure — plain numbers, no three.js — so the
 * mapping is unit-testable on its own; `sceneBake.ts` packs the result into the uniform arrays the
 * trace shader reads.
 *
 * ABS is not plain diffuse plastic: injection-molded parts are noticeably glossy — a distinct
 * clearcoat lobe over a low-roughness base, IOR ~1.53 — and light colors let a little light
 * travel under the surface before it scatters back out. Neither of those is a special case here
 * — every LDraw color gets a touch of clearcoat and, if light enough, a touch of
 * `transmission`+`attenuation` standing in for that shallow subsurface softness — plain `solid`
 * is just the default point in the same parameter space the other finishes occupy.
 *
 * `transparent` parts are solid tinted volumes, not thin dyed shells: `attenuationColor` and
 * `attenuationDistance` here are Beer-Lambert absorption parameters the trace shader
 * (`shaders.ts`) integrates over the ray's actual path length inside the part, not a flat
 * per-surface tint.
 */

import type { LDrawColor, MaterialClass } from '../../ldraw/types.ts';

export interface PathtraceMaterial {
  readonly color: readonly [number, number, number];
  readonly roughness: number;
  readonly metalness: number;
  readonly clearcoat: number;
  readonly clearcoatRoughness: number;
  readonly transmission: number;
  readonly ior: number;
  /** Tint absorbed light takes on as it travels `attenuationDistance` (LDU) through the material. */
  readonly attenuationColor: readonly [number, number, number];
  readonly attenuationDistance: number;
  /** 1 = fully opaque. */
  readonly opacity: number;
  /** Sheen lobe strength — cloth and pearlescent grazing-angle brightening. */
  readonly sheen: number;
  readonly sheenColor: readonly [number, number, number];
}

const WHITE: readonly [number, number, number] = [1, 1, 1];

function hexToRgb(value: number): [number, number, number] {
  return [((value >> 16) & 0xff) / 255, ((value >> 8) & 0xff) / 255, (value & 0xff) / 255];
}

function lerp3(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  t: number,
): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Rec. 709 relative luminance, used only to decide how much light-color "softness" to add. */
function luminance(rgb: readonly [number, number, number]): number {
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

// Injection-moulded ABS: a dielectric at IOR ~1.53, noticeably glossy rather than matte —
// low base roughness plus a distinct clearcoat lobe on top, per docs/DESIGN.md-adjacent
// research: moulded plastic reads as "manufactured", not "sanded".
const BASE: PathtraceMaterial = {
  color: [0.6, 0.6, 0.6],
  roughness: 0.22,
  metalness: 0,
  clearcoat: 0.55,
  clearcoatRoughness: 0.12,
  transmission: 0,
  ior: 1.53,
  attenuationColor: WHITE,
  attenuationDistance: 1000,
  opacity: 1,
  sheen: 0,
  sheenColor: WHITE,
};

/** Maps one LDraw palette entry to path-trace material parameters. */
export function physicalParamsFor(entry: LDrawColor): PathtraceMaterial {
  const color = hexToRgb(entry.value);
  const params = byFinish(entry.material, color);

  if (entry.alpha !== undefined && entry.material !== 'transparent') {
    return { ...params, opacity: entry.alpha / 255 };
  }
  return params;
}

function byFinish(material: MaterialClass, color: readonly [number, number, number]): PathtraceMaterial {
  switch (material) {
    case 'chrome':
      return { ...BASE, color, metalness: 1, roughness: 0.06, clearcoat: 0 };

    case 'metallic':
      return { ...BASE, color, metalness: 0.85, roughness: 0.3, clearcoat: 0.15 };

    case 'pearlescent':
      return {
        ...BASE,
        color,
        metalness: 0.2,
        roughness: 0.32,
        clearcoat: 0.7,
        clearcoatRoughness: 0.12,
        sheen: 0.4,
        sheenColor: lerp3(color, WHITE, 0.6),
      };

    case 'rubber':
      return { ...BASE, color, roughness: 0.92, clearcoat: 0, sheen: 0 };

    case 'fabric':
      return { ...BASE, color, roughness: 0.85, clearcoat: 0, sheen: 0.6, sheenColor: color };

    case 'glitter':
    case 'speckle':
      // No per-particle texture data at this scale; approximate the sparkle as a livelier
      // clearcoat + a little sheen rather than inventing per-fleck geometry.
      return { ...BASE, color, roughness: 0.4, clearcoat: 0.6, sheen: 0.25, sheenColor: WHITE };

    case 'transparent':
      // A solid volume, not a thin tinted shell: the trace shader integrates real
      // Beer-Lambert absorption (`exp(-sigma * distance)`, `sigma` derived from
      // `attenuationColor`/`attenuationDistance` below) over however far the ray actually
      // travels inside the part, rather than applying one flat tint per surface crossing.
      // A short attenuation distance is what makes that read as *strongly* tinted glass at
      // ordinary brick thickness (tens of LDU) instead of pale — the LDraw colour is deep,
      // fully saturated glass, not a wash.
      return {
        ...BASE,
        color: WHITE,
        roughness: 0.04,
        clearcoat: 0.35,
        transmission: 0.97,
        ior: 1.55,
        attenuationColor: color,
        attenuationDistance: 22,
      };

    case 'solid':
    default: {
      const lum = luminance(color);
      if (lum > 0.55) {
        // Light colors read as slightly waxy: a little light survives a short trip under the
        // surface before scattering back, tinted toward the base color rather than pure white.
        return {
          ...BASE,
          color,
          transmission: 0.07,
          attenuationColor: lerp3(color, WHITE, 0.3),
          attenuationDistance: 40,
        };
      }
      return { ...BASE, color };
    }
  }
}
