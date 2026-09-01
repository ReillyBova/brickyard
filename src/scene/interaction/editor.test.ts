/**
 * The editor session, against real resolved parts.
 *
 * The case worth guarding is undo restoring **connectivity**, not just bricks. Placement
 * used to keep its own map, so the graph was never written and an undo that put a brick
 * back put it back unconnected — which looks correct until something asks what is
 * holding what.
 */

import { describe, expect, it } from 'vitest';

import { axisOf, basisOf, IDENTITY, fromAxisAngle, fromTranslation, multiplyAll, positionOf } from '../../math';
import { createDocument } from '../../model';
import { edgeIdFor, mintBrickId } from '../../model/ids';
import type { BrickInstance } from '../../model/types';
import { boundsFromTriangles, partTriangles } from '../../ldraw/bounds';
import { fixtureReader } from '../../snap/__fixtures__/reader';
import { buildOccupancy } from '../../snap/collision';
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

/**
 * A real occupancy mask, for the `transformSelection` collision tests below — unlike
 * `brick2x4()` above, those tests exercise `collides()` directly, and an empty mask is
 * exactly what would make a real collision invisible (see `placement.test.ts`'s own
 * fixture, which makes the same point for placement's collision checks).
 */
async function brick2x4WithOccupancy(): Promise<PartDef> {
  const [connections, triangles] = await Promise.all([
    resolvePart('3001', fixtureReader),
    partTriangles('3001', fixtureReader),
  ]);
  const bounds = boundsFromTriangles(triangles);
  return {
    id: '3001',
    title: 'Brick  2 x  4',
    connections,
    bounds,
    occupancy: buildOccupancy(triangles, bounds, connections),
  };
}

/**
 * Records what the renderer was told, so sync can be asserted rather than assumed.
 * `animated` records the `animate` flag `EditorSession` actually passed on each
 * `addBrick` call — undefined/false is "instant", true is "fly in" (see
 * `AddBrickOptions` in `editor.ts`). This is what pins down the fly-in-on-load-only
 * fix below: every add outside `loadDocument` must show up here as not animated.
 */
function recordingScene(): SceneSync & {
  added: BrickId[];
  removed: BrickId[];
  moved: BrickId[];
  animated: boolean[];
} {
  const added: BrickId[] = [];
  const removed: BrickId[] = [];
  const moved: BrickId[] = [];
  const animated: boolean[] = [];
  return {
    added,
    removed,
    moved,
    animated,
    addBrick: (b, options) => {
      added.push(b.id);
      animated.push(options?.animate === true);
    },
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

  // The bug this guards: the progressive-load "fly in" animation
  // (SceneRenderer.addBrick) was firing for every add the renderer saw, not just an
  // initial model load — so hand placement, undo/redo, and restyle all got the fly-in
  // treatment too. `AddBrickOptions.animate` is how `EditorSession` tells the renderer
  // which is which; these pin down that only `loadDocument` sets it.
  describe('animate-on-load-only (AddBrickOptions)', () => {
    it('placing a brick by hand is never animated', async () => {
      const part = await brick2x4();
      const scene = recordingScene();
      const s = new EditorSession(scene);
      s.registerPart(part);

      s.place(instance(part, IDENTITY), part);

      expect(scene.animated).toEqual([false]);
    });

    it('loadDocument animates every brick it seeds', async () => {
      const part = await brick2x4();
      const scene = recordingScene();
      const s = new EditorSession(scene);

      const bricks = [instance(part, IDENTITY), instance(part, fromTranslation([100, 0, 0]))];
      s.loadDocument(createDocument(bricks), [part]);

      expect(scene.added.length).toBe(2);
      expect(scene.animated).toEqual([true, true]);
    });

    it('undo restoring a deleted brick is not animated', async () => {
      const part = await brick2x4();
      const scene = recordingScene();
      const s = new EditorSession(scene);
      s.registerPart(part);

      const brick = instance(part, IDENTITY);
      s.place(brick, part);
      s.remove([brick.id]);
      scene.added.length = 0; // only care about what undo does
      scene.animated.length = 0;

      s.undo();

      expect(scene.added).toEqual([brick.id]);
      expect(scene.animated).toEqual([false]);
    });

    it('redo re-placing a brick is not animated', async () => {
      const part = await brick2x4();
      const scene = recordingScene();
      const s = new EditorSession(scene);
      s.registerPart(part);

      const brick = instance(part, IDENTITY);
      s.place(brick, part);
      s.undo();
      scene.added.length = 0; // only care about what redo does
      scene.animated.length = 0;

      s.redo();

      expect(scene.added).toEqual([brick.id]);
      expect(scene.animated).toEqual([false]);
    });

    it('a recolor (remove-plus-re-add) is not animated, even mid-load', async () => {
      const part = await brick2x4();
      const scene = recordingScene();
      const s = new EditorSession(scene);

      const brick = instance(part, IDENTITY);
      // Seed via loadDocument, the one path that *does* animate, so this test proves
      // the recolor branch overrides that rather than merely defaulting correctly.
      s.loadDocument(createDocument([brick]), [part]);
      scene.animated.length = 0;
      scene.added.length = 0;

      s.commit({
        label: 'Recolor brick',
        ops: [{ type: 'recolor', changes: [{ id: brick.id, from: brick.colorCode, to: 1 }] }],
      });

      expect(scene.removed).toEqual([brick.id]);
      expect(scene.added).toEqual([brick.id]);
      expect(scene.animated).toEqual([false]);
    });
  });
});

// Loading a second model used to mean `loadDocument`, which discards the first — see
// docs/ARCHITECTURE.md: there is one scene graph, and a second model is another
// connected component in it, not a fresh start. `mergeDocument` is the additive path
// `useFileActions`'s Import and the toolbar's "Load model" both use instead.
describe('EditorSession.mergeDocument', () => {
  it('adds bricks to an existing document rather than replacing it', async () => {
    const part = await brick2x4();
    const scene = recordingScene();
    const s = new EditorSession(scene);

    const first = instance(part, IDENTITY);
    s.loadDocument(createDocument([first]), [part]);

    const second = instance(part, fromTranslation([500, 0, 0]));
    s.mergeDocument(createDocument([second]), [part]);

    expect(s.document.bricks.size).toBe(2);
    expect(s.document.bricks.has(first.id)).toBe(true);
    expect(s.document.bricks.has(second.id)).toBe(true);
  });

  it('is undoable, unlike loadDocument', async () => {
    const part = await brick2x4();
    const scene = recordingScene();
    const s = new EditorSession(scene);

    const first = instance(part, IDENTITY);
    s.loadDocument(createDocument([first]), [part]);

    const second = instance(part, fromTranslation([500, 0, 0]));
    s.mergeDocument(createDocument([second]), [part]);

    expect(s.canUndo).toBe(true);
    s.undo();

    expect(s.document.bricks.size).toBe(1);
    expect(s.document.bricks.has(first.id)).toBe(true);
    expect(s.document.bricks.has(second.id)).toBe(false);
  });

  it('offsets the incoming model clear of whatever is already loaded', async () => {
    const part = await brick2x4();
    const scene = recordingScene();
    const s = new EditorSession(scene);

    // 3001's bounds run -40..40 on X (see brick2x4() above), so a second copy at the
    // same transform would land fused into the first without an offset.
    const first = instance(part, IDENTITY);
    s.loadDocument(createDocument([first]), [part]);

    const second = instance(part, IDENTITY);
    s.mergeDocument(createDocument([second]), [part]);

    const merged = s.document.bricks.get(second.id);
    expect(merged).toBeDefined();
    // existing max.x (40) - incoming min.x (-40) + the 40 LDU gap mergeDocument leaves.
    expect(positionOf(merged!.transform)).toEqual([120, 0, 0]);
  });

  it('does not shift the model when merging into an empty document', async () => {
    const part = await brick2x4();
    const scene = recordingScene();
    const s = new EditorSession(scene);

    const brick = instance(part, IDENTITY);
    s.mergeDocument(createDocument([brick]), [part]);

    expect(positionOf(s.document.bricks.get(brick.id)!.transform)).toEqual([0, 0, 0]);
  });

  it('carries over the incoming document’s internal connectivity as its own component', async () => {
    const part = await brick2x4();
    const scene = recordingScene();
    const s = new EditorSession(scene);

    const standalone = instance(part, IDENTITY);
    s.loadDocument(createDocument([standalone]), [part]);

    const a = instance(part, fromTranslation([500, 0, 0]));
    const b = instance(part, fromTranslation([600, 0, 0]));
    const edge = { id: edgeIdFor(a.id, b.id), a: a.id, b: b.id, mates: [] };
    s.mergeDocument(createDocument([a, b], [], [edge]), [part]);

    expect(s.document.graph.component(a.id)).toEqual(new Set([a.id, b.id]));
    expect(s.document.graph.component(standalone.id)).toEqual(new Set([standalone.id]));
  });

  it('animates every brick it merges in, the same as loadDocument', async () => {
    const part = await brick2x4();
    const scene = recordingScene();
    const s = new EditorSession(scene);
    s.loadDocument(createDocument([instance(part, IDENTITY)]), [part]);
    scene.added.length = 0;
    scene.animated.length = 0;

    s.mergeDocument(createDocument([instance(part, fromTranslation([500, 0, 0]))]), [part]);

    expect(scene.added.length).toBe(1);
    expect(scene.animated).toEqual([true]);
  });

  it('loadDocument drops PartDefs for parts the new document no longer references', async () => {
    // Repeatedly opening published models — each with its own set of unique parts,
    // ~53 for a small one per docs/ARCHITECTURE.md — must not grow `parts` for the rest
    // of the session with every part from every model ever opened. Fresh history means
    // there is no undo path back to the old document that could still need them.
    const part = await brick2x4();
    const s = new EditorSession(recordingScene());

    const firstDoc = createDocument([instance(part, IDENTITY)]);
    s.loadDocument(firstDoc, [part]);
    expect(s.partFor(part.id)).toBe(part);

    const secondDoc = createDocument([]); // a different "model" that never uses part 3001
    s.loadDocument(secondDoc, []);

    expect(s.partFor(part.id)).toBeUndefined();
  });

  it('loadDocument keeps a PartDef the new document still references', async () => {
    const part = await brick2x4();
    const s = new EditorSession(recordingScene());

    const firstDoc = createDocument([instance(part, IDENTITY)]);
    s.loadDocument(firstDoc, [part]);

    // A second load that reuses the same part (e.g. reopening the same model, or a
    // second model built from some of the same real-world parts) — nothing here should
    // be pruned away, since `partFor` still needs it for lookup and collision.
    const secondDoc = createDocument([instance(part, fromTranslation([100, 0, 0]))]);
    s.loadDocument(secondDoc, [part]);

    expect(s.partFor(part.id)).toBe(part);
  });
});

describe('transformSelection collision', () => {
  // The same gap src/features/mcp/session.ts's transform() had: connectivity was
  // re-solved via findMates on every move, but nothing ever called collides(), so a
  // keyboard nudge could drive a brick into another and leave it locked there.

  it('refuses to move a brick exactly onto another, leaving the document unchanged', async () => {
    const part = await brick2x4WithOccupancy();
    const s = new EditorSession(recordingScene());
    s.registerPart(part);

    const a = instance(part, IDENTITY);
    const b = instance(part, fromTranslation([500, 0, 0]));
    s.place(a, part);
    s.place(b, part);
    expect(s.document.graph.edges.size).toBe(0);

    const applied = s.transformSelection([b.id], fromTranslation([-500, 0, 0]), 'Move brick');

    expect(applied).toBe(false);
    // Nothing committed: brick b is still where it was, no edges formed.
    expect(s.document.bricks.get(b.id)?.transform).toEqual(fromTranslation([500, 0, 0]));
    expect(s.document.graph.edges.size).toBe(0);
    expect(s.document.bricks.size).toBe(2);
  });

  it('still allows moving a brick back into a position where it legitimately mates', async () => {
    const part = await brick2x4WithOccupancy();
    const s = new EditorSession(recordingScene());
    s.registerPart(part);

    const lower = instance(part, IDENTITY);
    s.place(lower, part);
    // A 2x4 squarely on a 2x4: the maximal-overlap case a naive collision check would
    // be most tempted to flag.
    const upper = instance(part, fromTranslation([0, -BRICK_HEIGHT, 0]));
    s.place(upper, part);
    expect(s.document.graph.edges.size).toBe(1);

    // Move it away, breaking the connection...
    const awayDelta = fromTranslation([500, 0, 0]);
    expect(s.transformSelection([upper.id], awayDelta, 'Move brick')).toBe(true);
    expect(s.document.graph.edges.size).toBe(0);

    // ...then back onto the exact same mated position. Must succeed, not be treated as
    // a collision, and re-form the connection.
    const backDelta = fromTranslation([-500, 0, 0]);
    const applied = s.transformSelection([upper.id], backDelta, 'Move brick');

    expect(applied).toBe(true);
    expect(s.document.graph.edges.size).toBe(1);
    expect([...s.document.graph.edges.values()][0].mates).toHaveLength(8);
  });

  it('slides a snapped piece sideways along the surface it rests on', async () => {
    // "If I have a snapped piece I can't even move it around on the surface it's on
    // top of" — this is that gesture exactly: not moving it away and back to the same
    // spot (already covered above), but one stud over, to a *different* set of studs
    // on the same brick it's resting on, remaining in contact the entire time.
    const part = await brick2x4WithOccupancy();
    const s = new EditorSession(recordingScene());
    s.registerPart(part);

    const lower = instance(part, IDENTITY);
    s.place(lower, part);
    const upper = instance(part, fromTranslation([0, -BRICK_HEIGHT, 0]));
    s.place(upper, part);
    expect(s.document.graph.edges.size).toBe(1);
    expect([...s.document.graph.edges.values()][0].mates).toHaveLength(8);

    // One stud (20 LDU) sideways — still squarely resting on the lower brick, just
    // engaging a different four of its eight studs.
    const applied = s.transformSelection([upper.id], fromTranslation([20, 0, 0]), 'Move brick');

    expect(applied).toBe(true);
    expect(s.document.bricks.get(upper.id)?.transform).toEqual(fromTranslation([20, -BRICK_HEIGHT, 0]));
    expect(s.document.graph.edges.size).toBe(1);
    // A 2x4 on a 2x4 offset by one stud shares (4-1)*2 = 6 of its eight studs.
    expect([...s.document.graph.edges.values()][0].mates).toHaveLength(6);
  });

  it('does not let one selected brick block another moving together', async () => {
    // A rigid group move must not treat the group's own members as obstacles to each
    // other — collides() is called with the whole moving set as `ignore`, mirroring
    // findMates's existing exemption of it.
    const part = await brick2x4WithOccupancy();
    const s = new EditorSession(recordingScene());
    s.registerPart(part);

    const a = instance(part, IDENTITY);
    const b = instance(part, fromTranslation([0, -BRICK_HEIGHT, 0]));
    s.place(a, part);
    s.place(b, part);
    expect(s.document.graph.edges.size).toBe(1);

    const delta = fromTranslation([200, 0, 0]);
    const applied = s.transformSelection([a.id, b.id], delta, 'Move 2 bricks');

    expect(applied).toBe(true);
    // The pair's own connection survives a shared rigid move.
    expect(s.document.graph.edges.size).toBe(1);
  });
});

describe('anchorFrame', () => {
  it('is the world connector frame of the strongest mate, and null when unmated', async () => {
    const part = await brick2x4WithOccupancy();
    const s = new EditorSession(recordingScene());
    s.registerPart(part);

    const lower = instance(part, IDENTITY);
    s.place(lower, part);
    expect(s.anchorFrame(lower.id)).toBeNull(); // nothing mated to it yet

    const upper = instance(part, fromTranslation([0, -BRICK_HEIGHT, 0]));
    s.place(upper, part);

    const anchor = s.anchorFrame(upper.id);
    expect(anchor).not.toBeNull();
    // The connector frame sits at the mated stud, on the lower brick's top face —
    // somewhere between the two bricks' own origins, not at either one directly.
    const pos = positionOf(anchor as Mat4);
    expect(pos[1]).toBeGreaterThan(-BRICK_HEIGHT);
    expect(pos[1]).toBeLessThanOrEqual(0);
    // A real orthonormal basis, not a degenerate/zero one.
    const basis = basisOf(anchor as Mat4);
    const lenSq = (x: number, y: number, z: number) => x * x + y * y + z * z;
    expect(lenSq(basis[0], basis[1], basis[2])).toBeCloseTo(1, 5);
    expect(lenSq(basis[3], basis[4], basis[5])).toBeCloseTo(1, 5);
    expect(lenSq(basis[6], basis[7], basis[8])).toBeCloseTo(1, 5);
  });

  it('is null for an id with no graph node at all', async () => {
    const s = new EditorSession(recordingScene());
    expect(s.anchorFrame('nope' as BrickId)).toBeNull();
  });
});

/**
 * The bug this guards: BuilderCanvas's keyboard rotation (Shift+Left/Right) used to
 * pivot on the selection's own centroid rather than the connector actually holding it
 * in place. That is fine only when the mated connector happens to sit at the centroid —
 * true of a piece resting squarely under another, false the moment the mate is
 * off-centre, which single-stud and corner mates are. Pivoting on the centroid swings
 * the seated connector off the lattice, breaking the mate and reading back as a
 * collision. Pivoting on the connector itself (`anchorFrame`), about its own axis, is
 * what `BuilderCanvas`'s `rotationAbout` now does; these tests build the identical
 * delta matrix by hand — anchor position and axis, one `fromAxisAngle` about it — and
 * drive it through `transformSelection`, the same entry point the keyboard uses, so the
 * mate re-solve and collision check are the real ones, not a stand-in.
 */
describe('rotating a mated brick about its anchor (off-centre mate survives a quarter turn)', () => {
  /** Delta for rotating `angleRadians` about `anchor`'s own position and axis — what
   * `BuilderCanvas`'s `rotationAbout` builds for a mated selection. */
  function anchorRotation(anchor: Mat4, angleRadians: number): Mat4 {
    const pivot = positionOf(anchor);
    const axis = axisOf(anchor);
    const negPivot: [number, number, number] = [-pivot[0], -pivot[1], -pivot[2]];
    return multiplyAll(fromTranslation(pivot), fromAxisAngle(axis, angleRadians), fromTranslation(negPivot));
  }

  it('survives a quarter turn about the anchor when the mate is off-centre', async () => {
    const part = await brick2x4WithOccupancy();
    const s = new EditorSession(recordingScene());
    s.registerPart(part);

    const lower = instance(part, IDENTITY);
    s.place(lower, part);

    // Offset three stud pitches in X and one in Z: the two 2x4s share exactly one
    // stud, at a corner far from the upper brick's own origin (60, -24, 20) — an
    // off-centre mate, not the squarely-stacked case the old centroid pivot handled
    // fine by accident.
    const upper = instance(part, fromTranslation([60, -BRICK_HEIGHT, 20]));
    s.place(upper, part);
    const edgeBefore = [...s.document.graph.edges.values()][0];
    expect(edgeBefore).toBeDefined();
    expect(edgeBefore.mates).toHaveLength(1);

    const anchor = s.anchorFrame(upper.id);
    expect(anchor).not.toBeNull();

    const applied = s.transformSelection(
      [upper.id],
      anchorRotation(anchor as Mat4, Math.PI / 2),
      'Rotate brick',
    );

    // Not read back as a collision — the whole bug.
    expect(applied).toBe(true);
    // The anchoring mate survives the turn (rotating about the seated stud, this
    // corner rotation actually brings a second stud into engagement too — the point
    // is that it is at least one, not zero).
    expect(s.document.graph.edges.size).toBe(1);
    expect([...s.document.graph.edges.values()][0].mates.length).toBeGreaterThanOrEqual(1);
  });

  it('the same rotation about the selection centroid instead breaks the mate — this is the bug', async () => {
    const part = await brick2x4WithOccupancy();
    const s = new EditorSession(recordingScene());
    s.registerPart(part);

    const lower = instance(part, IDENTITY);
    s.place(lower, part);
    const upper = instance(part, fromTranslation([60, -BRICK_HEIGHT, 20]));
    s.place(upper, part);
    expect(s.document.graph.edges.size).toBe(1);

    // The pre-fix behaviour: pivot on the brick's own transform origin about world Y,
    // exactly what BuilderCanvas's old `rotationAbout` built.
    const centroid = positionOf(upper.transform);
    const negCentroid: [number, number, number] = [-centroid[0], -centroid[1], -centroid[2]];
    const oldDelta = multiplyAll(
      fromTranslation(centroid),
      fromAxisAngle([0, 1, 0], Math.PI / 2),
      fromTranslation(negCentroid),
    );

    s.transformSelection([upper.id], oldDelta, 'Rotate brick');

    // Swinging the seated stud off the lattice breaks the connection this instance was
    // built to hold — confirming the diagnosis, not just the fix.
    expect(s.document.graph.edges.size).toBe(0);
  });
});
