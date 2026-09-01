import { describe, expect, it } from 'vitest';

import { cubicBezier } from './motion';

describe('cubicBezier', () => {
  it('is the identity for a linear control-point pair', () => {
    const ease = cubicBezier(0, 0, 1, 1);
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      expect(ease(t)).toBeCloseTo(t, 3);
    }
  });

  it('pins the endpoints regardless of control points', () => {
    const ease = cubicBezier(0.2, 1.1, 0.3, 1.18); // --by-ease-snap
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
  });

  it('matches the commonly-cited midpoint for CSS "ease" (0.25, 0.1, 0.25, 1)', () => {
    const ease = cubicBezier(0.25, 0.1, 0.25, 1);
    expect(ease(0.5)).toBeCloseTo(0.8024, 2);
  });

  it('overshoots past 1 for --by-ease-snap, which is the point of that curve', () => {
    const ease = cubicBezier(0.2, 1.1, 0.3, 1.18);
    const sampled = Array.from({ length: 50 }, (_, i) => ease(i / 49));
    expect(Math.max(...sampled)).toBeGreaterThan(1);
  });
});
