/**
 * Exercises the full import pipeline — parse, resolve, place, solve — against real
 * captured part data from `src/snap/__fixtures__/`. The MPD text below is hand-written
 * (small synthetic scenes are how `src/snap/resolvePart.test.ts` and `mating.test.ts`
 * exercise structure too), but every part it references — 3001, 4070, 3818 — is a real
 * part resolved from real captured LDraw and LDCad shadow files, never synthesized
 * geometry.
 */

import { describe, expect, it } from 'vitest';

import { collides } from '../../snap/collision';
import { HashSpatialIndex } from '../../snap/spatialIndex';
import { fromTranslation, IDENTITY, multiply } from '../../math';
import { mintBrickId } from '../../model/ids';
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

describe('a loaded model participates in collision', () => {
  // Regression coverage for the bug the user reported: importModel used to hand every
  // brick a degenerate 1-voxel PLACEHOLDER_OCCUPANCY mask on the reasoning that the
  // (then read-only) model viewer never queried collision. It does now — loading a model
  // drops you into the editor with it — so every model brick was silently uncollidable.
  // `resolveFullPart` must now produce a real mask, the same baked-first route
  // `createPartCatalog` gives the chest.

  /** Builds a `HashSpatialIndex` over every brick an import produced. */
  function indexOf(result: Awaited<ReturnType<typeof importModel>>): HashSpatialIndex {
    const index = new HashSpatialIndex();
    for (const brick of result.document.bricks.values()) {
      const part = result.partDefs.get(brick.partId);
      if (part) index.insert(brick.id, part, brick.transform);
    }
    return index;
  }

  it('the imported bricks carry real occupancy, not an empty placeholder', async () => {
    const result = await importModel(STACKED_BRICKS, 'stack', { read: fixtureReader });
    const part = result.partDefs.get('3001');
    expect(part).toBeDefined();
    // A 2x4 brick voxelised at 4 LDU is nowhere near 1x1x1 — dims well above the
    // degenerate placeholder, and a meaningful fraction of bits actually set.
    const { dims, bits } = part!.occupancy;
    expect(dims[0] * dims[1] * dims[2]).toBeGreaterThan(100);
    let setBits = 0;
    for (const byte of bits) {
      for (let b = 0; b < 8; b++) if ((byte >> b) & 1) setBits++;
    }
    expect(setBits).toBeGreaterThan(50);
  });

  it('placing a brick into a loaded model brick is refused', async () => {
    const result = await importModel(STACKED_BRICKS, 'stack', { read: fixtureReader });
    const index = indexOf(result);
    const part = result.partDefs.get('3001')!;

    // The lower brick of STACKED_BRICKS sits at the origin. Dropping a fresh 3001 half
    // a brick height into it — not stud-mated, not aligned with any connection — is a
    // genuine collision and must be refused.
    const intruding = multiply(IDENTITY, fromTranslation([0, -12, 0]));
    const newBrick = mintBrickId();
    expect(collides(part, intruding, index, new Set([newBrick]))).toBe(true);
  });

  it('placing a brick onto a loaded model stud is still accepted (mated connectors exempt)', async () => {
    const result = await importModel(STACKED_BRICKS, 'stack', { read: fixtureReader });
    const index = indexOf(result);
    const part = result.partDefs.get('3001')!;

    // STACKED_BRICKS already has a brick at y=-24 (LDraw Y-down: one brick height above
    // the origin brick, mated on its studs). A third 3001 squarely stacked on top of
    // that one, another brick height up, is the same legitimate mating relationship and
    // must not be refused.
    const stackedOnTop = multiply(IDENTITY, fromTranslation([0, -48, 0]));
    const newBrick = mintBrickId();
    expect(collides(part, stackedOnTop, index, new Set([newBrick]))).toBe(false);
  });
});
