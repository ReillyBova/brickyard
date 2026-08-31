/** Pure helpers for `AxonBrick`, split out so that file exports only the component. */

/** How many studs to paint, and which face geometry reads best at that count. */
export type StudCount = 1 | 2 | 4;

/** The four axonometric face tones `AxonBrick` paints, derived from one base colour. */
export interface BrickShades {
  left: string;
  right: string;
  top: string;
  hi: string;
}

/** Reads "N x M" out of an LDraw title to pick a plausible stud count, capped at 4. */
export function studsForTitle(title: string): StudCount {
  const match = /(\d+)\s*x\s*(\d+)/i.exec(title);
  if (match === null) return 1;
  const product = Number(match[1]) * Number(match[2]);
  if (product <= 1) return 1;
  if (product === 2) return 2;
  return 4;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function rgbToHex([r, g, b]: readonly [number, number, number]): string {
  const toByte = (v: number) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
  return `#${toByte(r)}${toByte(g)}${toByte(b)}`;
}

/** `[h 0-360, s 0-1, l 0-1]`. */
function rgbToHsl([r, g, b]: readonly [number, number, number]): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return [h * 60, s, l];
}

function hslToRgb([h, s, l]: readonly [number, number, number]): [number, number, number] {
  if (s === 0) {
    const v = l * 255;
    return [v, v, v];
  }
  const hue2rgb = (p: number, q: number, t: number): number => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hn = h / 360;
  return [hue2rgb(p, q, hn + 1 / 3) * 255, hue2rgb(p, q, hn) * 255, hue2rgb(p, q, hn - 1 / 3) * 255];
}

function withLightness(hex: string, delta: number): string {
  const [h, s, l] = rgbToHsl(hexToRgb(hex));
  const nl = clamp(l + delta, 0.03, 0.97);
  return rgbToHex(hslToRgb([h, s, nl]));
}

/**
 * Derives the four axonometric face shades of `AxonBrick` from one base LDraw colour, by
 * lightness offset on the same hue and saturation. A brick rendered in any real colour reads
 * as one lit object rather than four unrelated hand-picked tones.
 */
export function shadesFromHex(hex: string): BrickShades {
  return {
    left: withLightness(hex, -0.16),
    right: withLightness(hex, -0.04),
    top: withLightness(hex, 0.14),
    hi: withLightness(hex, 0.3),
  };
}
