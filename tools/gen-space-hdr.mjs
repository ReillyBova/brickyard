#!/usr/bin/env node
/**
 * Generates `public/env/space_nebula.hdr` — the one procedural entry in render mode's
 * environment set (`src/features/pathtrace/environments.ts`, id `space`). Poly Haven, the
 * source for every other environment here, has no genuine starfield/nebula HDRI: its "night"
 * category is all Earth landscapes under a starry sky, horizon and foreground included, which
 * reads as "a dark field", not "space". Nothing else CC0 fits a floating-spaceship shot either,
 * so this is a deliberate, narrow exception to sourcing environments as real photographs.
 *
 * Run with `node tools/gen-space-hdr.mjs` to regenerate.
 *
 * Written as the plain (uncompressed, non-run-length-encoded) Radiance RGBE format: a short
 * ASCII header naming the resolution, followed by 4 raw bytes (R, G, B, shared exponent) per
 * pixel, row-major from the top scanline. three.js's `HDRLoader` (which `RGBELoader` now wraps)
 * falls back to reading exactly this layout whenever a scanline's first two bytes are not both
 * 0x02 — the marker for the newer run-length-encoded format — so no encoder beyond "write the
 * bytes" is needed. See `RGBE_ReadPixels_RLE` in
 * `node_modules/three/examples/jsm/loaders/HDRLoader.js` for the exact fallback check this
 * output is shaped to satisfy.
 *
 * No compression, so the file size is exactly `width * height * 4` bytes — kept small (512×256,
 * ~512 KiB) since procedural content has no fine detail an RLE-compressed photograph would
 * otherwise buy back, and this asset ships in the same GitHub Pages bundle as the other six.
 *
 * The map is never fully black: every direction gets at least `BASE_FLOOR` radiance, so the
 * environment always contributes *some* image-based fill light rather than leaving the model a
 * silhouette against pure space — see environments.ts's doc comment on the `space` entry.
 */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const WIDTH = 512;
const HEIGHT = 256;
const OUT_PATH = fileURLToPath(new URL('../public/env/space_nebula.hdr', import.meta.url));

/** Soft nebula blobs: normalised equirect centre (u, v), angular radius, RGB colour, peak
 *  intensity. Small and dim relative to `BASE_FLOOR` — space should read as mostly dark with a
 *  few drifting glows, not a coloured wash — but spread across both hemispheres so the model
 *  gets fill light from more than one side regardless of the environment's rotation dial. */
const NEBULAE = [
  { u: 0.15, v: 0.35, radius: 0.16, color: [0.55, 0.25, 0.85], peak: 0.16 }, // violet
  { u: 0.62, v: 0.55, radius: 0.2, color: [0.15, 0.45, 0.9], peak: 0.14 }, // blue
  { u: 0.4, v: 0.7, radius: 0.13, color: [0.9, 0.35, 0.55], peak: 0.11 }, // magenta
  { u: 0.85, v: 0.2, radius: 0.14, color: [0.2, 0.75, 0.7], peak: 0.1 }, // teal
];

const BASE_FLOOR = 0.02;

function floatToRgbe(r, g, b) {
  const v = Math.max(r, g, b);
  if (v < 1e-32) return [0, 0, 0, 0];
  // frexp: v = mantissa * 2^exponent, 0.5 <= mantissa < 1.
  let exponent = Math.ceil(Math.log2(v));
  let mantissa = v / 2 ** exponent;
  if (mantissa >= 1) {
    mantissa /= 2;
    exponent += 1;
  }
  const scale = (mantissa * 256) / v;
  return [
    Math.min(255, Math.floor(r * scale)),
    Math.min(255, Math.floor(g * scale)),
    Math.min(255, Math.floor(b * scale)),
    exponent + 128,
  ];
}

/** Angular distance on the equirect map: `u` (longitude) wraps at the seam, `v` (latitude) does
 *  not. Not a true spherical distance — cheap enough for a build-time script and the blobs are
 *  soft enough that the flat-map distortion near the poles never shows. */
function angularDist(u1, v1, u2, v2) {
  const du = Math.min(Math.abs(u1 - u2), 1 - Math.abs(u1 - u2));
  const dv = v1 - v2;
  return Math.hypot(du, dv);
}

/** Deterministic per-pixel hash standing in for a PRNG — the star field is a pure function of
 *  (x, y) rather than a sequential random stream, so it doesn't shift if WIDTH/HEIGHT change. */
function hash(x, y) {
  return (x * 92821 + y * 68917) >>> 0;
}

const pixels = Buffer.alloc(WIDTH * HEIGHT * 4);
let idx = 0;
for (let y = 0; y < HEIGHT; y++) {
  const v = (y + 0.5) / HEIGHT;
  for (let x = 0; x < WIDTH; x++) {
    const u = (x + 0.5) / WIDTH;

    let r = BASE_FLOOR;
    let g = BASE_FLOOR;
    let b = BASE_FLOOR;
    for (const nebula of NEBULAE) {
      const d = angularDist(u, v, nebula.u, nebula.v);
      if (d < nebula.radius * 2.2) {
        const falloff = Math.exp((-3 * (d * d)) / (nebula.radius * nebula.radius));
        const intensity = nebula.peak * falloff;
        r += nebula.color[0] * intensity;
        g += nebula.color[1] * intensity;
        b += nebula.color[2] * intensity;
      }
    }

    const h = hash(x, y);
    if (h % 500 === 0) {
      const starRand = ((h >> 8) % 1000) / 1000;
      const brightness = 4 + starRand * 10;
      if (h % 4000 < 300) {
        // Occasional warm star among the mostly blue-white field.
        r += brightness * 1.0;
        g += brightness * 0.75;
        b += brightness * 0.55;
      } else {
        r += brightness * 0.85;
        g += brightness * 0.92;
        b += brightness * 1.0;
      }
    }

    const [rr, gg, bb, ee] = floatToRgbe(r, g, b);
    pixels[idx++] = rr;
    pixels[idx++] = gg;
    pixels[idx++] = bb;
    pixels[idx++] = ee;
  }
}

// Guard against the astronomically unlikely case that pixel (0,0)'s first two bytes happen to
// both be 0x02 — the byte pattern HDRLoader reads as "this is the newer RLE format" — which
// would make it misparse this plain buffer as compressed.
if (pixels[0] === 2 && pixels[1] === 2) {
  throw new Error('pixel (0,0) collides with the RLE marker byte — nudge BASE_FLOOR and retry');
}

const header = Buffer.from(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${HEIGHT} +X ${WIDTH}\n`, 'ascii');
writeFileSync(OUT_PATH, Buffer.concat([header, pixels]));

// eslint-disable-next-line no-console
console.log(`wrote ${OUT_PATH} (${header.length + pixels.length} bytes)`);
