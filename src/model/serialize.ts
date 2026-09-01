/**
 * Document serialization.
 *
 * Two formats, because they answer different questions.
 *
 * The JSON form is lossless: brick ids, the group tree and the solved connection graph
 * all survive, so saving and reloading returns the document that was saved. It is what
 * the application persists.
 *
 * `.ldr` is for interop — Studio, LeoCAD, LDView — and is lossy by nature. The format
 * carries a colour, a transform and a filename per line and nothing else, so ids,
 * groups and connectivity are dropped. A round trip through it mints fresh ids and
 * re-solves the graph.
 *
 * Pure: no three.js imports, no DOM, no I/O.
 */

import type { BrickId, GroupId, Mat4 } from '../types';
import { createDocument } from './document';
import { asBrickId, asGroupId, edgeIdFor } from './ids';
import type { BrickInstance, ConnectionEdge, GroupDef, SceneDocument } from './types';
import type { Mate } from '../snap/types';

/** Bumped only when a change would make an older file unreadable. */
export const DOCUMENT_FORMAT_VERSION = 1;

export interface SerializedDocument {
  version: number;
  bricks: readonly {
    id: string;
    partId: string;
    colorCode: number;
    transform: readonly number[];
    groupId?: string;
  }[];
  groups: readonly { id: string; name: string; parentId?: string }[];
  /** Edge ids are derived from the pair, so they are not stored. */
  edges: readonly { a: string; b: string; mates: readonly Mate[] }[];
}

export function toJSON(doc: SceneDocument): SerializedDocument {
  return {
    version: DOCUMENT_FORMAT_VERSION,
    bricks: [...doc.bricks.values()].map((brick) => ({
      id: brick.id,
      partId: brick.partId,
      colorCode: brick.colorCode,
      transform: [...brick.transform],
      ...(brick.groupId === undefined ? {} : { groupId: brick.groupId }),
    })),
    groups: [...doc.groups.values()].map((group) => ({
      id: group.id,
      name: group.name,
      ...(group.parentId === undefined ? {} : { parentId: group.parentId }),
    })),
    edges: [...doc.graph.edges.values()].map((edge) => ({
      a: edge.a,
      b: edge.b,
      mates: edge.mates,
    })),
  };
}

const fail = (message: string): never => {
  throw new Error(`serialize: ${message}`);
};

/**
 * Rebuild a document from its JSON form. Ids are validated rather than trusted —
 * an unchecked id reaching the connection graph corrupts connectivity silently, and
 * a saved file is external input like any other.
 */
export function fromJSON(input: unknown): SceneDocument {
  if (typeof input !== 'object' || input === null) fail('expected an object');
  const raw = input as Partial<SerializedDocument>;

  if (raw.version !== DOCUMENT_FORMAT_VERSION) {
    fail(`unsupported format version ${String(raw.version)}`);
  }
  if (!Array.isArray(raw.bricks) || !Array.isArray(raw.groups) || !Array.isArray(raw.edges)) {
    fail('missing bricks, groups or edges');
  }

  const bricks: BrickInstance[] = raw.bricks.map((brick) => {
    if (!Array.isArray(brick.transform) || brick.transform.length !== 16) {
      fail(`brick ${String(brick.id)} has no 16-element transform`);
    }
    if (typeof brick.partId !== 'string' || brick.partId === '') {
      fail(`brick ${String(brick.id)} has no part id`);
    }
    if (typeof brick.colorCode !== 'number' || !Number.isFinite(brick.colorCode)) {
      fail(`brick ${String(brick.id)} has no colour code`);
    }
    return {
      id: asBrickId(String(brick.id)),
      partId: brick.partId,
      colorCode: brick.colorCode,
      transform: brick.transform as Mat4,
      ...(brick.groupId === undefined ? {} : { groupId: asGroupId(String(brick.groupId)) }),
    };
  });

  const groups: GroupDef[] = raw.groups.map((group) => {
    if (typeof group.name !== 'string') fail(`group ${String(group.id)} has no name`);
    return {
      id: asGroupId(String(group.id)),
      name: group.name,
      ...(group.parentId === undefined ? {} : { parentId: asGroupId(String(group.parentId)) }),
    };
  });

  const known = new Set<BrickId>(bricks.map((b) => b.id));
  const edges: ConnectionEdge[] = raw.edges.map((edge) => {
    const a = asBrickId(String(edge.a));
    const b = asBrickId(String(edge.b));
    for (const id of [a, b]) {
      if (!known.has(id)) fail(`edge references unknown brick ${id}`);
    }
    return { id: edgeIdFor(a, b), a, b, mates: edge.mates ?? [] };
  });

  const groupIds = new Set<GroupId>(groups.map((g) => g.id));
  for (const brick of bricks) {
    if (brick.groupId !== undefined && !groupIds.has(brick.groupId)) {
      fail(`brick ${brick.id} references unknown group ${brick.groupId}`);
    }
  }

  return createDocument(bricks, groups, edges);
}

export const stringifyDocument = (doc: SceneDocument): string =>
  JSON.stringify(toJSON(doc), null, 2);

export const parseDocument = (text: string): SceneDocument => fromJSON(JSON.parse(text));

/**
 * LDraw writes at most six significant decimals and drops trailing zeros; matching
 * that keeps files diffable and readable in other tools.
 */
function num(value: number): string {
  if (!Number.isFinite(value)) throw new Error(`serialize: non-finite number in transform`);
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toFixed(6)));
}

/**
 * A type-1 line is `1 colour x y z a b c d e f g h i file`, where the letters are the
 * rotation in row-major order:
 *
 *     | a b c x |
 *     | d e f y |
 *     | g h i z |
 *
 * Our matrices are column-major, laid out like `THREE.Matrix4.elements`, so the row
 * the line wants is a stride-4 read.
 */
function referenceLine(brick: BrickInstance): string {
  const m = brick.transform;
  const cells = [
    m[12], m[13], m[14],
    m[0], m[4], m[8],
    m[1], m[5], m[9],
    m[2], m[6], m[10],
  ];
  return `1 ${brick.colorCode} ${cells.map(num).join(' ')} ${brick.partId}.dat`;
}

export interface LdrOptions {
  /** `0 FILE` name; also the model title. */
  name?: string;
  author?: string;
}

/**
 * Export to `.ldr`. Bricks are grouped by their group so members stay adjacent, with a
 * `0 // <group>` comment ahead of each run — the closest the format comes to holding
 * the grouping, and a comment rather than a claim of fidelity.
 */
export function toLdr(doc: SceneDocument, options: LdrOptions = {}): string {
  const name = options.name ?? 'BrickYard model';
  const lines: string[] = [`0 FILE ${name}`, `0 ${name}`, `0 Name: ${name}`];
  if (options.author !== undefined) lines.push(`0 Author: ${options.author}`);
  lines.push('0 BFC CERTIFY CCW', '');

  const ungrouped = [...doc.bricks.values()].filter((b) => b.groupId === undefined);
  for (const brick of ungrouped) lines.push(referenceLine(brick));

  for (const group of doc.groups.values()) {
    const members = [...doc.bricks.values()].filter((b) => b.groupId === group.id);
    if (members.length === 0) continue;
    lines.push('', `0 // ${group.name}`);
    for (const brick of members) lines.push(referenceLine(brick));
  }

  lines.push('', '0 STEP');
  return `${lines.join('\n')}\n`;
}
