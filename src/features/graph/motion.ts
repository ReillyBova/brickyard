/**
 * Reads `--by-ease-snap` and the `--by-dur-*` tokens straight from computed style — the
 * same pattern `src/scene/theme.ts` uses for `--by-3d-*` colors — rather than restating
 * their values here. That means `prefers-reduced-motion`'s collapse to `0ms` /
 * `linear` (`tokens.css`) applies to this animation for free: nothing here has to know
 * reduced motion exists.
 */

function computedToken(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Parses a `<n>ms` custom property. Falls back if the token is missing or malformed. */
export function readDurationMs(name: string, fallback: number): number {
  const raw = computedToken(name);
  const match = /^([\d.]+)ms$/.exec(raw);
  if (!match) return fallback;
  const value = Number.parseFloat(match[1]);
  return Number.isFinite(value) ? value : fallback;
}

const LINEAR: readonly [number, number, number, number] = [0, 0, 1, 1];

/** Parses a `cubic-bezier(x1, y1, x2, y2)` custom property, e.g. `--by-ease-snap`. */
export function readEasing(name: string, fallback: readonly [number, number, number, number]): readonly [number, number, number, number] {
  const raw = computedToken(name);
  if (raw === 'linear') return LINEAR;
  const match = /^cubic-bezier\(\s*([\d.-]+)\s*,\s*([\d.-]+)\s*,\s*([\d.-]+)\s*,\s*([\d.-]+)\s*\)$/.exec(raw);
  if (!match) return fallback;
  const values = match.slice(1, 5).map(Number.parseFloat);
  if (values.some((v) => !Number.isFinite(v))) return fallback;
  return [values[0], values[1], values[2], values[3]];
}

/**
 * A CSS-spec-compatible cubic-bezier easing function: given the four control-point
 * coordinates (P0 = (0,0) and P3 = (1,1) are implicit), returns `t -> eased progress`.
 * Newton-Raphson with a bisection fallback, same approach the CSS Working Group's
 * reference implementation uses — this curve overshoots past 1.0 (that's the point of
 * `--by-ease-snap`), so callers must not clamp intermediate values.
 */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;

  const sampleX = (t: number): number => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number): number => ((ay * t + by) * t + cy) * t;
  const sampleDerivativeX = (t: number): number => (3 * ax * t + 2 * bx) * t + cx;

  const solveT = (x: number): number => {
    let t = x;
    for (let i = 0; i < 8; i++) {
      const dx = sampleX(t) - x;
      if (Math.abs(dx) < 1e-6) return t;
      const d = sampleDerivativeX(t);
      if (Math.abs(d) < 1e-6) break;
      t -= dx / d;
    }
    // Derivative-based search didn't converge (flat tangent) — bisect instead.
    let lo = 0;
    let hi = 1;
    t = x;
    while (hi - lo > 1e-6) {
      const dx = sampleX(t) - x;
      if (Math.abs(dx) < 1e-6) return t;
      if (dx > 0) hi = t;
      else lo = t;
      t = (lo + hi) / 2;
    }
    return t;
  };

  return (t: number): number => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    return sampleY(solveT(t));
  };
}
