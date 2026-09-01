/**
 * Lighting presets for render mode: a key light's direction, colour and angular size (how
 * "area" it reads as — see `PathTracerController`'s `jitteredSunDirection` cone), plus an
 * ambient multiplier applied over whichever `PathtraceEnvironment` sky is active. All in
 * three.js world space (Y up), matching `SceneRenderer`'s raster `DirectionalLight` and the
 * baked scene, which already lands in that same space.
 *
 * A wider `sunRadius` is what makes the key read as a small softbox rather than a bare
 * point light — it widens the cone `jitteredSunDirection` samples for next-event shadow
 * rays, the same mechanism a real area light's penumbra comes from.
 */

export interface LightingPreset {
  readonly id: string;
  readonly label: string;
  /** What this preset is for — shown as the control's tooltip. */
  readonly description: string;
  readonly sunDirection: readonly [number, number, number];
  readonly sunColor: readonly [number, number, number];
  /** Angular radius of the key light's sampling cone. Bigger = softer shadows. */
  readonly sunRadius: number;
  /** Scales the active environment's sky colours — fill light, in effect. */
  readonly ambientMultiplier: number;
}

export const LIGHTING_PRESETS: readonly LightingPreset[] = [
  {
    id: 'studio',
    label: 'Studio',
    description: 'A soft key light just off-camera, front and slightly high — even, dependable product light.',
    sunDirection: [0.5, 0.82, 0.33],
    sunColor: [2.6, 2.55, 2.4],
    sunRadius: 0.07,
    ambientMultiplier: 1,
  },
  {
    id: 'golden-hour',
    label: 'Golden hour',
    description: 'A low, warm directional light with long soft shadows.',
    sunDirection: [0.75, 0.28, 0.35],
    sunColor: [3.2, 2.1, 1.15],
    sunRadius: 0.05,
    ambientMultiplier: 0.8,
  },
  {
    id: 'dramatic-rim',
    label: 'Dramatic rim',
    description: 'A hard, low-key light from behind the model, for contrast and a bright rim edge.',
    sunDirection: [-0.4, 0.35, -0.82],
    sunColor: [3.4, 3.3, 3.5],
    sunRadius: 0.015,
    ambientMultiplier: 0.35,
  },
  {
    id: 'catalogue',
    label: 'Catalogue',
    description: 'Flat, even, nearly shadowless light — reads colour and shape with no drama.',
    sunDirection: [0.35, 0.9, 0.25],
    sunColor: [2.1, 2.1, 2.05],
    sunRadius: 0.16,
    ambientMultiplier: 1.6,
  },
];

export const DEFAULT_LIGHTING: LightingPreset = LIGHTING_PRESETS[0];

export function findLighting(id: string): LightingPreset {
  return LIGHTING_PRESETS.find((l) => l.id === id) ?? DEFAULT_LIGHTING;
}
