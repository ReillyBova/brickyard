import { describe, expect, it } from 'vitest';

import { kelvinToRGB, sunDirectionFor } from './lighting.ts';

describe('sunDirectionFor', () => {
  it('points straight up at 90 degrees elevation regardless of azimuth', () => {
    const [x, y, z] = sunDirectionFor({ azimuthDeg: 200, elevationDeg: 90 });
    expect(y).toBeCloseTo(1, 5);
    expect(x).toBeCloseTo(0, 5);
    expect(z).toBeCloseTo(0, 5);
  });

  it('lies in the horizon plane at 0 degrees elevation', () => {
    const [, y] = sunDirectionFor({ azimuthDeg: 45, elevationDeg: 0 });
    expect(y).toBeCloseTo(0, 5);
  });

  it('returns a unit vector', () => {
    const [x, y, z] = sunDirectionFor({ azimuthDeg: 73, elevationDeg: 31 });
    expect(Math.hypot(x, y, z)).toBeCloseTo(1, 5);
  });
});

describe('kelvinToRGB', () => {
  it('reads warmer (more red, less blue) at low temperatures than high ones', () => {
    const warm = kelvinToRGB(2000);
    const cool = kelvinToRGB(10000);
    expect(warm[0]).toBeGreaterThan(cool[0]);
    expect(warm[2]).toBeLessThan(cool[2]);
  });

  it('clamps to the supported range instead of producing nonsense colours', () => {
    const tooLow = kelvinToRGB(100);
    const tooHigh = kelvinToRGB(50000);
    for (const channel of [...tooLow, ...tooHigh]) {
      expect(channel).toBeGreaterThanOrEqual(0);
      expect(channel).toBeLessThanOrEqual(1);
    }
  });

  it('is roughly neutral around daylight white (~6500K)', () => {
    const [r, g, b] = kelvinToRGB(6500);
    expect(r).toBeGreaterThan(0.85);
    expect(g).toBeGreaterThan(0.85);
    expect(b).toBeGreaterThan(0.85);
  });
});
