import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { fromBasis, multiply } from '../../math';
import { parseMpd } from './parseMpd';

const FIXTURE_DIR = join(__dirname, '__fixtures__');

const readFixture = (name: string): string => readFileSync(join(FIXTURE_DIR, name), 'utf8');

describe('parseMpd', () => {
  const text = readFixture('10156-truck.mpd');
  const parsed = parseMpd(text, '10156 - LEGO Truck.mpd');

  it('flattens every leaf part reference across all three submodels', () => {
    // The file has 113 type-1 lines total (`grep -c '^1 '`), but 2 of those are the
    // root's references to the TRUCK and MINIFIG submodels themselves, not part leaves.
    // Flattening replaces each submodel reference with its contents rather than
    // counting it, so the leaf-only figure is 111.
    expect(parsed.refs).toHaveLength(111);
  });

  it('counts unique parts', () => {
    // 51 distinct leaf part filenames; the raw 53-distinct-filename figure over the
    // whole document also counts the 2 submodel files (TRUCK.LDR, MINIFIG.LDR), which
    // never need a PartDef resolved.
    expect(parsed.uniquePartIds).toHaveLength(51);
  });

  it('counts every 0 FILE section, including the root model', () => {
    expect(parsed.submodelCount).toBe(3);
  });

  it('keeps 0 STEP boundaries, even though nothing consumes them yet', () => {
    // Measured: 17 `0 STEP` lines in the truck submodel.
    expect(parsed.stepBreaks).toHaveLength(17);
    // Breaks are indices into the flattened `refs` array, strictly increasing.
    for (let i = 1; i < parsed.stepBreaks.length; i++) {
      expect(parsed.stepBreaks[i]).toBeGreaterThan(parsed.stepBreaks[i - 1]);
    }
  });

  it('flattens the 30-degree submodel rotation correctly, not merely axis-aligned', () => {
    // `10156 - TRUCK.LDR` is placed by the main file at a genuine 30-degree rotation
    // about Y (`docs/AGENTS.md`'s "your task" measurement: 0.86603 / -0.499992 in the
    // reference line), not a lattice-aligned identity or 90-degree step. Composing that
    // with a known reference inside the submodel (`2465.DAT` at local (0, -24, 10))
    // must match a transform computed by hand from the same two matrix rows, so the
    // flattening is verified against the file's real numbers rather than an assumption.
    const submodelWorld = fromBasis(
      [0.86603, 0, 0.499992, 0, 1, 0, -0.499992, 0, 0.86603],
      [127.943619, -24, 53],
    );
    const localRef = fromBasis([1, 0, 0, 0, 1, 0, 0, 0, 1], [0, -24, 10]);
    const expected = multiply(submodelWorld, localRef);

    const match = parsed.refs.find(
      (r) => r.partId === '2465' && Math.abs(r.transform[14] - expected[14]) < 1e-3,
    );
    expect(match).toBeDefined();
    for (let i = 0; i < 16; i++) {
      expect(match!.transform[i]).toBeCloseTo(expected[i], 3);
    }

    // And it is genuinely not axis-aligned: the composed basis has non-zero components
    // off the diagonal from the rotation, so a naive "assume identity or 90-degree
    // steps" implementation would fail this.
    expect(Math.abs(expected[0] - 1)).toBeGreaterThan(0.01);
  });

  it('resolves color 16 (inherit) through the reference chain', () => {
    // The minifig submodel is referenced with color 1 at the root; its own head/torso
    // references (color 16) must inherit that, not fall back to the root default.
    // 3626BP04.DAT is referenced with color 14 explicitly in the fixture, so pick a
    // part referenced with 16 instead: 4485.DAT (the minifig legs) is `1 16 ...`.
    const legs = parsed.refs.find((r) => r.partId === '4485');
    expect(legs).toBeDefined();
    // The minifig submodel itself is placed with color 1 (`1 1 -100 0 10 ... MINIFIG.LDR`).
    expect(legs!.colorCode).toBe(1);
  });

  it('is pure: parsing the same text twice yields structurally equal results', () => {
    const again = parseMpd(text, '10156 - LEGO Truck.mpd');
    expect(again.refs).toHaveLength(parsed.refs.length);
    expect(again.uniquePartIds).toEqual(parsed.uniquePartIds);
  });
});

describe('parseMpd — no FILE header', () => {
  it('treats a plain .ldr document as a single implicit section', () => {
    const text = ['1 4 0 0 0 1 0 0 0 1 0 0 0 1 3001.dat', '1 4 20 0 0 1 0 0 0 1 0 0 0 1 3002.dat'].join(
      '\n',
    );
    const parsed = parseMpd(text, 'loose.ldr');
    expect(parsed.refs).toHaveLength(2);
    expect(parsed.submodelCount).toBe(1);
    expect(parsed.uniquePartIds).toEqual(['3001', '3002']);
  });
});

describe('parseMpd — locally-embedded OMR part overrides', () => {
  // 10281 - main.ldr (Bonsai Tree) references `10281 - 65473.dat`, a local copy of the
  // branch elbow (LDraw id 65473) embedded because the part predated the public library
  // at submission time — the elbow's own body is drawn directly (type-4 quads under
  // `s\10281 - 65473s01.dat`), not just referenced, so treating the embedded file as a
  // pure submodel and recursing into only its `1` lines drops that geometry. The elbow is
  // official on the library now, so the fix is to resolve the reference as the real
  // external id `65473` instead.
  const text = readFixture('10281-bonsai-branch.mpd');
  const parsed = parseMpd(text, '10281 - Bonsai Tree.mpd');

  it('resolves a local OMR override to its real external part id, not a leftover fragment', () => {
    const elbow = parsed.refs.find((r) => r.partId === '65473');
    expect(elbow).toBeDefined();
    // Nothing from the embedded file's own subpart/primitive references — 65473s01,
    // tm08q2639, tm08q2111 — should appear as its own ref; the real part id stands in
    // for the whole thing rather than reconstructing it from fragments.
    expect(parsed.refs.some((r) => r.partId.includes('65473s01'))).toBe(false);
    expect(parsed.refs.some((r) => r.partId.includes('tm08q'))).toBe(false);
  });

  it('keeps a plain external leaf untouched', () => {
    expect(parsed.refs.some((r) => r.partId === '98138')).toBe(true);
  });

  it('falls back to recursing when the embedded name has no real-id form', () => {
    // `10281 - flex-cable2.ldr` also draws its own geometry (LDCad's generated flexible
    // hose fallback), but "flex-cable2" isn't a bare LDraw part id — there's no real
    // external part to resolve to. It should still recurse into its own `1` lines, so
    // the two genuine external references it makes (27965k01, the end caps) resolve,
    // even though the hose body itself is lost either way.
    const caps = parsed.refs.filter((r) => r.partId === '27965k01');
    expect(caps).toHaveLength(2);
    expect(parsed.uniquePartIds).not.toContain('flex-cable2');
  });

  it('does not recurse into a resolved override, so its own submodelCount is unaffected', () => {
    // 3 sections: main, the 65473 override, the flex-cable2 override.
    expect(parsed.submodelCount).toBe(3);
  });
});
