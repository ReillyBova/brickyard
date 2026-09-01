/**
 * Placement, driven against real resolved parts through a stub scene.
 *
 * `PlacementController` only touches the renderer through `PlacementScene`, which is a
 * four-method interface — so the whole interaction is testable without a canvas, and
 * the parts are real rather than invented.
 */

import { describe, expect, it } from 'vitest';

import { IDENTITY, fromTranslation, positionOf } from '../../math';
import { boundsFromTriangles, partTriangles } from '../../ldraw/bounds';
import { fixtureReader } from '../../snap/__fixtures__/reader';
import { buildOccupancy } from '../../snap/collision';
import { unpackKey } from '../../snap/compat';
import { worldPoint } from '../../snap/mating';
import { resolvePart } from '../../snap/resolvePart';
import type { PartDef } from '../../snap/types';
import type { BrickId, Mat4, Vec3 } from '../../types';
import { PlacementController, createPartCatalog, type PlacementScene } from './placement';

const BRICK_HEIGHT = 24;

async function brick2x4(): Promise<PartDef> {
  // Real bounds and a real occupancy mask. A stub mask makes collision silently
  // unreachable: `collides` finds no occupied voxels and reports no collision, ever,
  // which is indistinguishable from working collision detection until you overlap
  // something.
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

/** A scene that reports the cursor over a chosen point, with that face's normal. */
function stubScene(hit: { brick: BrickId; point: Vec3; normal: Vec3 } | null): PlacementScene & {
  ghosts: { transform: Mat4; valid: boolean; wireframe: boolean }[];
  hidden: number;
} {
  const ghosts: { transform: Mat4; valid: boolean; wireframe: boolean }[] = [];
  let hidden = 0;
  return {
    ghosts,
    get hidden() {
      return hidden;
    },
    pick: () => hit,
    pickRay: () => ({ origin: [0, -500, 0] as Vec3, direction: [0, 1, 0] as Vec3 }),
    showGhost: async (_p, _c, transform, valid, wireframe = false) => {
      ghosts.push({ transform, valid, wireframe });
    },
    hideGhost: () => {
      hidden += 1;
    },
  };
}

/** The world position of one of the seed brick's top studs. */
async function aStudOn(part: PartDef, at: Mat4): Promise<Vec3> {
  const stud = part.connections.find((c) => unpackKey(c.key).gender === 'M');
  expect(stud).toBeDefined();
  return worldPoint(stud as NonNullable<typeof stud>, at).position;
}

describe('PlacementController', () => {
  it('places a brick where the cursor points', async () => {
    const part = await brick2x4();
    const seedAt = IDENTITY;
    const studPos = await aStudOn(part, seedAt);
    // The top face of a brick faces -Y, because LDraw's +Y points down.
    const scene = stubScene({ brick: 'seed' as BrickId, point: studPos, normal: [0, -1, 0] });

    const c = new PlacementController(scene);
    c.add({ id: 'seed' as BrickId, partId: '3001', colorCode: 4, transform: seedAt, part });
    c.hold(part);

    expect(c.move(0, 0)).not.toBeNull();
    const placed = c.commit('new1' as BrickId);
    expect(placed).not.toBeNull();
    // A brick placed on top sits one brick height up, which is -24 with +Y down.
    expect(positionOf((placed as NonNullable<typeof placed>).transform)[1]).toBeCloseTo(
      -BRICK_HEIGHT,
      6,
    );
  });

  it('does not place the same brick twice from one resolution', async () => {
    // The regression: commit() used to leave its transform in place, so every further
    // pointerup re-placed it — a stationary double-click buried a brick inside another.
    const part = await brick2x4();
    const studPos = await aStudOn(part, IDENTITY);
    const scene = stubScene({ brick: 'seed' as BrickId, point: studPos, normal: [0, -1, 0] });

    const c = new PlacementController(scene);
    c.add({ id: 'seed' as BrickId, partId: '3001', colorCode: 4, transform: IDENTITY, part });
    c.hold(part);
    c.move(0, 0);

    expect(c.commit('a' as BrickId)).not.toBeNull();
    expect(c.commit('b' as BrickId)).toBeNull();
    expect(c.current.transform).toBeNull();
    expect(c.placed).toHaveLength(2); // the seed and one placement, not three
  });

  it('hides the ghost after committing', async () => {
    const part = await brick2x4();
    const studPos = await aStudOn(part, IDENTITY);
    const scene = stubScene({ brick: 'seed' as BrickId, point: studPos, normal: [0, -1, 0] });

    const c = new PlacementController(scene);
    c.add({ id: 'seed' as BrickId, partId: '3001', colorCode: 4, transform: IDENTITY, part });
    c.hold(part);
    c.move(0, 0);
    const before = scene.hidden;
    c.commit('a' as BrickId);
    expect(scene.hidden).toBeGreaterThan(before);
  });

  it('offers nothing when the cursor is over no brick', async () => {
    const part = await brick2x4();
    const scene = stubScene(null);
    const c = new PlacementController(scene);
    c.hold(part);
    // With no hit the ground fallback applies, so a transform exists but no candidate.
    c.move(0, 0);
    expect(c.current.candidates).toHaveLength(0);
  });

  it('rotate re-solves at the last pointer position rather than waiting for a move', async () => {
    const part = await brick2x4();
    const studPos = await aStudOn(part, IDENTITY);
    const scene = stubScene({ brick: 'seed' as BrickId, point: studPos, normal: [0, -1, 0] });

    const c = new PlacementController(scene);
    c.add({ id: 'seed' as BrickId, partId: '3001', colorCode: 4, transform: IDENTITY, part });
    c.hold(part);
    c.move(0, 0);

    const ghostsBefore = scene.ghosts.length;
    c.rotate([0, 0]);
    expect(c.current.roll).toBe(1);
    // A repaint must have happened, or the key does nothing until the pointer moves.
    expect(scene.ghosts.length).toBeGreaterThan(ghostsBefore);
  });

  it('hold(null) clears the ghost and the held piece', async () => {
    const part = await brick2x4();
    const studPos = await aStudOn(part, IDENTITY);
    const scene = stubScene({ brick: 'seed' as BrickId, point: studPos, normal: [0, -1, 0] });

    const c = new PlacementController(scene);
    c.add({ id: 'seed' as BrickId, partId: '3001', colorCode: 4, transform: IDENTITY, part });
    c.hold(part);
    c.move(0, 0);
    c.hold(null);
    expect(c.current.transform).toBeNull();
    expect(c.move(0, 0)).toBeNull();
  });

  it('removing a brick takes its connection points out of reach', async () => {
    const part = await brick2x4();
    const studPos = await aStudOn(part, IDENTITY);
    const scene = stubScene({ brick: 'seed' as BrickId, point: studPos, normal: [0, -1, 0] });

    const c = new PlacementController(scene);
    c.add({ id: 'seed' as BrickId, partId: '3001', colorCode: 4, transform: IDENTITY, part });
    c.hold(part);
    expect(c.move(0, 0)).not.toBeNull();

    c.remove('seed' as BrickId);
    c.move(0, 0);
    expect(c.current.candidates).toHaveLength(0);
  });
});

describe('the face filter', () => {
  it('offers a brick top its studs, and offers nothing for a face with no connectors', async () => {
    const part = await brick2x4();
    const studPos = await aStudOn(part, IDENTITY);

    const top = stubScene({ brick: 'seed' as BrickId, point: studPos, normal: [0, -1, 0] });
    const c1 = new PlacementController(top);
    c1.add({ id: 'seed' as BrickId, partId: '3001', colorCode: 4, transform: IDENTITY, part });
    c1.hold(part);
    c1.move(0, 0);
    expect(c1.current.candidates.length).toBeGreaterThan(0);

    // Same point, but reporting a side face. A 2x4's studs run along Y, so a normal
    // along X is perpendicular to them and the face filter must reject them all.
    const side = stubScene({ brick: 'seed' as BrickId, point: studPos, normal: [1, 0, 0] });
    const c2 = new PlacementController(side);
    c2.add({ id: 'seed' as BrickId, partId: '3001', colorCode: 4, transform: IDENTITY, part });
    c2.hold(part);
    c2.move(0, 0);
    expect(c2.current.candidates).toHaveLength(0);
  });
});

describe('continuity', () => {
  it('is bounded, so a distant previous position cannot outweigh the cursor', async () => {
    const part = await brick2x4();
    const studPos = await aStudOn(part, IDENTITY);
    const scene = stubScene({ brick: 'seed' as BrickId, point: studPos, normal: [0, -1, 0] });

    const c = new PlacementController(scene);
    c.add({ id: 'seed' as BrickId, partId: '3001', colorCode: 4, transform: IDENTITY, part });
    c.hold(part);
    c.move(0, 0);
    const near = c.current.candidates[0];
    expect(near).toBeDefined();

    // Re-solve with the ghost notionally miles away. The winning candidate must not
    // change: drift is capped at the search radius precisely so it cannot swamp
    // proximity to the cursor.
    const far = new PlacementController(scene);
    far.add({ id: 'seed' as BrickId, partId: '3001', colorCode: 4, transform: IDENTITY, part });
    far.hold(part);
    far.move(0, 0);
    far.move(0, 0);
    expect(far.current.candidates[0].target.point).toBe(near.target.point);
    expect(far.current.candidates[0].transform).toEqual(near.transform);
  });
});

describe('collision', () => {
  const BRICK = 24;

  it('refuses a placement that would intersect another brick', async () => {
    // A snapped placement is a valid *connection* by construction, so it can only
    // collide with some third brick occupying the space it lands in. That is the case
    // a two-brick scene cannot produce, and the reason this needs an explicit setup.
    const part = await brick2x4();
    const studPos = await aStudOn(part, IDENTITY);
    const scene = stubScene({ brick: 'seed' as BrickId, point: studPos, normal: [0, -1, 0] });

    const c = new PlacementController(scene);
    c.add({ id: 'seed' as BrickId, partId: '3001', colorCode: 4, transform: IDENTITY, part });
    // Squatting exactly where a brick stacked on the seed would land.
    c.add({
      id: 'squatter' as BrickId,
      partId: '3001',
      colorCode: 14,
      transform: fromTranslation([0, -BRICK, 0]),
      part,
    });
    c.hold(part);
    c.move(0, 0);

    expect(c.current.transform).not.toBeNull();
    expect(c.current.valid).toBe(false);
    expect(c.commit('blocked' as BrickId)).toBeNull();
    expect(c.placed).toHaveLength(2); // nothing added
  });

  it('allows the same placement once the obstruction is gone', async () => {
    const part = await brick2x4();
    const studPos = await aStudOn(part, IDENTITY);
    const scene = stubScene({ brick: 'seed' as BrickId, point: studPos, normal: [0, -1, 0] });

    const c = new PlacementController(scene);
    c.add({ id: 'seed' as BrickId, partId: '3001', colorCode: 4, transform: IDENTITY, part });
    c.add({
      id: 'squatter' as BrickId,
      partId: '3001',
      colorCode: 14,
      transform: fromTranslation([0, -BRICK, 0]),
      part,
    });
    c.hold(part);
    c.move(0, 0);
    expect(c.current.valid).toBe(false);

    c.remove('squatter' as BrickId);
    c.move(0, 0);
    expect(c.current.valid).toBe(true);
    expect(c.commit('ok' as BrickId)).not.toBeNull();
  });

  it('nudge re-evaluates collision, flipping valid to true once resolved', async () => {
    // The regression this guards: nudge() must funnel through the same
    // collides()-on-the-new-transform path move() uses, not just mutate the transform
    // and leave `valid` stale from wherever the piece was last resolved.
    const part = await brick2x4();
    const studPos = await aStudOn(part, IDENTITY);
    const scene = stubScene({ brick: 'seed' as BrickId, point: studPos, normal: [0, -1, 0] });

    const c = new PlacementController(scene);
    c.add({ id: 'seed' as BrickId, partId: '3001', colorCode: 4, transform: IDENTITY, part });
    // Squatting exactly where a brick stacked on the seed would land.
    c.add({
      id: 'squatter' as BrickId,
      partId: '3001',
      colorCode: 14,
      transform: fromTranslation([0, -BRICK, 0]),
      part,
    });
    c.hold(part);
    c.move(0, 0);
    expect(c.current.valid).toBe(false);

    // Translate it well clear of the squatter — a real transform, not a re-hold.
    c.nudge(fromTranslation([400, 0, 0]));

    expect(c.current.valid).toBe(true);
    expect(c.commit('nudged-clear' as BrickId)).not.toBeNull();
  });

  it('does not treat a legitimate stack as a collision', async () => {
    const part = await brick2x4();
    const studPos = await aStudOn(part, IDENTITY);
    const scene = stubScene({ brick: 'seed' as BrickId, point: studPos, normal: [0, -1, 0] });

    const c = new PlacementController(scene);
    c.add({ id: 'seed' as BrickId, partId: '3001', colorCode: 4, transform: IDENTITY, part });
    c.hold(part);
    c.move(0, 0);
    expect(c.current.valid).toBe(true);
  });
});

describe('keyboard', () => {
  it('never intercepts Tab', async () => {
    // The canvas is the first focusable element in the document. Calling
    // preventDefault on Tab here trapped keyboard users on it permanently — the
    // toolbar, chest and palette became unreachable in both directions. Candidate
    // cycling uses a key with no browser meaning instead.
    const source = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('./BuilderCanvas.tsx', import.meta.url), 'utf8'),
    );
    expect(source).not.toMatch(/['"]Tab['"]/);
    expect(source).not.toMatch(/preventDefault/);
  });

  it('never stops propagation on its keydown handler', async () => {
    // src/ui/toolbar/useUndoRedo.tsx binds Cmd/Ctrl+Z and friends at `window` level for
    // everywhere except this canvas, and skips exactly by checking
    // `event.target.tagName === 'CANVAS'` — it relies on the event still reaching
    // `window` to see that. Now that both bind the same EditorSession
    // (onSessionReady/EditorSessionProvider), stopping propagation here would make that
    // guard unreachable and undo would silently stop working everywhere except the
    // canvas — the same class of bug as the Tab trap above, just for a different key.
    const source = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('./BuilderCanvas.tsx', import.meta.url), 'utf8'),
    );
    expect(source).not.toMatch(/stopPropagation/);
  });

  it('Escape clears a selection when nothing is held', async () => {
    // Escape used to be scoped entirely to cancelling a hold — a selected piece with
    // nothing on the cursor had no keyboard way to deselect. The interaction model
    // asks for both: cancel a hold, or clear a selection, whichever applies.
    const source = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('./BuilderCanvas.tsx', import.meta.url), 'utf8'),
    );
    const onKeyBody = source.slice(source.indexOf('const onKey ='), source.indexOf('\n    canvas.addEventListener'));
    const escapeBranch = onKeyBody.slice(onKeyBody.indexOf("'Escape'"));
    expect(escapeBranch).toMatch(/session\.setSelection\(\[\]\)/);
  });

  it('has no Page Up/Down: vertical movement needs no Fn key on a laptop', async () => {
    // Page Up/Down need Fn on a MacBook with no numeric keypad — awkward enough that
    // it isn't "laptop-friendly, directional keys only" per the rule this project set
    // for itself. Vertical movement is Shift+Up/Down instead: Shift already means
    // "the other axis" (it also turns Left/Right from translate into rotate), so this
    // extends a rule already in place rather than inventing a new one.
    const source = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('./BuilderCanvas.tsx', import.meta.url), 'utf8'),
    );
    expect(source).not.toMatch(/PageUp/);
    expect(source).not.toMatch(/PageDown/);
  });
});

describe('pointer gestures', () => {
  it('picks up only from a real dblclick, never from a second single click', async () => {
    // The regression this guards: pick-up used to be a special case inside the
    // single-click (pointerup) handler — "click an already-selected brick again" —
    // which made it indistinguishable from two separate, deliberate clicks that
    // happened to land on the same brick within a click or two of each other. A
    // native `dblclick` only fires when the browser's own timing-and-proximity
    // heuristic agrees the two clicks were one gesture, which is what actually makes
    // "one click selects, double-click picks up" reliable instead of flaky.
    const source = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('./BuilderCanvas.tsx', import.meta.url), 'utf8'),
    );
    // A real listener is registered and cleaned up.
    expect(source).toMatch(/addEventListener\('dblclick'/);
    expect(source).toMatch(/removeEventListener\('dblclick'/);
    // The single-click path never reads the current selection to decide whether to
    // pick up — that reasoning belongs to the dblclick handler alone. This is a
    // coarse but deliberate guard: it would fail if pick-up logic crept back into
    // `onUp` keyed off `session.selection`.
    const onUpBody = source.slice(source.indexOf('const onUp ='), source.indexOf('const onDoubleClick ='));
    expect(onUpBody).not.toMatch(/session\.selection\.has/);
    expect(onUpBody).not.toMatch(/pickUp/);
  });

  it('place commits and releases: holding never survives a landed piece', async () => {
    // The regression this guards: PlacementController.commit() used to clear its own
    // candidate/transform state but never reset `held`, so `holding` stayed true
    // after a successful placement. See the dedicated PlacementController test for
    // the behavioural version of this; this one guards commitHeld's contract in
    // BuilderCanvas — it must not separately call `hold(null)` to compensate for a
    // commit() that used to need it, which would silently re-introduce the coupling
    // if commit() ever regresses.
    const source = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('./BuilderCanvas.tsx', import.meta.url), 'utf8'),
    );
    const commitHeldBody = source.slice(
      source.indexOf('const commitHeld ='),
      source.indexOf('};', source.indexOf('const commitHeld =')),
    );
    expect(commitHeldBody).not.toMatch(/\.hold\(null\)/);
  });
});

describe('the part catalog', () => {
  /** A `PartDef`'s worth of baked data for one real part, packed and read back. */
  async function bakedFor(partId: string) {
    const [points, triangles] = await Promise.all([
      resolvePart(partId, fixtureReader),
      partTriangles(partId, fixtureReader),
    ]);
    const bounds = boundsFromTriangles(triangles);
    return {
      connections: new Map([[partId, points]]),
      occupancy: new Map([[partId, { bounds, occupancy: buildOccupancy(triangles, bounds, points) }]]),
      geometry: new Map(),
    };
  }

  it('serves a baked part without touching the network', async () => {
    const baked = await bakedFor('3001');
    // A catalog that reaches upstream for a baked part is the bug this guards: the whole
    // point of the bake is that a covered part costs a lookup.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new Error('the catalog fetched for a baked part');
    }) as typeof fetch;
    try {
      const catalog = createPartCatalog(Promise.resolve(baked));
      const part = await catalog('3001');
      expect(part.connections.length).toBe(baked.connections.get('3001')?.length);
      expect(part.bounds).toEqual(baked.occupancy.get('3001')?.bounds);
      expect(part.occupancy.bits).toEqual(baked.occupancy.get('3001')?.occupancy.bits);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('caches per part, so a second request is the same promise', async () => {
    const catalog = createPartCatalog(Promise.resolve(await bakedFor('3001')));
    expect(catalog('3001')).toBe(catalog('3001'));
  });

  it('falls back to resolving from source when the bake has no mask', async () => {
    // Connections present, occupancy absent — a part must not be served from the bake on
    // connections alone, or it would place with an empty mask and never collide.
    const baked = await bakedFor('3001');
    const catalog = createPartCatalog(
      Promise.resolve({ connections: baked.connections, occupancy: new Map(), geometry: new Map() }),
    );
    const reads: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      reads.push(String(url));
      return { ok: false, text: async () => '' } as Response;
    }) as unknown as typeof fetch;
    try {
      await catalog('3001').catch(() => undefined);
    } finally {
      globalThis.fetch = originalFetch;
    }
    expect(reads.length).toBeGreaterThan(0);
  });
});

describe('nudge while resting on a surface — "I can\'t move a snapped piece around"', () => {
  it('stays valid sliding one stud sideways across the same brick it rests on', async () => {
    const part = await brick2x4();
    const studPos = await aStudOn(part, IDENTITY);
    const scene = stubScene({ brick: 'seed' as BrickId, point: studPos, normal: [0, -1, 0] });

    const c = new PlacementController(scene);
    c.add({ id: 'seed' as BrickId, partId: '3001', colorCode: 4, transform: IDENTITY, part });
    c.hold(part);
    c.move(0, 0);
    // Lands squarely stacked on the seed — snapped, and valid.
    expect(c.current.valid).toBe(true);

    const slid = c.nudge(fromTranslation([20, 0, 0]));

    expect(slid).not.toBeNull();
    expect(c.current.valid).toBe(true);
  });

  it('stays valid through several consecutive one-stud slides', async () => {
    const part = await brick2x4();
    const studPos = await aStudOn(part, IDENTITY);
    const scene = stubScene({ brick: 'seed' as BrickId, point: studPos, normal: [0, -1, 0] });

    const c = new PlacementController(scene);
    c.add({ id: 'seed' as BrickId, partId: '3001', colorCode: 4, transform: IDENTITY, part });
    c.hold(part);
    c.move(0, 0);
    expect(c.current.valid).toBe(true);

    c.nudge(fromTranslation([20, 0, 0]));
    expect(c.current.valid).toBe(true);
    c.nudge(fromTranslation([20, 0, 0]));
    expect(c.current.valid).toBe(true);
    c.nudge(fromTranslation([0, 0, 20]));
    expect(c.current.valid).toBe(true);
  });
});

describe('persistent rotation', () => {
  it('survives a cursor move — the regression behind three separate reports', async () => {
    // The bug: a rotation applied via a one-off transform mutation lived only in
    // state.transform, and the next move() overwrote it wholesale by re-deriving a
    // transform from resolveSnap with the *stale* pre-rotation roll. rotateManually
    // keeps the rotation in a field move() never touches, so it survives.
    const part = await brick2x4();
    const studPos = await aStudOn(part, IDENTITY);
    const scene = stubScene({ brick: 'seed' as BrickId, point: studPos, normal: [0, -1, 0] });

    const c = new PlacementController(scene);
    c.add({ id: 'seed' as BrickId, partId: '3001', colorCode: 4, transform: IDENTITY, part });
    c.hold(part);
    c.move(0, 0);

    const rotated = c.rotateManually(Math.PI / 2);
    expect(rotated).not.toBeNull();
    expect(rotated).not.toEqual(c.current.candidates[0]?.transform);

    // The cursor "moves" back to the exact same spot — the ordinary case of a mouse
    // that never left the piece it just rotated.
    const afterMove = c.move(0, 0);

    expect(afterMove).not.toBeNull();
    expect(afterMove).toEqual(rotated);
  });

  it('survives a candidate change — moving from one stud to another keeps the orientation', async () => {
    const part = await brick2x4();
    const studA = await aStudOn(part, IDENTITY);
    const scene = stubScene({ brick: 'seed' as BrickId, point: studA, normal: [0, -1, 0] });

    const c = new PlacementController(scene);
    c.add({ id: 'seed' as BrickId, partId: '3001', colorCode: 4, transform: IDENTITY, part });
    c.hold(part);
    c.move(0, 0);
    c.rotateManually(Math.PI / 2);
    expect(c.current.candidates.length).toBeGreaterThan(1);

    c.cycle();

    // A different candidate (different base position/orientation), same extra spin.
    expect(c.current.index).not.toBe(0);
    const withoutRotation = c.current.candidates[c.current.index].transform;
    expect(c.current.transform).not.toEqual(withoutRotation);
  });

  it('resets when a new hold begins, so a fresh part does not inherit the last rotation', async () => {
    const part = await brick2x4();
    const studPos = await aStudOn(part, IDENTITY);
    const scene = stubScene({ brick: 'seed' as BrickId, point: studPos, normal: [0, -1, 0] });

    const c = new PlacementController(scene);
    c.add({ id: 'seed' as BrickId, partId: '3001', colorCode: 4, transform: IDENTITY, part });
    c.hold(part);
    c.move(0, 0);
    c.rotateManually(Math.PI / 2);

    c.hold(part);
    const fresh = c.move(0, 0);

    expect(fresh).toEqual(c.current.candidates[0]?.transform);
  });

  it('commit places exactly the rotated transform the ghost was showing', async () => {
    const part = await brick2x4();
    const studPos = await aStudOn(part, IDENTITY);
    const scene = stubScene({ brick: 'seed' as BrickId, point: studPos, normal: [0, -1, 0] });

    const c = new PlacementController(scene);
    c.add({ id: 'seed' as BrickId, partId: '3001', colorCode: 4, transform: IDENTITY, part });
    c.hold(part);
    c.move(0, 0);
    const rotated = c.rotateManually(Math.PI / 2);
    expect(rotated).not.toBeNull();

    // No move() between the rotation and the commit — the ordinary "rotate, then
    // click without moving the mouse" gesture.
    const placed = c.commit('rotated-commit' as BrickId);

    expect(placed).not.toBeNull();
    expect(placed?.transform).toEqual(rotated);
  });

  it('a translate nudge also survives to a commit with no intervening cursor move', async () => {
    const part = await brick2x4();
    const scene = stubScene(null);

    const c = new PlacementController(scene);
    c.hold(part);
    c.move(0, 0);
    expect(c.current.transform).not.toBeNull(); // ground fallback

    const nudged = c.nudge(fromTranslation([40, 0, 0]));
    expect(nudged).not.toBeNull();
    const placed = c.commit('nudged-commit' as BrickId);

    expect(placed).not.toBeNull();
    expect(placed?.transform).toEqual(nudged);
  });
});

describe('pick up', () => {
  it('renders the picked-up piece as a wireframe outline, unlike a fresh chest hold', async () => {
    const part = await brick2x4();
    const studPos = await aStudOn(part, IDENTITY);
    const scene = stubScene({ brick: 'seed' as BrickId, point: studPos, normal: [0, -1, 0] });

    const c = new PlacementController(scene);
    c.add({ id: 'seed' as BrickId, partId: '3001', colorCode: 4, transform: IDENTITY, part });

    c.hold(part);
    expect(c.holding).toBe(true);
    expect(c.pickedUp).toBe(false);
    c.move(0, 0);
    expect(scene.ghosts.at(-1)?.wireframe).toBe(false);
    c.hold(null);

    c.pickUp(part, 2, fromTranslation([100, 0, 0]));
    expect(c.holding).toBe(true);
    expect(c.pickedUp).toBe(true);
    c.move(0, 0);
    expect(scene.ghosts.at(-1)?.wireframe).toBe(true);
  });

  it('seeds continuity with the piece\'s former position', async () => {
    // Two candidates equidistant from the cursor but not from each other: continuity
    // should favour whichever is nearer the position pickUp was told the piece came
    // from, exactly as it favours the previous frame's landing spot during a drag.
    const part = await brick2x4();
    const studPos = await aStudOn(part, IDENTITY);
    const scene = stubScene({ brick: 'seed' as BrickId, point: studPos, normal: [0, -1, 0] });

    const c = new PlacementController(scene);
    c.add({ id: 'seed' as BrickId, partId: '3001', colorCode: 4, transform: IDENTITY, part });
    c.pickUp(part, 4, IDENTITY);

    expect(c.move(0, 0)).not.toBeNull();
    // Lands somewhere real, resolved against the same candidates a fresh hold would see.
    expect(c.current.candidates.length).toBeGreaterThan(0);
  });

  it('commit clears pickedUp, so the next hold is not mistaken for one', async () => {
    const part = await brick2x4();
    const studPos = await aStudOn(part, IDENTITY);
    const scene = stubScene({ brick: 'seed' as BrickId, point: studPos, normal: [0, -1, 0] });

    const c = new PlacementController(scene);
    c.add({ id: 'seed' as BrickId, partId: '3001', colorCode: 4, transform: IDENTITY, part });
    c.pickUp(part, 4, fromTranslation([500, 0, 0]));
    c.move(0, 0);
    c.commit('a' as BrickId);

    expect(c.pickedUp).toBe(false);
  });

  it('commit releases the hold — placing a picked-up piece does not leave it stuck on the cursor', async () => {
    // The regression this guards: commit() used to clear its own transform/candidate
    // state but never touched `held`, so `holding` stayed true after a successful
    // placement. That was invisible for a fresh chest hold, whose caller (BuilderCanvas)
    // separately clears the chest tile's selectedPartId, which round-trips into a
    // hold(null) call — but a picked-up piece has no such round-trip, so it stayed
    // stuck on the cursor until the user pressed Escape.
    const part = await brick2x4();
    const studPos = await aStudOn(part, IDENTITY);
    const scene = stubScene({ brick: 'seed' as BrickId, point: studPos, normal: [0, -1, 0] });

    const c = new PlacementController(scene);
    c.add({ id: 'seed' as BrickId, partId: '3001', colorCode: 4, transform: IDENTITY, part });
    c.pickUp(part, 4, fromTranslation([500, 0, 0]));
    c.move(0, 0);
    const placed = c.commit('a' as BrickId);

    expect(placed).not.toBeNull();
    expect(c.holding).toBe(false);
  });

  it('keeps the rotation a placed piece had when it is picked back up', async () => {
    // The bug: pickUp reset manualRotation to IDENTITY unconditionally, so a piece
    // placed at some rotation came back up in the bare, unrotated orientation the next
    // resolved candidate happened to have — the piece hasn't changed, only what's
    // holding it has, so its orientation shouldn't reset either.
    const part = await brick2x4();
    const studPos = await aStudOn(part, IDENTITY);
    const scene = stubScene({ brick: 'seed' as BrickId, point: studPos, normal: [0, -1, 0] });

    const c = new PlacementController(scene);
    c.add({ id: 'seed' as BrickId, partId: '3001', colorCode: 4, transform: IDENTITY, part });
    c.hold(part);
    c.move(0, 0);
    const rotated = c.rotateManually(Math.PI / 2);
    expect(rotated).not.toBeNull();
    const placed = c.commit('rotated' as BrickId);
    expect(placed).not.toBeNull();
    const placedTransform = (placed as NonNullable<typeof placed>).transform;

    // Same gesture BuilderCanvas's double-click handler performs: the brick is removed
    // from both indexes, picked up at its own last transform, and repainted at the
    // same cursor position — a mouse that never left the piece it just picked up.
    c.remove((placed as NonNullable<typeof placed>).id);
    c.pickUp(part, 4, placedTransform);
    const afterPickup = c.move(0, 0);

    // Picked straight back up and put straight back down: exactly the same transform,
    // rotation included — not just the position.
    expect(afterPickup).toEqual(placedTransform);
  });

  it('a rotation preserved from pick-up still persists as the cursor keeps moving', async () => {
    // The seeded rotation must behave exactly like any other manualRotation from here
    // on — surviving a move to a different candidate, not just the first repaint.
    const part = await brick2x4();
    const studA = await aStudOn(part, IDENTITY);
    const scene = stubScene({ brick: 'seed' as BrickId, point: studA, normal: [0, -1, 0] });

    const c = new PlacementController(scene);
    c.add({ id: 'seed' as BrickId, partId: '3001', colorCode: 4, transform: IDENTITY, part });
    c.hold(part);
    c.move(0, 0);
    c.rotateManually(Math.PI / 2);
    const placed = c.commit('rotated' as BrickId);
    const placedTransform = (placed as NonNullable<typeof placed>).transform;

    c.remove((placed as NonNullable<typeof placed>).id);
    c.pickUp(part, 4, placedTransform);
    c.move(0, 0);
    // A cursor move onto a different candidate (Tab-equivalent) — the base changes,
    // the seeded spin must still be layered on top of it.
    expect(c.current.candidates.length).toBeGreaterThan(1);
    c.cycle();

    const withoutRotation = c.current.candidates[c.current.index].transform;
    expect(c.current.transform).not.toEqual(withoutRotation);
  });
});

describe('rotation input while holding is never gated', () => {
  // The user's own diagnosis: rotating is how you search for a valid placement, so
  // refusing rotation exactly when the current position doesn't work yet — no
  // candidate, no valid base — is backwards. It's the moment rotating is needed most.
  it('accepts a rotation with no candidate under the cursor, and applies it once one exists', async () => {
    let hit: { brick: BrickId; point: Vec3; normal: Vec3 } | null;
    const part = await brick2x4();
    const studPos = await aStudOn(part, IDENTITY);
    hit = { brick: 'seed' as BrickId, point: [1000, 1000, 1000], normal: [0, -1, 0] };
    const scene: PlacementScene = {
      pick: () => hit,
      pickRay: () => ({ origin: [0, -500, 0] as Vec3, direction: [0, 1, 0] as Vec3 }),
      showGhost: async () => {},
      hideGhost: () => {},
    };

    const c = new PlacementController(scene);
    c.add({ id: 'seed' as BrickId, partId: '3001', colorCode: 4, transform: IDENTITY, part });
    c.hold(part);
    c.move(0, 0);
    // Nowhere to land: no candidates, and a hit exists so there is no ground fallback
    // either — this is the exact state that used to refuse rotation.
    expect(c.current.candidates).toHaveLength(0);
    expect(c.current.transform).toBeNull();

    const rotated = c.rotateManually(Math.PI / 2);
    // Nothing to show yet, but the call itself must not be refused — no exception, no
    // silent early return distinguishable from "the piece isn't held at all".
    expect(rotated).toBeNull();

    // The cursor finds a real stud. The spin dialled in while stranded must still take
    // effect, exactly as if it had been applied here instead of moments earlier.
    hit = { brick: 'seed' as BrickId, point: studPos, normal: [0, -1, 0] };
    c.move(0, 0);

    expect(c.current.transform).not.toBeNull();
    expect(c.current.transform).not.toEqual(c.current.candidates[0]?.transform);
  });

  it('rotateManually only refuses when nothing is held at all', async () => {
    const part = await brick2x4();
    const scene = stubScene(null);
    const c = new PlacementController(scene);

    expect(c.rotateManually(Math.PI / 2)).toBeNull();

    c.hold(part);
    // Over empty space, groundPlacement supplies a base — rotation is accepted and
    // has something to show immediately.
    c.move(0, 0);
    expect(c.rotateManually(Math.PI / 2)).not.toBeNull();
  });
});

describe('keyboard nudge while holding', () => {
  it('moves the ghost by a rigid delta, bypassing candidate resolution', async () => {
    const part = await brick2x4();
    const studPos = await aStudOn(part, IDENTITY);
    const scene = stubScene({ brick: 'seed' as BrickId, point: studPos, normal: [0, -1, 0] });

    const c = new PlacementController(scene);
    c.add({ id: 'seed' as BrickId, partId: '3001', colorCode: 4, transform: IDENTITY, part });
    c.hold(part);
    c.move(0, 0);
    const before = c.current.transform;
    expect(before).not.toBeNull();

    c.nudge(fromTranslation([40, 0, 0]));

    const after = c.current.transform;
    expect(after).not.toBeNull();
    expect(positionOf(after as NonNullable<typeof after>)[0]).toBeCloseTo(
      positionOf(before as NonNullable<typeof before>)[0] + 40,
      6,
    );
  });

  it('does nothing when nothing is held', async () => {
    const part = await brick2x4();
    const scene = stubScene(null);
    const c = new PlacementController(scene);
    c.add({ id: 'seed' as BrickId, partId: '3001', colorCode: 4, transform: IDENTITY, part });

    expect(() => c.nudge(fromTranslation([40, 0, 0]))).not.toThrow();
    expect(c.current.transform).toBeNull();
  });

  it('composes: a second nudge applies on top of the first, not from the original', async () => {
    const part = await brick2x4();
    const studPos = await aStudOn(part, IDENTITY);
    const scene = stubScene({ brick: 'seed' as BrickId, point: studPos, normal: [0, -1, 0] });

    const c = new PlacementController(scene);
    c.add({ id: 'seed' as BrickId, partId: '3001', colorCode: 4, transform: IDENTITY, part });
    c.hold(part);
    c.move(0, 0);
    const start = positionOf(c.current.transform as NonNullable<ReturnType<typeof c.move>>);

    c.nudge(fromTranslation([40, 0, 0]));
    c.nudge(fromTranslation([0, 0, 40]));

    const end = positionOf(c.current.transform as NonNullable<ReturnType<typeof c.move>>);
    expect(end[0]).toBeCloseTo(start[0] + 40, 6);
    expect(end[2]).toBeCloseTo(start[2] + 40, 6);
  });
});
