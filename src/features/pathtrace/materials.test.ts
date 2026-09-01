import { describe, expect, it } from 'vitest';

import { physicalParamsFor } from './materials.ts';
import type { LDrawColor } from '../../ldraw/types.ts';

function color(overrides: Partial<LDrawColor>): LDrawColor {
  return { code: 0, name: 'Test', value: 0x808080, edge: 0x333333, material: 'solid', ...overrides };
}

describe('physicalParamsFor', () => {
  it('chrome is fully metallic with no clearcoat', () => {
    const params = physicalParamsFor(color({ material: 'chrome', value: 0xc0c0c0 }));
    expect(params.metalness).toBe(1);
    expect(params.clearcoat).toBe(0);
  });

  it('rubber is rough with no clearcoat or sheen', () => {
    const params = physicalParamsFor(color({ material: 'rubber', value: 0x1b1b1b }));
    expect(params.roughness).toBeGreaterThan(0.8);
    expect(params.clearcoat).toBe(0);
    expect(params.sheen).toBe(0);
  });

  it('transparent colors carry the LDraw color as attenuation tint, not base color', () => {
    const params = physicalParamsFor(color({ material: 'transparent', value: 0x0000ff, alpha: 128 }));
    expect(params.transmission).toBeGreaterThan(0.5);
    expect(params.attenuationColor[2]).toBeGreaterThan(params.attenuationColor[0]);
  });

  it('an alpha on a non-transparent finish becomes opacity rather than transmission', () => {
    const params = physicalParamsFor(color({ material: 'solid', alpha: 200 }));
    expect(params.transmission).toBe(0);
    expect(params.opacity).toBeCloseTo(200 / 255, 5);
  });

  it('light solid colors pick up a touch of transmission; dark ones do not', () => {
    const light = physicalParamsFor(color({ material: 'solid', value: 0xffffff }));
    const dark = physicalParamsFor(color({ material: 'solid', value: 0x1a1a1a }));
    expect(light.transmission).toBeGreaterThan(0);
    expect(dark.transmission).toBe(0);
  });

  it('pearlescent adds sheen brightened toward white', () => {
    const params = physicalParamsFor(color({ material: 'pearlescent', value: 0x996633 }));
    expect(params.sheen).toBeGreaterThan(0);
    expect(params.sheenColor[0]).toBeGreaterThan(0x99 / 255);
  });

  it('solid ABS is glossy, not matte, at a real-plastic IOR', () => {
    const params = physicalParamsFor(color({ material: 'solid', value: 0x1a1a1a }));
    expect(params.roughness).toBeLessThan(0.3);
    expect(params.clearcoat).toBeGreaterThan(0);
    expect(params.ior).toBeCloseTo(1.53, 1);
  });

  it('transparent parts absorb strongly over an ordinary brick thickness', () => {
    const params = physicalParamsFor(color({ material: 'transparent', value: 0xc4281c, alpha: 128 }));
    // Beer-Lambert: remaining transmittance at `attenuationDistance` equals `attenuationColor`
    // exactly, so a short distance relative to typical part size (tens of LDU) is what makes
    // the tint read as strong rather than pale — see shaders.ts.
    expect(params.attenuationDistance).toBeLessThan(30);
    expect(params.transmission).toBeGreaterThan(0.9);
  });

  it('every finish returns colors and scalars in range', () => {
    const finishes: LDrawColor['material'][] = [
      'solid',
      'transparent',
      'chrome',
      'pearlescent',
      'metallic',
      'rubber',
      'glitter',
      'speckle',
      'fabric',
    ];
    for (const material of finishes) {
      const params = physicalParamsFor(color({ material, value: 0x4488cc }));
      for (const channel of [...params.color, ...params.attenuationColor, ...params.sheenColor]) {
        expect(channel).toBeGreaterThanOrEqual(0);
        expect(channel).toBeLessThanOrEqual(1);
      }
      expect(params.opacity).toBeGreaterThan(0);
      expect(params.opacity).toBeLessThanOrEqual(1);
      expect(params.roughness).toBeGreaterThanOrEqual(0);
      expect(params.metalness).toBeGreaterThanOrEqual(0);
    }
  });
});
