/**
 * Identifier minting and validation.
 *
 * LDraw has no concept of a per-part identifier — a reference line carries a colour,
 * a transform, and a filename, and nothing else. A brick's only identity in the file
 * format is its position in a list. So ids are entirely ours, minted when a brick
 * enters the document, whether by placement or by import.
 *
 * Two consequences worth knowing. Operations carry whole `BrickInstance`s, so
 * remove-then-undo restores the *same* id. And export to `.ldr` drops ids because the
 * format cannot hold them, so a round trip through a file mints fresh ones — nothing
 * may assume an id survives being saved.
 */

import type { BrickId, EdgeId, GroupId } from '../types';

/** 64 characters, so each draws exactly 6 bits with no modulo bias. */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * 12 characters is 72 bits. Ids need only be unique within one document, and a large
 * published model is a few thousand bricks; at 100,000 the birthday bound puts a
 * collision near 1 in 10^12.
 *
 * Random rather than a counter because documents merge — pasting between models,
 * importing a second model, MCP inserting bricks. A counter collides on every merge
 * and needs a remapping pass; random ids simply concatenate.
 */
const ID_LENGTH = 12;

const PATTERN = /^[A-Za-z0-9_-]{12}$/;

function mint(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(ID_LENGTH));
  let out = '';
  for (const b of bytes) out += ALPHABET[b & 63];
  return out;
}

export const mintBrickId = (): BrickId => mint() as BrickId;
export const mintGroupId = (): GroupId => mint() as GroupId;

export const isValidId = (value: string): boolean => PATTERN.test(value);

/**
 * For ids arriving from outside — a loaded document, an MCP call. Throws rather than
 * coercing, because an unvalidated id reaching the connection graph corrupts
 * connectivity silently.
 */
export function asBrickId(value: string): BrickId {
  if (!isValidId(value)) throw new Error(`ids: not a valid brick id: ${JSON.stringify(value)}`);
  return value as BrickId;
}

export function asGroupId(value: string): GroupId {
  if (!isValidId(value)) throw new Error(`ids: not a valid group id: ${JSON.stringify(value)}`);
  return value as GroupId;
}

/**
 * Edge ids are derived from the unordered brick pair rather than minted, so the same
 * pair always yields the same id and add/remove/add is idempotent. The length prefix
 * makes the encoding reversible, and therefore injective: without it, the pairs
 * {'x', 'y-z'} and {'x-y', 'z'} would render identically.
 */
export function edgeIdFor(a: BrickId, b: BrickId): EdgeId {
  const [first, second] = a <= b ? [a, b] : [b, a];
  return `${first.length}~${first}~${second}` as EdgeId;
}
