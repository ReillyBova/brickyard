import { describe, expect, it } from 'vitest';

import { cubicBezier, parseCubicBezier } from './easing';

describe('parseCubicBezier', () => {
  it('parses the tokens.css --by-ease-snap value', () => {
    expect(parseCubicBezier('cubic-bezier(0.2, 1.1, 0.3, 1.18)')).toEqual({
      x1: 0.2,
      y1: 1.1,
      x2: 0.3,
      y2: 1.18,
    });
  });

  it('parses negative control points', () => {
    expect(parseCubicBezier('cubic-bezier(-0.5, 0, 1, 1.5)')).toEqual({ x1: -0.5, y1: 0, x2: 1, y2: 1.5 });
  });

  it('returns null for non-bezier values, e.g. the reduced-motion "linear" override', () => {
    expect(parseCubicBezier('linear')).toBeNull();
    expect(parseCubicBezier('')).toBeNull();
    expect(parseCubicBezier('ease-in-out')).toBeNull();
  });
});

describe('cubicBezier', () => {
  it('is anchored at the endpoints', () => {
    const ease = cubicBezier({ x1: 0.2, y1: 1.1, x2: 0.3, y2: 1.18 });
    expect(ease(0)).toBeCloseTo(0, 5);
    expect(ease(1)).toBeCloseTo(1, 5);
  });

  it('clamps outside 0..1', () => {
    const ease = cubicBezier({ x1: 0.2, y1: 1.1, x2: 0.3, y2: 1.18 });
    expect(ease(-1)).toBe(0);
    expect(ease(2)).toBe(1);
  });

  it('reproduces the linear diagonal for a linear bezier', () => {
    const ease = cubicBezier({ x1: 0, y1: 0, x2: 1, y2: 1 });
    for (const t of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      expect(ease(t)).toBeCloseTo(t, 4);
    }
  });

  it('the --by-ease-snap curve overshoots past 1 before settling', () => {
    // Control points (0.2, 1.1) and (0.3, 1.18) push y above 1 mid-curve — that overshoot
    // is the whole point of the token (docs/DESIGN.md: "pulled the last fraction of a
    // millimetre"). Confirm at least one sampled point actually exceeds 1.
    const ease = cubicBezier({ x1: 0.2, y1: 1.1, x2: 0.3, y2: 1.18 });
    const samples = Array.from({ length: 50 }, (_, i) => ease(i / 49));
    expect(Math.max(...samples)).toBeGreaterThan(1);
  });

  it('is monotonically increasing in x for an ease-out style curve', () => {
    const ease = cubicBezier({ x1: 0.22, y1: 0.9, x2: 0.3, y2: 1 });
    let prev = -Infinity;
    for (let i = 0; i <= 20; i++) {
      const y = ease(i / 20);
      expect(y).toBeGreaterThanOrEqual(prev - 1e-6);
      prev = y;
    }
  });
});
