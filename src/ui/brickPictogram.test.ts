import { describe, expect, it } from 'vitest';

import { shadesFromHex, studsForTitle } from './brickPictogram';

describe('studsForTitle', () => {
  it('reads a stud count from an "N x M" title', () => {
    expect(studsForTitle('Brick 2 x 4')).toBe(4);
    expect(studsForTitle('Plate 1 x 2')).toBe(2);
    expect(studsForTitle('Brick 1 x 1')).toBe(1);
  });

  it('caps larger products at 4', () => {
    expect(studsForTitle('Plate 4 x 4')).toBe(4);
    expect(studsForTitle('Brick 2 x 6')).toBe(4);
  });

  it('falls back to 1 stud when the title carries no dimension', () => {
    expect(studsForTitle('Technic Pin')).toBe(1);
    expect(studsForTitle('Minifig Head')).toBe(1);
  });
});

describe('shadesFromHex', () => {
  it('derives four distinct shades that stay valid hex colours', () => {
    const shades = shadesFromHex('#c91a09');
    for (const value of Object.values(shades)) expect(value).toMatch(/^#[0-9a-f]{6}$/);
    const values = Object.values(shades);
    expect(new Set(values).size).toBe(values.length);
  });

  it('orders shades from darkest (left) to brightest (hi)', () => {
    const lightnessOf = (hex: string) => {
      const n = Number.parseInt(hex.slice(1), 16);
      const r = (n >> 16) & 0xff;
      const g = (n >> 8) & 0xff;
      const b = n & 0xff;
      return (Math.max(r, g, b) + Math.min(r, g, b)) / 2;
    };
    const { left, right, top, hi } = shadesFromHex('#0055bf');
    expect(lightnessOf(left)).toBeLessThan(lightnessOf(right));
    expect(lightnessOf(right)).toBeLessThan(lightnessOf(top));
    expect(lightnessOf(top)).toBeLessThan(lightnessOf(hi));
  });

  it('does not overflow at the extremes of the value range', () => {
    expect(shadesFromHex('#000000').hi).toMatch(/^#[0-9a-f]{6}$/);
    expect(shadesFromHex('#ffffff').left).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('preserves hue: a red input stays red-dominant across every shade', () => {
    const { left, right, top, hi } = shadesFromHex('#c91a09');
    for (const hex of [left, right, top, hi]) {
      const n = Number.parseInt(hex.slice(1), 16);
      const r = (n >> 16) & 0xff;
      const g = (n >> 8) & 0xff;
      const b = n & 0xff;
      expect(r).toBeGreaterThan(g);
      expect(r).toBeGreaterThan(b);
    }
  });
});
