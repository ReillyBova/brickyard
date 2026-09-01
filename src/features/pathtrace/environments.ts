/**
 * Environment maps for render mode: real HDR photographs, vendored under `public/env/` and
 * loaded with three's own `RGBELoader` — the same approach three.js's own path-tracer example
 * (`webgl_renderer_pathtracer`) uses for `royal_esplanade_2k.hdr.jpg`. The path tracer samples
 * the actual texture pixel in a missed ray's direction, for both the visible background and
 * every specular reflection, so these read as real places: a window throws a real highlight
 * across glossy ABS, the studio floor grounds the model in a real horizon line.
 *
 * Fetched from our own origin rather than a third party — GitHub Pages serves `public/` with
 * its own headers, so a Poly Haven URL would risk CORS trouble a same-origin file never does.
 * Every file here is CC0 (Poly Haven); see README.md for attribution.
 *
 * Loads are cached by id — switching environments back and forth after the first visit is a
 * cache hit, not a re-download.
 */

import { EquirectangularReflectionMapping, type Texture } from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';

export interface PathtraceEnvironment {
  readonly id: string;
  readonly label: string;
  /** Shown as the option's tooltip. */
  readonly description: string;
  /** File under `public/env/`, loaded as `/env/<file>`. */
  readonly file: string;
  /** Grounding floor's own material — the HDRI lights and reflects it, but its base colour and
   *  roughness are still a real material choice, not part of the texture. */
  readonly floorColor: readonly [number, number, number];
  readonly floorRoughness: number;
}

export const ENVIRONMENTS: readonly PathtraceEnvironment[] = [
  {
    id: 'studio',
    label: 'Studio',
    description: 'A small softbox studio — even, neutral product-photo light.',
    file: 'studio_small_08_1k.hdr',
    floorColor: [0.5, 0.5, 0.52],
    floorRoughness: 0.55,
  },
  {
    id: 'photostudio',
    label: 'Warm studio',
    description: 'A brown-toned photo studio with a single soft key light.',
    file: 'brown_photostudio_02_1k.hdr',
    floorColor: [0.42, 0.28, 0.17],
    floorRoughness: 0.5,
  },
  {
    id: 'overcast',
    label: 'Overcast sky',
    description: 'A partly cloudy sky over open ground — bright, outdoor, low contrast.',
    file: 'kloofendal_48d_partly_cloudy_puresky_1k.hdr',
    floorColor: [0.35, 0.35, 0.34],
    floorRoughness: 0.75,
  },
  {
    id: 'sunset',
    label: 'Sunset',
    description: 'A low sun over water at Venice, warm horizon under a deep sky.',
    file: 'venice_sunset_1k.hdr',
    floorColor: [0.3, 0.22, 0.19],
    floorRoughness: 0.6,
  },
  {
    id: 'industrial',
    label: 'Industrial',
    description: 'A clear sky over an industrial yard — bright, hard-edged daylight.',
    file: 'industrial_sunset_02_puresky_1k.hdr',
    floorColor: [0.55, 0.55, 0.55],
    floorRoughness: 0.4,
  },
];

export const DEFAULT_ENVIRONMENT: PathtraceEnvironment = ENVIRONMENTS[0];

export function findEnvironment(id: string): PathtraceEnvironment {
  return ENVIRONMENTS.find((e) => e.id === id) ?? DEFAULT_ENVIRONMENT;
}

const loader = new RGBELoader();
const cache = new Map<string, Promise<Texture>>();

/** Loads (and caches) the HDR equirectangular texture for one environment. The returned
 *  texture is shared across every caller and must never be disposed by a caller — it lives for
 *  the page's lifetime, the same way a fetched asset would in any other cache. */
export function loadEnvironmentTexture(env: PathtraceEnvironment): Promise<Texture> {
  let promise = cache.get(env.id);
  if (promise === undefined) {
    promise = loader.loadAsync(`${import.meta.env.BASE_URL}env/${env.file}`).then((texture) => {
      texture.mapping = EquirectangularReflectionMapping;
      return texture;
    });
    cache.set(env.id, promise);
  }
  return promise;
}
