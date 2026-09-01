/**
 * The session against real parts from the captured corpus.
 *
 * Placement here is physical: a 2x4 lands on another 2x4's stud because the mating
 * solver put it there, and a brick placed into occupied space is refused because the
 * occupancy masks overlap. Nothing is stubbed, so a passing test means the channel
 * genuinely cannot write a model the graph would reject.
 */

import { describe, expect, it } from 'vitest';

import { IDENTITY, fromTranslation } from '../../math';
import { Session, SessionError } from './session';
import { fixtureParts } from './__fixtures__/parts';

/** A male stud on the top face of a 2x4. */
const STUD = 'p/stud.dat#0';

const session = () => new Session(fixtureParts);

/** One 2x4 at the origin, which every stacking test builds on. */
async function seeded() {
  const s = session();
  await s.place([{ part: '3001', color: 4, transform: IDENTITY }]);
  return s;
}

describe('free placement', () => {
  it('places a brick and names it after what it is', async () => {
    const s = session();
    const { placed, rejected } = await s.place([{ part: '3001', color: 4, transform: IDENTITY }]);

    expect(rejected).toEqual([]);
    expect(placed[0].handle).toBe('brick-2x4-1');
    expect(placed[0].position).toEqual([0, 0, 0]);
    expect(s.document.bricks.size).toBe(1);
  });

  it('refuses a request with neither a connection point nor a transform', async () => {
    const { rejected } = await session().place([{ part: '3001', color: 4 }]);
    expect(rejected[0].reason).toMatch(/either a connection point .* or an explicit "transform"/);
  });

  it('refuses a transform that is not a 4x4', async () => {
    const { rejected } = await session().place([
      { part: '3001', color: 4, transform: [1, 0, 0, 1] },
    ]);
    expect(rejected[0].reason).toMatch(/16 numbers/);
  });
});

describe('placement on a connection point', () => {
  it('stacks a brick on a stud and records the connection', async () => {
    const s = await seeded();
    const { placed, rejected } = await s.place([
      { part: '3001', color: 1, on: { brick: 'brick-2x4-1', point: STUD } },
    ]);

    expect(rejected).toEqual([]);
    expect(placed[0].connectedTo).toEqual(['brick-2x4-1']);
    expect(s.document.graph.edges.size).toBe(1);
  });

  it('mates every stud that coincides, not just the one named', async () => {
    const s = await seeded();
    // Corner stud to corner socket, so the bricks land squarely on top of each other
    // rather than overhanging — which is the case that engages all eight studs.
    await s.place([
      { part: '3001', color: 1, on: { brick: 'brick-2x4-1', point: 'p/stud.dat#7' } },
    ]);

    const edge = s.edgeBetween('brick-2x4-1', 'brick-2x4-2');
    expect(edge?.mates).toHaveLength(8);
  });

  it('names the points available when the point does not exist', async () => {
    const s = await seeded();
    const { rejected } = await s.place([
      { part: '3001', color: 1, on: { brick: 'brick-2x4-1', point: 'nope' } },
    ]);

    expect(rejected[0].reason).toMatch(/has no connection point "nope"/);
    // The hint must reach the studs, not stop at the eight underside sockets.
    expect(rejected[0].reason).toContain('p/stud.dat#0');
    expect(rejected[0].reason).toContain('parts/s/3001s01.dat#0');
  });

  it('rejects an unknown brick by name rather than throwing', async () => {
    const s = await seeded();
    const { rejected } = await s.place([
      { part: '3001', color: 1, on: { brick: 'brick-2x4-99', point: STUD } },
    ]);
    expect(rejected[0].reason).toMatch(/no brick called/);
  });

  it('refuses a placement that would overlap, and says why', async () => {
    const s = await seeded();
    const { placed, rejected } = await s.place([
      { part: '3001', color: 2, transform: fromTranslation([0, 0, 0]) },
    ]);

    expect(placed).toEqual([]);
    expect(rejected[0].reason).toMatch(/would overlap/);
    expect(s.document.bricks.size).toBe(1);
  });
});

describe('batching', () => {
  it('places many bricks in one transaction, each stacking on the last', async () => {
    const s = await seeded();
    const { placed, rejected } = await s.place([
      { part: '3001', color: 1, on: { brick: 'brick-2x4-1', point: STUD } },
      { part: '3001', color: 2, on: { brick: 'brick-2x4-2', point: STUD } },
    ]);

    expect(rejected).toEqual([]);
    expect(placed).toHaveLength(2);
    expect(s.document.bricks.size).toBe(3);
    // One undo step for the batch, on top of the seed.
    s.undo();
    expect(s.document.bricks.size).toBe(1);
  });

  it('keeps the good half of a mixed batch and explains the rest', async () => {
    const s = await seeded();
    const { placed, rejected } = await s.place([
      { part: '3001', color: 1, on: { brick: 'brick-2x4-1', point: STUD } },
      { part: '3001', color: 2, transform: IDENTITY },
    ]);

    expect(placed).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatch(/would overlap/);
  });
});

describe('editing', () => {
  it('re-solves connectivity when bricks move apart', async () => {
    const s = await seeded();
    await s.place([{ part: '3001', color: 1, on: { brick: 'brick-2x4-1', point: STUD } }]);
    expect(s.document.graph.edges.size).toBe(1);

    s.transform(['brick-2x4-2'], fromTranslation([500, 0, 0]));
    expect(s.document.graph.edges.size).toBe(0);
  });

  it('drops edges when a brick is deleted', async () => {
    const s = await seeded();
    await s.place([{ part: '3001', color: 1, on: { brick: 'brick-2x4-1', point: STUD } }]);

    s.remove(['brick-2x4-2']);
    expect(s.document.bricks.size).toBe(1);
    expect(s.document.graph.edges.size).toBe(0);
  });

  it('recolours only what actually changes', async () => {
    const s = await seeded();
    expect(s.recolor(['brick-2x4-1'], 1)).toEqual(['brick-2x4-1']);
    expect([...s.document.bricks.values()][0].colorCode).toBe(1);
  });

  it('names what it could not find rather than guessing at the kind', async () => {
    const s = await seeded();
    expect(() => s.remove(['nothing-here'])).toThrow(SessionError);
    expect(() => s.remove(['nothing-here'])).toThrow(/no brick or group by that name/);
  });
});

describe('history', () => {
  it('undoes and redoes a placement, restoring connectivity exactly', async () => {
    const s = await seeded();
    await s.place([{ part: '3001', color: 1, on: { brick: 'brick-2x4-1', point: STUD } }]);

    expect(s.undo()).toBe('Place brick');
    expect(s.document.bricks.size).toBe(1);
    expect(s.document.graph.edges.size).toBe(0);

    expect(s.redo()).toBe('Place brick');
    expect(s.document.bricks.size).toBe(2);
    expect(s.document.graph.edges.size).toBe(1);
  });

  it('reports nothing to undo rather than failing', async () => {
    expect(session().undo()).toBeUndefined();
  });
});

describe('groups', () => {
  it('collects bricks under a name and moves them as one', async () => {
    const s = await seeded();
    await s.place([{ part: '3001', color: 1, on: { brick: 'brick-2x4-1', point: STUD } }]);

    s.createGroup('Tower', ['brick-2x4-1', 'brick-2x4-2']);
    expect(s.summary().groups).toEqual([{ name: 'Tower', members: 2 }]);

    // The group name resolves as a selection.
    expect(s.transform(['Tower'], fromTranslation([0, 0, 100]))).toHaveLength(2);
  });

  it('rejects a duplicate group name', async () => {
    const s = await seeded();
    s.createGroup('Wall');
    expect(() => s.createGroup('Wall')).toThrow(/already exists/);
  });

  it('renames a group, keeping its members', async () => {
    const s = await seeded();
    s.createGroup('Wall', ['brick-2x4-1']);
    s.renameGroup('Wall', 'Facade');

    expect(s.summary().groups).toEqual([{ name: 'Facade', members: 1 }]);
    expect(s.inspect('brick-2x4-1').group).toBe('Facade');
  });

  it('ungroups without deleting the bricks', async () => {
    const s = await seeded();
    s.createGroup('Wall', ['brick-2x4-1']);

    expect(s.ungroup('Wall')).toBe(1);
    expect(s.document.groups.size).toBe(0);
    expect(s.document.bricks.size).toBe(1);
    expect(s.inspect('brick-2x4-1').group).toBeUndefined();
  });

  it('nests a group under a parent', async () => {
    const s = await seeded();
    s.createGroup('Building');
    s.createGroup('Wall', ['brick-2x4-1'], 'Building');

    expect(s.summary().groups).toContainEqual({ name: 'Wall', members: 1, parent: 'Building' });
  });
});

describe('queries', () => {
  it('shrinks the free points as a stud is built on', async () => {
    const s = await seeded();
    const before = s.freePoints('brick-2x4-1').length;

    await s.place([{ part: '3001', color: 1, on: { brick: 'brick-2x4-1', point: STUD } }]);
    const after = s.freePoints('brick-2x4-1');

    expect(after.length).toBeLessThan(before);
    expect(after.map((p) => p.point)).not.toContain(STUD);
  });

  it('returns the whole structure from any brick in it', async () => {
    const s = await seeded();
    await s.place([{ part: '3001', color: 1, on: { brick: 'brick-2x4-1', point: STUD } }]);

    expect([...s.component('brick-2x4-2')].sort()).toEqual(['brick-2x4-1', 'brick-2x4-2']);
    expect(s.neighbors('brick-2x4-1')).toEqual(['brick-2x4-2']);
  });

  it('summarises parts, colours and components', async () => {
    const s = await seeded();
    await s.place([{ part: '3001', color: 1, on: { brick: 'brick-2x4-1', point: STUD } }]);

    const summary = s.summary();
    expect(summary.bricks).toBe(2);
    expect(summary.parts).toEqual([{ part: '3001', title: 'Brick  2 x  4', count: 2 }]);
    expect(summary.colors).toEqual([1, 4]);
    expect(summary.components).toEqual([2]);
    expect(summary.connections).toBe(1);
  });

  it('measures bounds across the whole model, not one brick', async () => {
    const s = await seeded();
    await s.place([{ part: '3001', color: 1, transform: fromTranslation([200, 0, 0]) }]);

    const bounds = s.summary().bounds!;
    expect(bounds.min[0]).toBe(-40);
    expect(bounds.max[0]).toBe(240);
  });

  it('filters bricks by part, colour and group', async () => {
    const s = await seeded();
    await s.place([{ part: '3001', color: 1, on: { brick: 'brick-2x4-1', point: STUD } }]);
    s.createGroup('Top', ['brick-2x4-2']);

    expect(s.find({ color: 1 })).toEqual(['brick-2x4-2']);
    expect(s.find({ group: 'Top' })).toEqual(['brick-2x4-2']);
    expect(s.find({ part: '3001' })).toHaveLength(2);
    expect(s.find({ part: '3023' })).toEqual([]);
  });

  it('reports a brick in full, including what it is joined to', async () => {
    const s = await seeded();
    await s.place([{ part: '3001', color: 1, on: { brick: 'brick-2x4-1', point: STUD } }]);

    const detail = s.inspect('brick-2x4-1');
    expect(detail.title).toBe('Brick  2 x  4');
    expect(detail.color).toBe(4);
    expect(detail.connectedTo).toEqual(['brick-2x4-2']);
    expect(detail.occupiedPoints).toContain(STUD);
  });
});
