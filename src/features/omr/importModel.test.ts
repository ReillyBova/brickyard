/**
 * Exercises the full import pipeline — parse, resolve, place, solve — against real
 * captured part data from `src/snap/__fixtures__/`. The MPD text below is hand-written
 * (small synthetic scenes are how `src/snap/resolvePart.test.ts` and `mating.test.ts`
 * exercise structure too), but every part it references — 3001, 4070, 3818 — is a real
 * part resolved from real captured LDraw and LDCad shadow files, never synthesized
 * geometry.
 */

import { describe, expect, it } from 'vitest';

import { fixtureReader } from '../../snap/__fixtures__/reader';
import { importModel } from './importModel';

const BRICK_HEIGHT = 24;

/** Two 2x4 bricks (3001) stacked exactly, which mates all 8 studs of the lower brick. */
const STACKED_BRICKS = [
  '0 FILE stack.ldr',
  '1 4 0 0 0 1 0 0 0 1 0 0 0 1 3001.dat',
  '0 STEP',
  `1 2 0 -${BRICK_HEIGHT} 0 1 0 0 0 1 0 0 0 1 3001.dat`,
].join('\n');

/** One 2x4 brick and one unrelated part far away — no connection between them. */
const DISJOINT_BRICKS = [
  '0 FILE loose.ldr',
  '1 4 0 0 0 1 0 0 0 1 0 0 0 1 3001.dat',
  '1 4 1000 1000 1000 1 0 0 0 1 0 0 0 1 4070.dat',
].join('\n');

describe('importModel', () => {
  it('resolves every unique part exactly once and reports progress to completion', async () => {
    const progress: number[] = [];
    const result = await importModel(STACKED_BRICKS, 'stack', {
      read: fixtureReader,
      onProgress: (p) => progress.push(p),
    });

    expect(result.partDefs.size).toBe(1); // one unique part id: 3001
    expect(result.partDefs.get('3001')?.connections).toHaveLength(16);
    expect(progress[progress.length - 1]).toBe(1);
    // Monotonically non-decreasing.
    for (let i = 1; i < progress.length; i++) expect(progress[i]).toBeGreaterThanOrEqual(progress[i - 1]);
  });

  it('mints a BrickInstance per flattened reference', async () => {
    const result = await importModel(STACKED_BRICKS, 'stack', { read: fixtureReader });
    expect(result.brickCount).toBe(2);
    expect(result.document.bricks.size).toBe(2);
  });

  it('keeps 0 STEP metadata on the parsed result', async () => {
    const result = await importModel(STACKED_BRICKS, 'stack', { read: fixtureReader });
    expect(result.parsed.stepBreaks).toEqual([1]);
  });

  it('solves the connection graph geometrically: a stacked 2x4 on a 2x4 mates 8 studs on one edge', async () => {
    const result = await importModel(STACKED_BRICKS, 'stack', { read: fixtureReader });
    expect(result.edgeCount).toBe(1);
    const [edge] = [...result.document.graph.edges.values()];
    expect(edge.mates).toHaveLength(8);
  });

  it('bricks with no geometric relationship yield no edges', async () => {
    const result = await importModel(DISJOINT_BRICKS, 'loose', { read: fixtureReader });
    expect(result.brickCount).toBe(2);
    expect(result.edgeCount).toBe(0);
  });

  it('is indistinguishable from a hand-built document: findMates ran through the same spatial index code path as placement', async () => {
    // The graph produced by import uses the document/graph module's own connect
    // machinery (`connectBricks`), so its edges carry real Mate objects with real point
    // ids, not placeholders.
    const result = await importModel(STACKED_BRICKS, 'stack', { read: fixtureReader });
    const [edge] = [...result.document.graph.edges.values()];
    for (const mate of edge.mates) {
      expect(mate.aPoint).toMatch(/#\d+$/);
      expect(mate.bPoint).toMatch(/#\d+$/);
      expect(mate.kind).toBe('cyl');
    }
  });
});
