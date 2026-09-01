/**
 * `RestyleContainer`'s only real logic is building a `Transaction` from a color
 * mapping and handing it to `session.commit()` — everything else is presentation
 * (`RestylePanel.tsx`) or already-tested pure functions (`colorUsage.ts`,
 * `transaction.ts`). This exercises that exact sequence against a real
 * `EditorSession`, the same way `src/scene/interaction/editor.test.ts` exercises
 * placement: real resolved parts, a recording `SceneSync` so the renderer calls can
 * be asserted rather than assumed.
 *
 * What this guards specifically: that committing a restyle rebatches the *scene*
 * correctly on its own (remove the old `(partId, colorCode)` batch, add the new one)
 * with no extra write path from this feature, and that undo restores every original
 * color exactly — the whole point of "apply is one undo step."
 */
import { describe, expect, it } from 'vitest';

import { IDENTITY, fromTranslation } from '../../math';
import { mintBrickId } from '../../model/ids';
import type { BrickInstance } from '../../model/types';
import { fixtureReader } from '../../snap/__fixtures__/reader';
import { resolvePart } from '../../snap/resolvePart';
import type { PartDef } from '../../snap/types';
import type { BrickId, Mat4 } from '../../types';
import { EditorSession, type SceneSync } from '../../scene/interaction/editor';
import { buildRestyleTransaction } from './transaction';

const BRICK_HEIGHT = 24;

async function brick2x4(): Promise<PartDef> {
  return {
    id: '3001',
    title: 'Brick  2 x  4',
    connections: await resolvePart('3001', fixtureReader),
    bounds: { min: [-40, -4, -20], max: [40, 24, 20] },
    occupancy: { dims: [0, 0, 0], bits: new Uint8Array(0) },
  };
}

/** Records what the renderer was told, so a commit's rebatch can be asserted. */
function recordingScene(): SceneSync & { added: BrickId[]; removed: BrickId[] } {
  const added: BrickId[] = [];
  const removed: BrickId[] = [];
  return {
    added,
    removed,
    addBrick: (b) => void added.push(b.id),
    removeBrick: (id) => void removed.push(id),
    setBrickTransform: () => {},
  };
}

const instance = (part: PartDef, transform: Mat4, colorCode: number): BrickInstance => ({
  id: mintBrickId(),
  partId: part.id,
  colorCode,
  transform,
});

describe('restyle, committed through a real EditorSession', () => {
  it('rebatches every recolored brick — one remove, one re-add per brick, no others touched', async () => {
    const part = await brick2x4();
    const scene = recordingScene();
    const session = new EditorSession(scene);
    session.registerPart(part);

    const red = instance(part, IDENTITY, 4);
    const alsoRed = instance(part, fromTranslation([0, -BRICK_HEIGHT, 0]), 4);
    const blue = instance(part, fromTranslation([0, -2 * BRICK_HEIGHT, 0]), 1);
    for (const b of [red, alsoRed, blue]) session.place(b, part);
    scene.added.length = 0; // only the restyle's own rebatch is under test below

    const mapping = new Map([[4, 25]]); // Red -> Orange; Blue untouched
    const tx = buildRestyleTransaction(session.document.bricks.values(), mapping);
    expect(tx).not.toBeNull();
    expect(tx?.label).toBe('Restyle 2 bricks');

    session.commit(tx!);

    expect(session.document.bricks.get(red.id)?.colorCode).toBe(25);
    expect(session.document.bricks.get(alsoRed.id)?.colorCode).toBe(25);
    expect(session.document.bricks.get(blue.id)?.colorCode).toBe(1);

    // Exactly the two recolored bricks were rebatched — the untouched blue brick
    // never round-tripped through the renderer at all.
    expect(scene.removed.sort()).toEqual([red.id, alsoRed.id].sort());
    expect(scene.added.sort()).toEqual([red.id, alsoRed.id].sort());
  });

  it('undo restores every original color in one step', async () => {
    const part = await brick2x4();
    const session = new EditorSession(recordingScene());
    session.registerPart(part);

    const bricks = [instance(part, IDENTITY, 4), instance(part, fromTranslation([0, -BRICK_HEIGHT, 0]), 15)];
    for (const b of bricks) session.place(b, part);

    const tx = buildRestyleTransaction(session.document.bricks.values(), new Map([[4, 25], [15, 71]]));
    session.commit(tx!);
    expect(session.document.bricks.get(bricks[0].id)?.colorCode).toBe(25);
    expect(session.document.bricks.get(bricks[1].id)?.colorCode).toBe(71);
    expect(session.undoLabel).toBe('Restyle 2 bricks');

    session.undo();

    expect(session.document.bricks.get(bricks[0].id)?.colorCode).toBe(4);
    expect(session.document.bricks.get(bricks[1].id)?.colorCode).toBe(15);
  });

  it('a mapping that changes nothing produces no transaction, so there is nothing to commit', async () => {
    const part = await brick2x4();
    const session = new EditorSession(recordingScene());
    session.registerPart(part);
    session.place(instance(part, IDENTITY, 4), part);

    expect(buildRestyleTransaction(session.document.bricks.values(), new Map())).toBeNull();
    expect(buildRestyleTransaction(session.document.bricks.values(), new Map([[4, 4]]))).toBeNull();
  });
});
