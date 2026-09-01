import { describe, expect, it } from 'vitest';

import { fromTranslation, multiply, fromYRotation } from '../math';
import { createDocument } from './document';
import { edgeIdFor, mintBrickId, mintGroupId } from './ids';
import { mate } from './testing';
import {
  DOCUMENT_FORMAT_VERSION,
  fromJSON,
  parseDocument,
  stringifyDocument,
  toJSON,
  toLdr,
} from './serialize';
import type { BrickInstance, GroupDef } from './types';

/** Minted rather than labelled, because `fromJSON` validates every id it reads. */
const sample = () => {
  const wall = { id: mintGroupId(), name: 'Wall' } satisfies GroupDef;
  const trim = { id: mintGroupId(), name: 'Trim', parentId: wall.id } satisfies GroupDef;

  const a: BrickInstance = {
    id: mintBrickId(),
    partId: '3001',
    colorCode: 4,
    transform: fromTranslation([0, 0, 0]),
  };
  const b: BrickInstance = {
    id: mintBrickId(),
    partId: '3023',
    colorCode: 15,
    transform: multiply(fromTranslation([20, -24, 0]), fromYRotation(Math.PI / 4)),
    groupId: wall.id,
  };

  const edges = [
    { id: edgeIdFor(a.id, b.id), a: a.id, b: b.id, mates: [mate('studC-1', 'studC-3')] },
  ];
  return { doc: createDocument([a, b], [wall, trim], edges), a, b, wall, trim };
};

describe('JSON round trip', () => {
  it('restores bricks, groups and the graph', () => {
    const { doc, a, b, wall } = sample();
    const back = parseDocument(stringifyDocument(doc));

    expect(back.bricks.size).toBe(2);
    expect(back.groups.size).toBe(2);
    expect(back.bricks.get(a.id)?.partId).toBe('3001');
    expect(back.bricks.get(b.id)?.colorCode).toBe(15);
    expect(back.bricks.get(b.id)?.groupId).toBe(wall.id);
    expect(back.bricks.get(b.id)?.transform).toEqual([...b.transform]);
  });

  it('keeps ids, unlike a trip through .ldr', () => {
    const { doc, a } = sample();
    expect(parseDocument(stringifyDocument(doc)).bricks.has(a.id)).toBe(true);
  });

  it('restores connectivity rather than re-deriving it', () => {
    const { doc, a, b } = sample();
    const back = parseDocument(stringifyDocument(doc));

    expect(back.graph.edges.size).toBe(1);
    expect([...back.graph.neighbors(a.id)]).toEqual([b.id]);
    // The graph stores each edge canonically by its brick pair, flipping mates to
    // match, so the orientation depends on how the minted ids happen to sort.
    // Comparing the round trip against the original is what the format must promise.
    expect([...back.graph.edges.values()]).toEqual([...doc.graph.edges.values()]);
  });

  it('preserves the group tree', () => {
    const { doc, wall, trim } = sample();
    const back = parseDocument(stringifyDocument(doc));
    expect(back.groups.get(trim.id)?.parentId).toBe(wall.id);
  });

  it('omits absent optional fields rather than writing undefined', () => {
    const { doc, a } = sample();
    const json = toJSON(doc);
    expect(Object.hasOwn(json.bricks.find((x) => x.id === a.id)!, 'groupId')).toBe(false);
  });
});

describe('fromJSON validation', () => {
  const valid = () => toJSON(sample().doc) as unknown as Record<string, unknown>;

  it('rejects a version it does not understand', () => {
    expect(() => fromJSON({ ...valid(), version: DOCUMENT_FORMAT_VERSION + 1 })).toThrow(
      /unsupported format version/,
    );
  });

  it('rejects ids that did not come from the minter', () => {
    const doc = valid();
    (doc.bricks as { id: string }[])[0].id = 'not-an-id';
    expect(() => fromJSON(doc)).toThrow(/not a valid brick id/);
  });

  it('rejects a transform that is not 16 elements', () => {
    const doc = valid();
    (doc.bricks as { transform: number[] }[])[0].transform = [1, 2, 3];
    expect(() => fromJSON(doc)).toThrow(/16-element transform/);
  });

  it('rejects an edge pointing at a brick that is not there', () => {
    const doc = valid();
    (doc.edges as { a: string }[])[0].a = mintBrickId();
    expect(() => fromJSON(doc)).toThrow(/unknown brick/);
  });

  it('rejects a brick in a group that is not there', () => {
    const doc = valid();
    (doc.bricks as { groupId?: string }[])[1].groupId = mintGroupId();
    expect(() => fromJSON(doc)).toThrow(/unknown group/);
  });

  it('rejects input that is not a document at all', () => {
    expect(() => fromJSON(null)).toThrow(/expected an object/);
    expect(() => fromJSON({ version: DOCUMENT_FORMAT_VERSION })).toThrow(/missing bricks/);
  });
});

describe('toLdr', () => {
  it('writes the rotation row-major, reading our column-major matrix by stride', () => {
    const brick: BrickInstance = {
      id: mintBrickId(),
      partId: '3001',
      colorCode: 4,
      // Column-major: translation in 12..14, basis columns at 0..2, 4..6, 8..10.
      transform: [2, 3, 4, 0, 5, 6, 7, 0, 8, 9, 10, 0, 11, 12, 13, 1],
    };
    const line = toLdr(createDocument([brick]))
      .split('\n')
      .find((l) => l.startsWith('1 '));

    // 1 colour x y z  a b c  d e f  g h i  file
    expect(line).toBe('1 4 11 12 13 2 5 8 3 6 9 4 7 10 3001.dat');
  });

  it('drops ids and connectivity, which the format cannot carry', () => {
    const { doc, a } = sample();
    const text = toLdr(doc);
    expect(text).not.toContain(a.id);
    expect(text.split('\n').filter((l) => l.startsWith('1 ')).length).toBe(2);
  });

  it('keeps group members adjacent under a comment', () => {
    const { doc, wall } = sample();
    const lines = toLdr(doc).split('\n');
    const header = lines.findIndex((l) => l === `0 // ${wall.name}`);
    expect(header).toBeGreaterThan(-1);
    expect(lines[header + 1]).toMatch(/^1 15 /);
  });

  it('trims float noise rather than writing full precision', () => {
    const brick: BrickInstance = {
      id: mintBrickId(),
      partId: '3001',
      colorCode: 0,
      transform: fromTranslation([0.1 + 0.2, 1, 1]),
    };
    expect(toLdr(createDocument([brick]))).toContain('1 0 0.3 1 1 ');
  });

  it('names the model and closes with a step', () => {
    const text = toLdr(createDocument([]), { name: 'Tower', author: 'Someone' });
    expect(text).toContain('0 FILE Tower');
    expect(text).toContain('0 Author: Someone');
    expect(text.trimEnd().endsWith('0 STEP')).toBe(true);
  });
});
