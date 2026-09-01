import { describe, expect, it } from 'vitest';

import { applyKnownCorrections } from './corrections.ts';

const UNPATCHED_973P1U = [
  '0 Minifig Torso with Zipper Jacket and  3 Pockets Pattern',
  '0 BFC CERTIFY CCW',
  '',
  '4 16 14.345 2 10 12 0 10 -12 0 10 -14.345 2 10',
  '4 16 19 29 10 14.345 2 10 -14.345 2 10 -19 29 10',
  '4 16 19 32 10 19 29 10 -19 29 10 -19 32 10',
  '1 16 0 0 0 1 0 0 0 1 0 0 0 1 s\\973s01.dat',
].join('\n');

describe('applyKnownCorrections', () => {
  it('reverses 973p1u.dat\'s inward-wound back-panel quads', () => {
    const corrected = applyKnownCorrections('973p1u', UNPATCHED_973P1U);
    expect(corrected).toContain('4 16 -14.345 2 10 -12 0 10 12 0 10 14.345 2 10');
    expect(corrected).toContain('4 16 -19 29 10 -14.345 2 10 14.345 2 10 19 29 10');
    expect(corrected).toContain('4 16 -19 32 10 -19 29 10 19 29 10 19 32 10');
    expect(corrected).not.toContain('4 16 14.345 2 10 12 0 10 -12 0 10 -14.345 2 10');
  });

  it('leaves every other line untouched, including the reference the panel sits beside', () => {
    const corrected = applyKnownCorrections('973p1u', UNPATCHED_973P1U);
    expect(corrected).toContain('1 16 0 0 0 1 0 0 0 1 0 0 0 1 s\\973s01.dat');
    expect(corrected).toContain('0 BFC CERTIFY CCW');
  });

  it('matches by bare id, path, filename, and case, all the same way', () => {
    const byBareId = applyKnownCorrections('973p1u', UNPATCHED_973P1U);
    const byPath = applyKnownCorrections('parts/973p1u.dat', UNPATCHED_973P1U);
    const byUppercase = applyKnownCorrections('973P1U.DAT', UNPATCHED_973P1U);
    expect(byPath).toBe(byBareId);
    expect(byUppercase).toBe(byBareId);
  });

  it('passes through a part with no known correction unchanged', () => {
    const text = '0 Brick 2 x 4\n0 BFC CERTIFY CCW\n4 16 0 0 0 80 0 0 80 0 40 0 0 40\n';
    expect(applyKnownCorrections('3001', text)).toBe(text);
  });

  it('is inert if a targeted line no longer matches verbatim — the mirror synced past it', () => {
    const alreadySyncedDifferently = UNPATCHED_973P1U.replace(
      '4 16 14.345 2 10 12 0 10 -12 0 10 -14.345 2 10',
      '4 16 -14.345 2 10 -12 0 10 12 0 10 14.345 2 10',
    );
    const corrected = applyKnownCorrections('973p1u', alreadySyncedDifferently);
    // Already matches the fixed vertex order — the patch table's old-line key no longer
    // matches anything, so this one line passes through exactly as given, not re-patched
    // (or, worse, re-broken back to the inward-wound order).
    expect(corrected).toContain('4 16 -14.345 2 10 -12 0 10 12 0 10 14.345 2 10');
  });
});
