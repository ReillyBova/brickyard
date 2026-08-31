/**
 * The editor session, against real resolved parts.
 *
 * The case worth guarding is undo restoring **connectivity**, not just bricks. Placement
 * used to keep its own map, so the graph was never written and an undo that put a brick
 * back put it back unconnected — which looks correct until something asks what is
 * holding what.
 */

import { describe, expect, it } from 'vitest';

import { IDENTITY, fromTranslation } from '../../math';
import { mintBrickId } from '../../model/ids';
import type { BrickInstance } from '../../model/types';
import { fixtureReader } from '../../snap/__fixtures__/reader';
import { resolvePart } from '../../snap/resolvePart';
import type { PartDef } from '../../snap/types';
import type { BrickId, Mat4 } from '../../types';
import { EditorSession, type SceneSync } from './editor';

const BRICK_HEIGHT = 24;

async function brick2x4(): Promise<PartDef> {
  // Connections are resolved from the real corpus, because they are what this file
  // tests. Bounds are the measured values for 3001 — 80 x 28 x 40 LDU, studs
  // protruding 4 above the body — transcribed rather than derived, because
  // `boundsFromTriangles` lives on an unmerged branch.
  //
  // The occupancy mask is left empty deliberately. `EditorSession` never reads it;
  // only collision does, and collision is not under test here. Worth being explicit
  // because an empty mask is exactly what silently disabled collision detection
  // earlier — the shortcut is safe only where nothing reads the field.
  return {
    id: '3001',
    title: 'Brick  2 x  4',
    connections: await resolvePart('3001', fixtureReader),
    bounds: { min: [-40, -4, -20], max: [40, 24, 20] },
    occupancy: { dims: [0, 0, 0], bits: new Uint8Array(0) },
  };
}

/** Records what the renderer was told, so sync can be asserted rather than assumed. */
function recordingScene(): SceneSync & { added: BrickId[]; removed: BrickId[]; moved: BrickId[] } {
  const added: BrickId[] = [];
  const removed: BrickId[] = [];
  const moved: BrickId[] = [];
  return {
    added,
    removed,
    moved,
    addBrick: (b) => void added.push(b.id),
    removeBrick: (id) => void removed.push(id),
    setBrickTransform: (id) => void moved.push(id),
  };
}

const instance = (part: PartDef, transform: Mat4): BrickInstance => ({
  id: mintBrickId(),
  partId: part.id,
  colorCode: 4,
  transform,
});

describe('EditorSession', () => {
  it('places a brick into the document and the index', async () => {
    const part = await brick2x4();
    const scene = recordingScene();
    const s = new EditorSession(scene);
    s.registerPart(part);

    const brick = instance(part, IDENTITY);
    s.place(brick, part);

    expect(s.document.bricks.size).toBe(1);
    expect(scene.added).toEqual([brick.id]);
    expect(s.index.bricks()).toEqual([brick.id]);
  });

  it('records the connection when a brick lands on another', async () => {
    const part = await brick2x4();
    const s = new EditorSession(recordingScene());
    s.registerPart(part);

    const lower = instance(part, IDENTITY);
    s.place(lower, part);
    const upper = instance(part, fromTranslation([0, -BRICK_HEIGHT, 0]));
    s.place(upper, part);

    expect(s.document.graph.edges.size).toBe(1);
    const edge = [...s.document.graph.edges.values()][0];
    // A 2x4 squarely on a 2x4 engages eight studs — one edge carrying eight mates.
    expect(edge.mates).toHaveLength(8);
    expect(new Set([edge.a, edge.b])).toEqual(new Set([lower.id, upper.id]));
  });

  it('undo removes the brick and its edges, redo restores both', async () => {
    const part = await brick2x4();
    const scene = recordingScene();
    const s = new EditorSession(scene);
    s.registerPart(part);

    const lower = instance(part, IDENTITY);
    s.place(lower, part);
    const upper = instance(part, fromTranslation([0, -BRICK_HEIGHT, 0]));
    s.place(upper, part);
    expect(s.document.graph.edges.size).toBe(1);

    s.undo();
    expect(s.document.bricks.size).toBe(1);
    expect(s.document.graph.edges.size).toBe(0);
    expect(s.index.bricks()).toEqual([lower.id]);
    expect(scene.removed).toContain(upper.id);

    s.redo();
    expect(s.document.bricks.size).toBe(2);
    // The connection has to come back too. Restoring the brick alone would look right
    // and leave nothing able to answer what is holding it up.
    expect(s.document.graph.edges.size).toBe(1);
    expect([...s.document.graph.edges.values()][0].mates).toHaveLength(8);
  });

  it('deleting a connected brick drops its edges, and undo brings them back', async () => {
    const part = await brick2x4();
    const s = new EditorSession(recordingScene());
    s.registerPart(part);

    const lower = instance(part, IDENTITY);
    s.place(lower, part);
    const upper = instance(part, fromTranslation([0, -BRICK_HEIGHT, 0]));
    s.place(upper, part);

    s.remove([upper.id]);
    expect(s.document.bricks.size).toBe(1);
    expect(s.document.graph.edges.size).toBe(0);

    s.undo();
    expect(s.document.bricks.size).toBe(2);
    expect(s.document.graph.edges.size).toBe(1);
    expect([...s.document.graph.edges.values()][0].mates).toHaveLength(8);
  });

  it('undo labels name the action, not the operation', async () => {
    const part = await brick2x4();
    const s = new EditorSession(recordingScene());
    s.registerPart(part);
    s.place(instance(part, IDENTITY), part);

    expect(s.undoLabel).toBe('Place Brick  2 x  4');
    expect(s.canUndo).toBe(true);
    expect(s.canRedo).toBe(false);
    s.undo();
    expect(s.canRedo).toBe(true);
    expect(s.redoLabel).toBe('Place Brick  2 x  4');
  });

  it('keeps the spatial index in step through undo and redo', async () => {
    const part = await brick2x4();
    const s = new EditorSession(recordingScene());
    s.registerPart(part);

    const lower = instance(part, IDENTITY);
    s.place(lower, part);
    const pointsWithOne = s.index.size;

    const upper = instance(part, fromTranslation([0, -BRICK_HEIGHT, 0]));
    s.place(upper, part);
    expect(s.index.size).toBe(pointsWithOne * 2);

    s.undo();
    expect(s.index.size).toBe(pointsWithOne);
    s.redo();
    expect(s.index.size).toBe(pointsWithOne * 2);
  });

  it('notifies subscribers on every change', async () => {
    const part = await brick2x4();
    const s = new EditorSession(recordingScene());
    s.registerPart(part);

    let count = 0;
    const stop = s.subscribe(() => void count++);
    s.place(instance(part, IDENTITY), part);
    s.undo();
    s.redo();
    expect(count).toBe(3);

    stop();
    s.undo();
    expect(count).toBe(3);
  });

  it('does nothing on undo with empty history', async () => {
    const s = new EditorSession(recordingScene());
    expect(s.canUndo).toBe(false);
    expect(() => s.undo()).not.toThrow();
    expect(s.document.bricks.size).toBe(0);
  });
});
