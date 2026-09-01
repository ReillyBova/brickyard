/**
 * Wraps a `SceneSync` so its calls land on the delegate in the order the document actually
 * changed, even though `addBrick` is async and `EditorSession.reconcile` fires it without
 * awaiting (`void this.scene.addBrick(brick)` — replaying a bulk transaction or loading a
 * model must not block on geometry resolution one brick at a time).
 *
 * `SceneRenderer.addBrick` awaits `loadGeometry` before it creates or grows the instanced
 * batch and writes the instance — a real window, even for already-cached geometry (an
 * already-resolved promise still takes a microtask tick to continue). A brick can be
 * removed, or removed-then-re-added (undo of a remove, then undo of the original place —
 * both synchronous, both firing before the first `addBrick` has landed), entirely inside
 * that window. Two hazards follow:
 *
 *  - `removeBrick` is synchronous and "remove if present" — a no-op for a brick the
 *    renderer hasn't tracked yet. Firing it while the add is still pending drops the
 *    removal on the floor; the add lands moments later regardless, for a brick the
 *    document no longer has.
 *  - A second `addBrick` for the same id (the reappear-then-vanish sequence above) starts
 *    a second, independent `renderer.addBrick` call while the first is still in flight.
 *    Tracking "is an add pending" as a single flag per id (rather than serialising the
 *    calls) loses track of the first call once the second starts, so a compensating
 *    removal meant for one of them can be consumed by the other and never applied to the
 *    one that actually needed it.
 *
 * Repeated, either hazard grows the instanced batch (and its GPU buffer) without bound
 * even though the document's brick count stays flat — this is what `docs/ARCHITECTURE.md`
 * would call the render tree drifting from its projection.
 *
 * The fix: serialise every call for a given brick id into one chain, and track only the
 * *last* desired state (`'present'` or `'absent'`) for that id rather than trying to
 * cancel a specific in-flight call. Each queued add checks, both before it starts and
 * after `delegate.addBrick` resolves, whether it is still what the id's last call asked
 * for; if a removal superseded it either way, it retracts itself immediately. A queued
 * removal likewise only forwards to the delegate if removal is still the last thing asked
 * for by the time its turn comes up. Net effect always matches "what the document looks
 * like now," regardless of how many adds and removes for the same id raced each other.
 *
 * A `removeBrick` with nothing in flight for that id — the overwhelming common case, an
 * ordinary delete of an already-settled brick — still forwards synchronously, matching
 * the delegate's own contract and costing nothing extra on the hot path.
 */
import type { BrickId } from '../../types';
import type { SceneSync } from './editor.ts';

type Desired = 'present' | 'absent';

export function makeRaceSafeSceneSync(delegate: SceneSync): SceneSync {
  /** One serialised chain of operations per brick id, so overlapping add/remove calls
   *  for the same id are never in flight against the delegate at the same time. Cleared
   *  once a chain catches up to idle, so this never grows past "ids with an add currently
   *  in flight." */
  const chains = new Map<BrickId, Promise<void>>();
  /** What the most recent call for this id asked for — the only thing a queued op
   *  consults, rather than trying to identify "its own" in-flight call. */
  const desired = new Map<BrickId, Desired>();

  const enqueue = (id: BrickId, op: () => Promise<void> | void): Promise<void> => {
    const prev = chains.get(id) ?? Promise.resolve();
    const next = prev.then(op).catch(() => {
      // A delegate failure for one brick must not wedge every later operation on the
      // same id — this chain exists for ordering, not error propagation.
    });
    chains.set(id, next);
    void next.then(() => {
      if (chains.get(id) === next) chains.delete(id);
    });
    return next;
  };

  return {
    addBrick: async (brick, options) => {
      desired.set(brick.id, 'present');
      await enqueue(brick.id, async () => {
        if (desired.get(brick.id) !== 'present') return; // superseded before its turn came up
        await delegate.addBrick(brick, options);
        if (desired.get(brick.id) !== 'present') {
          // Removed (or removed-then-re-added-then-removed again — only the latest
          // call's answer matters) while this add's geometry fetch was in flight.
          delegate.removeBrick(brick.id);
        }
      });
    },
    removeBrick: (id) => {
      desired.set(id, 'absent');
      if (!chains.has(id)) {
        // Nothing in flight for this id: the common case, an ordinary delete of an
        // already-settled brick. Forward immediately, matching the delegate's own
        // synchronous "remove if present" contract.
        delegate.removeBrick(id);
        return;
      }
      void enqueue(id, () => {
        if (desired.get(id) === 'absent') delegate.removeBrick(id);
      });
    },
    setBrickTransform: (id, transform) => {
      delegate.setBrickTransform(id, transform);
    },
  };
}
