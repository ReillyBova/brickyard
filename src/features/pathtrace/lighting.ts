/**
 * Continuous lighting dials for render mode's key light and environment framing. No presets —
 * warmth and position are things a person wants to nudge, not pick from four fixed points, and
 * `PathTracerController` applies every change here without a scene rebake (see its
 * `updateLighting`), so a slider can be dragged live.
 *
 * Pure — no three.js, no DOM — so the math (colour temperature, spherical-to-Cartesian
 * direction) is unit-testable on its own. `PathTracerController` is what turns these into an
 * actual `ShapedAreaLight` and renderer/scene settings.
 */

export interface LightingSettings {
  /** Compass direction the key light shines from, degrees. 0 = +Z, 90 = +X — see
   *  `sunDirectionFor`. */
  readonly azimuthDeg: number;
  /** Height above the horizon, degrees: 0 grazes the baseplate, 90 is straight overhead. */
  readonly elevationDeg: number;
  /** Colour temperature, kelvin. Lower reads warmer/redder, higher reads cooler/bluer. */
  readonly warmthK: number;
  /** Brightness multiplier on the key light. */
  readonly intensity: number;
  /** 0: a near-point source with hard shadow edges. 1: a big soft source, barely any shadow. */
  readonly softness: number;
  /** Rotates the environment map — and its visible background — around the vertical axis. */
  readonly envRotationDeg: number;
  /** Renderer tone-mapping exposure. */
  readonly exposure: number;
  /** Whether the environment map is visible behind the model. Off keeps the model lit by the
   *  environment but shows a plain background instead, matching the chrome around the
   *  viewport. */
  readonly showBackground: boolean;
}

export const DEFAULT_LIGHTING: LightingSettings = {
  azimuthDeg: 35,
  elevationDeg: 55,
  warmthK: 5500,
  intensity: 3,
  softness: 0.3,
  envRotationDeg: 0,
  exposure: 1,
  showBackground: true,
};

const MIN_KELVIN = 1500;
const MAX_KELVIN = 12000;

/** Unit direction the key light shines *from*, in three.js world space (Y up). */
export function sunDirectionFor(
  settings: Pick<LightingSettings, 'azimuthDeg' | 'elevationDeg'>,
): [number, number, number] {
  const az = (settings.azimuthDeg * Math.PI) / 180;
  const el = (settings.elevationDeg * Math.PI) / 180;
  const cosEl = Math.cos(el);
  return [cosEl * Math.sin(az), Math.sin(el), cosEl * Math.cos(az)];
}

/**
 * Approximate black-body colour for a temperature in kelvin, normalised so the brightest
 * channel is 1. Tanner Helland's widely used curve fit to Mitchell Charity's blackbody tables;
 * accurate enough for a lighting dial over the 1500K-12000K range this control is clamped to
 * (candle-warm through overcast-blue).
 */
export function kelvinToRGB(kelvin: number): [number, number, number] {
  const k = Math.min(MAX_KELVIN, Math.max(MIN_KELVIN, kelvin)) / 100;

  let r: number;
  let g: number;
  if (k <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(k) - 161.1195681661;
  } else {
    r = 329.698727446 * (k - 60) ** -0.1332047592;
    g = 288.1221695283 * (k - 60) ** -0.0755148492;
  }

  let b: number;
  if (k >= 66) {
    b = 255;
  } else if (k <= 19) {
    b = 0;
  } else {
    b = 138.5177312231 * Math.log(k - 10) - 305.0447927307;
  }

  const clamp01 = (v: number) => Math.min(1, Math.max(0, v / 255));
  return [clamp01(r), clamp01(g), clamp01(b)];
}
