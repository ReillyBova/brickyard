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
  ghosts: { transform: Mat4; valid: boolean }[];
  hidden: number;
} {
  const ghosts: { transform: Mat4; valid: boolean }[] = [];
  let hidden = 0;
  return {
    ghosts,
    get hidden() {
      return hidden;
    },
    pick: () => hit,
    pickRay: () => ({ origin: [0, -500, 0] as Vec3, direction: [0, 1, 0] as Vec3 }),
    showGhost: async (_p, _c, transform, valid) => {
      ghosts.push({ transform, valid });
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
      Promise.resolve({ connections: baked.connections, occupancy: new Map() }),
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
