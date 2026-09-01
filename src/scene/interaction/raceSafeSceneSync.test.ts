import { describe, expect, it } from 'vitest';

import { mintBrickId } from '../../model/ids.ts';
import type { BrickInstance } from '../../model/types';
import type { BrickId, Mat4 } from '../../types';
import type { SceneSync } from './editor.ts';
import { makeRaceSafeSceneSync } from './raceSafeSceneSync.ts';

const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** `addBrick`'s op is enqueued via a promise chain, so it starts on the next microtask
 *  rather than synchronously — tests await this between issuing a call and resolving it. */
const tick = (): Promise<void> => Promise.resolve().then(() => {});

function brick(id: BrickId): BrickInstance {
  return { id, partId: '3001', colorCode: 4, transform: IDENTITY };
}

/**
 * A `SceneSync` double standing in for `SceneRenderer`: `addBrick` resolves only when the
 * test calls `resolveAdd`, so the geometry-fetch window the real `SceneRenderer.addBrick`
 * opens can be driven by hand. `present` mirrors exactly the thing the leak is about —
 * "does the renderer's instanced batch still hold an instance for this id" — rather than
 * a raw call log, since with per-id serialisation multiple add/remove calls for the same
 * id are expected and are not by themselves a problem; an id left in `present` after the
 * document has settled on "absent" is the actual bug.
 */
function makeControllableDelegate(): {
  delegate: SceneSync;
  resolveAdd: (id: BrickId) => Promise<void>;
  present: Set<BrickId>;
  addCount: Map<BrickId, number>;
} {
  const resolvers = new Map<BrickId, (() => void)[]>();
  const present = new Set<BrickId>();
  const addCount = new Map<BrickId, number>();

  const delegate: SceneSync = {
    addBrick: (b) =>
      new Promise<void>((resolve) => {
        const queue = resolvers.get(b.id) ?? [];
        queue.push(() => {
          present.add(b.id);
          addCount.set(b.id, (addCount.get(b.id) ?? 0) + 1);
          resolve();
        });
        resolvers.set(b.id, queue);
      }),
    removeBrick: (id) => {
      present.delete(id);
    },
    setBrickTransform: () => {},
  };

  return {
    delegate,
    // `op` (which calls `delegate.addBrick`) is enqueued via a promise chain, so it
    // starts on a later microtask rather than synchronously when `addBrick` is called —
    // wait for that before expecting a resolver to exist.
    resolveAdd: async (id) => {
      await tick();
      const queue = resolvers.get(id);
      const next = queue?.shift();
      if (!next) throw new Error(`no pending addBrick for ${id}`);
      next();
    },
    present,
    addCount,
  };
}

describe('makeRaceSafeSceneSync', () => {
  it('forwards a normal add with no race untouched', async () => {
    const { delegate, resolveAdd, present } = makeControllableDelegate();
    const sync = makeRaceSafeSceneSync(delegate);
    const id = mintBrickId();

    const done = sync.addBrick(brick(id));
    await resolveAdd(id);
    await done;

    expect(present.has(id)).toBe(true);
  });

  it('forwards an ordinary removeBrick immediately when nothing is pending', () => {
    const { delegate, present } = makeControllableDelegate();
    const sync = makeRaceSafeSceneSync(delegate);
    const id = mintBrickId();
    present.add(id); // simulate an already-settled, already-rendered brick

    sync.removeBrick(id);

    expect(present.has(id)).toBe(false);
  });

  it('retracts a brick removed while its add is genuinely in flight, instead of orphaning it', async () => {
    const { delegate, resolveAdd, present } = makeControllableDelegate();
    const sync = makeRaceSafeSceneSync(delegate);
    const id = mintBrickId();

    const done = sync.addBrick(brick(id));
    await tick(); // let the op start and call delegate.addBrick — it's now genuinely in flight
    // The document already dropped this brick (delete, or undo) before the geometry
    // fetch behind `addBrick` resolved.
    sync.removeBrick(id);
    await resolveAdd(id);
    await done;

    // Net effect: added then immediately removed, exactly what happened to the document.
    expect(present.has(id)).toBe(false);
  });

  it('skips the delegate add entirely when a removal supersedes it before its turn even comes up', async () => {
    // A place immediately followed by a delete, with no yield in between — nothing here
    // has started an actual geometry fetch yet, so the right outcome is to never bother:
    // no delegate.addBrick call, not an add-then-immediate-retraction.
    const { delegate, present, addCount } = makeControllableDelegate();
    const sync = makeRaceSafeSceneSync(delegate);
    const id = mintBrickId();

    const done = sync.addBrick(brick(id));
    sync.removeBrick(id);
    await done;

    expect(present.has(id)).toBe(false);
    expect(addCount.get(id) ?? 0).toBe(0);
  });

  it(
    'place, delete, undo the delete, undo the place — all synchronous, matching ' +
      'EditorSession.reconcile — never leaves an orphaned instance',
    async () => {
      // This is the exact shape that orphaned an instance before this fix: a keyboard
      // undo run twice in a row fires addBrick, removeBrick, addBrick, removeBrick for
      // the same id, all before the first addBrick's geometry fetch has resolved. A
      // single in-flight flag (rather than serialising per id) loses track of which
      // in-flight `renderer.addBrick` call a later removal was meant to cancel. Here all
      // four calls land before either queued op gets a turn, so 'absent' — the final
      // answer — is what both ops see; neither ever calls the delegate's add at all.
      const { delegate, present, addCount } = makeControllableDelegate();
      const sync = makeRaceSafeSceneSync(delegate);
      const id = mintBrickId();

      const add1 = sync.addBrick(brick(id)); // place
      sync.removeBrick(id); // delete
      const add2 = sync.addBrick(brick(id)); // undo the delete — brick reappears
      sync.removeBrick(id); // undo the place — brick gone again

      await Promise.all([add1, add2]);

      expect(present.has(id)).toBe(false);
      expect(addCount.get(id) ?? 0).toBe(0);
    },
  );

  it(
    'place, delete, undo the delete, undo the place — with the first add already in ' +
      'flight when the race starts — still never leaves an orphaned instance',
    async () => {
      const { delegate, resolveAdd, present } = makeControllableDelegate();
      const sync = makeRaceSafeSceneSync(delegate);
      const id = mintBrickId();

      const add1 = sync.addBrick(brick(id)); // place
      await tick(); // geometry fetch for the first add is now genuinely in flight
      sync.removeBrick(id); // delete
      const add2 = sync.addBrick(brick(id)); // undo the delete — brick reappears
      sync.removeBrick(id); // undo the place — brick gone again

      await resolveAdd(id); // the first add's geometry fetch lands
      await add1;
      await Promise.all([add2]);

      expect(present.has(id)).toBe(false);
    },
  );

  it('does not orphan across many concurrent adds racing removals for different bricks', async () => {
    const { delegate, resolveAdd, present } = makeControllableDelegate();
    const sync = makeRaceSafeSceneSync(delegate);
    const ids = Array.from({ length: 20 }, () => mintBrickId());

    const pending = ids.map((id) => sync.addBrick(brick(id)));
    await tick(); // every add is now genuinely in flight, geometry fetch already called
    // Remove every odd-indexed brick while its add is in flight — the bulk
    // delete-right-after-paste shape from the bug report.
    ids.forEach((id, i) => {
      if (i % 2 === 1) sync.removeBrick(id);
    });
    for (const id of ids) await resolveAdd(id);
    await Promise.all(pending);

    ids.forEach((id, i) => {
      expect(present.has(id)).toBe(i % 2 === 0);
    });
  });

  it('a fresh add after a queued removal (undo of the removal) cancels the retraction', async () => {
    const { delegate, resolveAdd, present, addCount } = makeControllableDelegate();
    const sync = makeRaceSafeSceneSync(delegate);
    const id = mintBrickId();

    const firstAdd = sync.addBrick(brick(id));
    await tick(); // first add's geometry fetch is now genuinely in flight
    sync.removeBrick(id); // queued — first add hasn't landed yet
    await resolveAdd(id);
    await firstAdd;
    expect(present.has(id)).toBe(false); // the queued removal replayed once the add landed

    // The brick comes back (e.g. redo) — a genuinely new add, unrelated to the old race.
    const secondAdd = sync.addBrick(brick(id));
    await resolveAdd(id);
    await secondAdd;

    expect(present.has(id)).toBe(true);
    expect(addCount.get(id)).toBe(2);
  });

  it('setBrickTransform passes straight through', () => {
    const { delegate } = makeControllableDelegate();
    const calls: BrickId[] = [];
    const recording: SceneSync = {
      ...delegate,
      setBrickTransform: (id) => calls.push(id),
    };
    const sync = makeRaceSafeSceneSync(recording);
    const id = mintBrickId();

    sync.setBrickTransform(id, IDENTITY);

    expect(calls).toEqual([id]);
  });
});
