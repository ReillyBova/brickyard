/**
 * Environment maps for render mode: HDR photographs, vendored under `public/env/` and loaded
 * with three's own `RGBELoader` — the same approach three.js's own path-tracer example
 * (`webgl_renderer_pathtracer`) uses for `royal_esplanade_2k.hdr.jpg`. The path tracer samples
 * the actual texture pixel in a missed ray's direction, for both the visible background and
 * every specular reflection, so these read as real places: a window throws a real highlight
 * across glossy ABS, the studio floor grounds the model in a real horizon line.
 *
 * Seven of the eight are real photographs (Poly Haven, CC0, 1k). The eighth, `space`, is a real
 * galactic-plane render — Poly Haven's "night" HDRIs are all Earth landscapes under a starry
 * sky, not a clean starfield, and no CC0 nebula/starfield photograph fits a floating spaceship
 * shot. `galactic_plane_1k.hdr` is sourced from spacespheremaps.com (CC BY 4.0, no attribution
 * required though credited anyway — see README.md), downsampled from its native 10000×5000 PNG
 * to 1024×512 and converted to RGBE. The source render is otherwise very dark (mean linear
 * radiance ~0.0017 — almost entirely void between the galactic band and a few stars), so a flat
 * 0.02 floor is added everywhere and the galaxy's own signal is boosted ×20 before encoding,
 * bringing the mean radiance to ~0.055 — close to Low-key's contrast without leaving the model a
 * silhouette against pure black. Plain (uncompressed) RGBE, like three.js's own path-tracer
 * example uses as a fallback — `RGBELoader`/`HDRLoader` reads this layout directly, no RLE
 * encoder needed.
 *
 * Fetched from our own origin rather than a third party — GitHub Pages serves `public/` with
 * its own headers, so a Poly Haven URL would risk CORS trouble a same-origin file never does.
 * See README.md for attribution.
 *
 * Loads are cached by id — switching environments back and forth after the first visit is a
 * cache hit, not a re-download.
 */

import { EquirectangularReflectionMapping, type Texture } from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';

export interface PathtraceEnvironment {
  readonly id: string;
  readonly label: string;
  /** Shown as the option's tooltip and under its label in the environment dropdown. */
  readonly description: string;
  /** File under `public/env/`, loaded as `/env/<file>`. */
  readonly file: string;
}

export const ENVIRONMENTS: readonly PathtraceEnvironment[] = [
  {
    id: 'warm-studio',
    label: 'Warm studio',
    description: 'A brown-toned photo studio with a single soft key light — warm, gentle, the default.',
    file: 'brown_photostudio_02_1k.hdr',
  },
  {
    id: 'studio',
    label: 'Studio',
    description: 'A small softbox studio, even and neutral product-photo light.',
    file: 'studio_small_08_1k.hdr',
  },
  {
    id: 'showroom',
    label: 'Showroom',
    description: 'A bright white cyclorama lit by large octaboxes — clean, even, catalogue-bright.',
    file: 'studio_small_09_1k.hdr',
  },
  {
    id: 'daylight-interior',
    label: 'Daylight interior',
    description: 'A glasshouse lit through large windows — soft, low-contrast indoor daylight.',
    file: 'glasshouse_interior_1k.hdr',
  },
  {
    id: 'overcast',
    label: 'Overcast',
    description: 'An overcast sky over open ground — soft, directionless outdoor shadows.',
    file: 'kloofendal_overcast_puresky_1k.hdr',
  },
  {
    id: 'golden-hour',
    label: 'Golden hour',
    description: 'A low sun over water at Venice — a warm horizon under a deep evening sky.',
    file: 'venice_sunset_1k.hdr',
  },
  {
    id: 'low-key',
    label: 'Low-key',
    description: 'A single overhead dish light in a dark studio — dramatic, high-contrast, moody.',
    file: 'studio_small_05_1k.hdr',
  },
  {
    id: 'space',
    label: 'Space',
    description:
      'A real galactic-plane starfield — for minifigs, spaceships and anything that should look ' +
      'like it belongs off-world. Dim by design: push the key light toward Low-key\'s settings ' +
      'and consider hiding the ground.',
    file: 'galactic_plane_1k.hdr',
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
