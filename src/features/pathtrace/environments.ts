/**
 * Environment maps for render mode: HDR photographs, vendored under `public/env/` and loaded
 * with three's own `RGBELoader` — the same approach three.js's own path-tracer example
 * (`webgl_renderer_pathtracer`) uses for `royal_esplanade_2k.hdr.jpg`. The path tracer samples
 * the actual texture pixel in a missed ray's direction, for both the visible background and
 * every specular reflection, so these read as real places: a window throws a real highlight
 * across glossy ABS, the studio floor grounds the model in a real horizon line.
 *
 * Six of the seven are real photographs (Poly Haven, CC0, 1k). The seventh, `space`, is
 * procedurally generated — Poly Haven's "night" HDRIs are all Earth landscapes under a starry
 * sky, not a clean starfield, and no CC0 nebula/starfield photograph fits a floating spaceship
 * shot. `space_nebula.hdr` is a small (512×256, ~0.5 MB, uncompressed) generated equirectangular
 * map: soft colour-blob nebulae plus scattered point stars, built by
 * `tools/gen-space-hdr.py` — never fully black, so the environment still contributes real
 * image-based fill light rather than leaving the model a silhouette (see that script's own doc
 * for the RGBE format details).
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
      'A dark starfield with drifting colour nebulae — for minifigs, spaceships and anything that ' +
      'should look like it belongs off-world. Dim by design: push the key light toward Low-key\'s ' +
      'settings and consider hiding the ground.',
    file: 'space_nebula.hdr',
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
