import { describe, expect, it } from 'vitest';

import { LDRAW_PALETTE } from './palette';

describe('LDRAW_PALETTE', () => {
  it('carries the real LDConfig.ldr palette, sentinels excluded', () => {
    // 322 declared colours minus the two sentinels (16 "inherit", 24 "edge").
    expect(LDRAW_PALETTE.length).toBe(320);
    expect(LDRAW_PALETTE.some((color) => color.code === 16)).toBe(false);
    expect(LDRAW_PALETTE.some((color) => color.code === 24)).toBe(false);
  });

  it('is sorted by colour code', () => {
    const codes = LDRAW_PALETTE.map((color) => color.code);
    const sorted = [...codes].sort((a, b) => a - b);
    expect(codes).toEqual(sorted);
  });

  it('shapes a known solid colour correctly', () => {
    const red = LDRAW_PALETTE.find((color) => color.code === 4);
    expect(red).toMatchObject({ code: 4, name: 'Red', hex: '#b40000', material: 'solid' });
    expect(red?.alpha).toBeUndefined();
  });

  it('turns LDConfig underscores into spaces in the display name', () => {
    const transClear = LDRAW_PALETTE.find((color) => color.code === 47);
    expect(transClear?.name).toBe('Trans Clear');
    expect(transClear?.name).not.toContain('_');
  });

  it('converts alpha to the 0-1 range the Swatch type expects', () => {
    const transClear = LDRAW_PALETTE.find((color) => color.code === 47);
    expect(transClear?.material).toBe('transparent');
    expect(transClear?.alpha).toBeCloseTo(128 / 255);
  });

  it('spans every material class', () => {
    const materials = new Set(LDRAW_PALETTE.map((color) => color.material));
    expect(materials).toEqual(
      new Set([
        'solid',
        'transparent',
        'chrome',
        'pearlescent',
        'metallic',
        'rubber',
        'glitter',
        'speckle',
        'fabric',
      ]),
    );
  });
});
