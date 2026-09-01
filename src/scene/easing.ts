/**
 * A JS-evaluable cubic-bezier easing, so `--by-ease-snap`'s overshoot can drive a
 * `requestAnimationFrame` tween instead of only a CSS transition.
 *
 * `docs/DESIGN.md` rule 5 is "nothing in the render loop is animated by CSS" — brick
 * arrivals are exactly that, so the *shape* of the motion (the token) is shared with CSS,
 * but the evaluation is our own. Endpoints are fixed at (0,0) and (1,1), matching CSS's
 * `cubic-bezier()` function; only the two control points vary.
 */

export interface BezierPoints {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Parses `cubic-bezier(x1, y1, x2, y2)`. Returns `null` for anything else (e.g. `linear`,
 *  which reduced-motion falls back to — callers treat `null` as "don't ease, just cut"). */
export function parseCubicBezier(value: string): BezierPoints | null {
  const match = /cubic-bezier\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/.exec(
    value,
  );
  if (!match) return null;
  const [x1, y1, x2, y2] = match.slice(1, 5).map(Number);
  if ([x1, y1, x2, y2].some((n) => !Number.isFinite(n))) return null;
  return { x1, y1, x2, y2 };
}

const NEWTON_ITERATIONS = 8;
const NEWTON_EPSILON = 1e-7;

/**
 * Builds a `t -> y` easing function from the four control points of a CSS-style cubic
 * bezier with fixed endpoints (0,0)-(1,1). `t` is elapsed/duration, `0..1`; the input `t`
 * is first solved for the bezier parameter via Newton-Raphson (falling back to bisection)
 * since the bezier is parametric in `x`, not directly invertible.
 */
export function cubicBezier({ x1, y1, x2, y2 }: BezierPoints): (t: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;

  const sampleX = (t: number): number => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number): number => ((ay * t + by) * t + cy) * t;
  const sampleDerivativeX = (t: number): number => (3 * ax * t + 2 * bx) * t + cx;

  const solveForT = (x: number): number => {
    let t = x; // decent initial guess for the common case (near-linear x mapping)
    for (let i = 0; i < NEWTON_ITERATIONS; i++) {
      const dx = sampleX(t) - x;
      if (Math.abs(dx) < NEWTON_EPSILON) return t;
      const d = sampleDerivativeX(t);
      if (Math.abs(d) < NEWTON_EPSILON) break;
      t -= dx / d;
    }
    // Newton failed to converge (flat derivative) — bisect instead of returning garbage.
    let lo = 0;
    let hi = 1;
    t = x;
    while (hi - lo > NEWTON_EPSILON) {
      const guess = sampleX(t);
      if (Math.abs(guess - x) < NEWTON_EPSILON) return t;
      if (guess < x) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return t;
  };

  return (t: number): number => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    return sampleY(solveForT(t));
  };
}
