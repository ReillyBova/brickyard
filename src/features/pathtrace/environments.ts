/**
 * Environment maps for render mode: real equirectangular textures, generated at runtime with
 * three-gpu-pathtracer's `ProceduralEquirectTexture` rather than fetched. The path tracer
 * samples the actual texture pixel in a missed ray's direction — for both the visible
 * background and every specular reflection — so unlike a flat two-stop sky gradient these read
 * as real environments: a bright patch throws a real highlight across glossy ABS, the way
 * three.js's `webgl_materials_envmaps` examples show off with a fetched HDRI.
 *
 * Deliberately not fetched: GitHub Pages can't set the caching/CORS headers that make a
 * repeat-visit HDRI free, and a real one runs hundreds of KB to multiple MB even compressed.
 * Every environment below costs 0 bytes over the network — it's built in memory the first time
 * it's selected, at 192×96 (float RGBA, ~280KB of GPU texture memory — a generated buffer, not
 * a download).
 */

import { Color, MathUtils, Vector3 } from 'three';
import { ProceduralEquirectTexture } from 'three-gpu-pathtracer';

export interface EnvironmentHighlight {
  readonly azimuthDeg: number;
  readonly elevationDeg: number;
  readonly angularRadiusDeg: number;
  readonly color: readonly [number, number, number];
  /** Added on top of the sky gradient at the highlight's centre; falls off to 0 at its edge. */
  readonly intensity: number;
}

export interface PathtraceEnvironment {
  readonly id: string;
  readonly label: string;
  /** Shown as the option's tooltip. */
  readonly description: string;
  /** Sky colour straight up, linear RGB. */
  readonly zenith: readonly [number, number, number];
  /** Sky colour at the horizon. */
  readonly horizon: readonly [number, number, number];
  /** Ground-facing colour, straight down — usually the darkest of the three. */
  readonly nadir: readonly [number, number, number];
  /** Bright patches (a window, a softbox, a sun disc) that give glossy plastic something
   *  directional to reflect, rather than a featureless gradient. */
  readonly highlights: readonly EnvironmentHighlight[];
  readonly floorColor: readonly [number, number, number];
  readonly floorRoughness: number;
}

const TEXTURE_WIDTH = 192;
const TEXTURE_HEIGHT = 96;

function lerp3(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  t: number,
): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function smoothstep(t: number): number {
  const x = MathUtils.clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

function directionFor(azimuthDeg: number, elevationDeg: number): Vector3 {
  const az = MathUtils.degToRad(azimuthDeg);
  const el = MathUtils.degToRad(elevationDeg);
  const cosEl = Math.cos(el);
  return new Vector3(cosEl * Math.sin(az), Math.sin(el), cosEl * Math.cos(az));
}

const _dir = new Vector3();

/** Builds the actual equirect texture for one environment. Cheap enough (under 20k pixels) to
 *  build fresh on every selection — see `PathTracerController.updateEnvironment`. */
export function buildEnvironmentTexture(env: PathtraceEnvironment): ProceduralEquirectTexture {
  const highlightDirs = env.highlights.map((h) => ({ h, dir: directionFor(h.azimuthDeg, h.elevationDeg) }));

  const texture = new ProceduralEquirectTexture(TEXTURE_WIDTH, TEXTURE_HEIGHT);
  texture.generationCallback = (polar, _uv, _coord, color: Color) => {
    _dir.setFromSpherical(polar);
    const t = _dir.y * 0.5 + 0.5;
    const base = t > 0.5 ? lerp3(env.horizon, env.zenith, (t - 0.5) * 2) : lerp3(env.nadir, env.horizon, t * 2);
    color.setRGB(base[0], base[1], base[2]);

    for (const { h, dir } of highlightDirs) {
      const angle = Math.acos(MathUtils.clamp(_dir.dot(dir), -1, 1));
      const radius = MathUtils.degToRad(h.angularRadiusDeg);
      if (angle >= radius) continue;
      const falloff = 1 - smoothstep(angle / radius);
      color.r += h.color[0] * h.intensity * falloff;
      color.g += h.color[1] * h.intensity * falloff;
      color.b += h.color[2] * h.intensity * falloff;
    }
  };
  texture.update();
  return texture;
}

export const ENVIRONMENTS: readonly PathtraceEnvironment[] = [
  {
    id: 'studio',
    label: 'Studio',
    description: 'A neutral grey cyclorama lit by two soft overhead panels — even product-photo light.',
    zenith: [0.62, 0.62, 0.64],
    horizon: [0.3, 0.3, 0.32],
    nadir: [0.07, 0.07, 0.08],
    highlights: [
      { azimuthDeg: 55, elevationDeg: 68, angularRadiusDeg: 22, color: [1, 0.99, 0.95], intensity: 2.4 },
      { azimuthDeg: -70, elevationDeg: 55, angularRadiusDeg: 18, color: [0.9, 0.95, 1], intensity: 1.2 },
    ],
    floorColor: [0.5, 0.5, 0.52],
    floorRoughness: 0.55,
  },
  {
    id: 'warm-interior',
    label: 'Warm interior',
    description: 'A living-room window: warm side light from one direction, dim overhead.',
    zenith: [0.1, 0.08, 0.07],
    horizon: [0.35, 0.24, 0.15],
    nadir: [0.05, 0.04, 0.03],
    highlights: [{ azimuthDeg: 100, elevationDeg: 25, angularRadiusDeg: 30, color: [1, 0.82, 0.55], intensity: 3 }],
    floorColor: [0.42, 0.28, 0.17],
    floorRoughness: 0.5,
  },
  {
    id: 'cool-overcast',
    label: 'Cool overcast',
    description: 'Flat, bright, low-contrast — an overcast sky, almost shadowless.',
    zenith: [0.46, 0.48, 0.51],
    horizon: [0.52, 0.53, 0.55],
    nadir: [0.28, 0.28, 0.27],
    highlights: [],
    floorColor: [0.35, 0.35, 0.34],
    floorRoughness: 0.75,
  },
  {
    id: 'sunset',
    label: 'Sunset',
    description: 'A low sun on a warm horizon under a deep blue sky, with a visible sun disc.',
    zenith: [0.04, 0.05, 0.14],
    horizon: [0.7, 0.32, 0.12],
    nadir: [0.05, 0.04, 0.05],
    highlights: [{ azimuthDeg: -20, elevationDeg: 8, angularRadiusDeg: 4, color: [1, 0.75, 0.4], intensity: 14 }],
    floorColor: [0.3, 0.22, 0.19],
    floorRoughness: 0.6,
  },
  {
    id: 'showroom',
    label: 'Showroom',
    description: 'A bright white infinity floor with a soft ceiling glow — clean catalogue light.',
    zenith: [0.85, 0.85, 0.87],
    horizon: [0.7, 0.7, 0.72],
    nadir: [0.55, 0.55, 0.57],
    highlights: [{ azimuthDeg: 0, elevationDeg: 85, angularRadiusDeg: 35, color: [1, 1, 1], intensity: 1.6 }],
    floorColor: [0.82, 0.82, 0.84],
    floorRoughness: 0.35,
  },
];

export const DEFAULT_ENVIRONMENT: PathtraceEnvironment = ENVIRONMENTS[0];

export function findEnvironment(id: string): PathtraceEnvironment {
  return ENVIRONMENTS.find((e) => e.id === id) ?? DEFAULT_ENVIRONMENT;
}
