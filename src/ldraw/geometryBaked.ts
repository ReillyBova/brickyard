/**
 * Binary format for `geometry.bin`, the bundled chest tier — flattened, deduplicated
 * position/normal/index buffers for the curated chest parts. See `docs/PREBAKE.md`.
 *
 * Pack and unpack live together on purpose, same reasoning as `src/snap/baked.ts`: the
 * writer (`tools/bakeGeometry.ts`) and the reader (`src/scene/bakedParts.ts`) have to
 * agree byte for byte. Little-endian throughout.
 *
 * Pure: no three.js, no DOM. `PartGeometry` is a plain bag of typed arrays (see
 * `./types.ts`), so nothing about reading or writing it needs a renderer — only the bake,
 * which produces those arrays in the first place, touches three.js, and only under Node.
 */

import type { PartGeometry } from './types.ts';

/** Bumped when the layout changes in a way a reader cannot detect on its own. */
export const GEOMETRY_FORMAT_VERSION = 1;

const GEOMETRY_MAGIC = 0x4547_5942; // 'BYGE', little-endian

/** Flag bits packed beside the counts in one part record. */
const HAS_COLOR_CODES = 1 << 0;

/** Fixed part of a geometry record; typed array payloads follow it. */
const RECORD_BYTES = 40;

// ---------------------------------------------------------------------------
// String table — identical scheme to src/snap/baked.ts, duplicated rather than shared:
// ldraw/ does not depend on snap/ (see docs/ARCHITECTURE.md's module diagram), even
// though the shapes are identical.
// ---------------------------------------------------------------------------

class StringTable {
  private readonly indices = new Map<string, number>();
  private readonly strings: string[] = [];

  intern(value: string): number {
    const existing = this.indices.get(value);
    if (existing !== undefined) return existing;
    const index = this.strings.length;
    this.indices.set(value, index);
    this.strings.push(value);
    return index;
  }

  encode(): Uint8Array[] {
    const encoder = new TextEncoder();
    const parts: Uint8Array[] = [];
    for (const value of this.strings) {
      const bytes = encoder.encode(value);
      const header = new Uint8Array(2);
      new DataView(header.buffer).setUint16(0, bytes.length, true);
      parts.push(header, bytes);
    }
    return parts;
  }

  get count(): number {
    return this.strings.length;
  }
}

function readStringTable(view: DataView, offset: number, count: number): { strings: string[]; end: number } {
  const decoder = new TextDecoder();
  const strings: string[] = [];
  let at = offset;
  for (let i = 0; i < count; i++) {
    const length = view.getUint16(at, true);
    at += 2;
    strings.push(decoder.decode(new Uint8Array(view.buffer, view.byteOffset + at, length)));
    at += length;
  }
  return { strings, end: at };
}

const align4 = (n: number): number => (n + 3) & ~3;

function concat(chunks: readonly Uint8Array[]): Uint8Array {
  const length = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(align4(length));
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

// ---------------------------------------------------------------------------
// geometry.bin
// ---------------------------------------------------------------------------

/**
 * `geometry.bin`:
 *
 * ```
 * magic u32 'BYGE' | version u16 | reserved u16 | partCount u32 | stringCount u32
 * string table:  [ length u16, utf8 bytes ] * stringCount, padded to 4
 * parts:         [ idIndex u32, vertexCount u32, indexCount u32,
 *                   flags u8, reserved u8 * 3,
 *                   boundsMin f32 * 3, boundsMax f32 * 3,
 *                   positions f32 * vertexCount * 3,
 *                   normals   f32 * vertexCount * 3,
 *                   indices   u32 * indexCount,
 *                   colorCodes u16 * vertexCount  (only when flags & HAS_COLOR_CODES) ]
 * ```
 *
 * One record per chest part, no cross-part deduplication — the chest is small (about
 * twenty parts today) and geometry rarely repeats across distinct part ids, so a shared
 * vertex pool would add bookkeeping for no measurable win.
 */
export function packGeometry(parts: readonly PartGeometry[]): Uint8Array {
  const table = new StringTable();
  let bodyBytes = 0;
  for (const part of parts) {
    table.intern(part.partId);
    const vertexCount = part.positions.length / 3;
    bodyBytes +=
      RECORD_BYTES +
      part.positions.byteLength +
      part.normals.byteLength +
      part.indices.length * 4 +
      (part.colorCodes === undefined ? 0 : vertexCount * 2);
  }

  const strings = concat(table.encode());
  const out = new Uint8Array(16 + strings.length + bodyBytes);
  const view = new DataView(out.buffer);
  view.setUint32(0, GEOMETRY_MAGIC, true);
  view.setUint16(4, GEOMETRY_FORMAT_VERSION, true);
  view.setUint16(6, 0, true);
  view.setUint32(8, parts.length, true);
  view.setUint32(12, table.count, true);
  out.set(strings, 16);

  let at = 16 + strings.length;
  for (const part of parts) {
    const vertexCount = part.positions.length / 3;
    const indexCount = part.indices.length;
    const flags = part.colorCodes === undefined ? 0 : HAS_COLOR_CODES;

    view.setUint32(at, table.intern(part.partId), true);
    view.setUint32(at + 4, vertexCount, true);
    view.setUint32(at + 8, indexCount, true);
    view.setUint8(at + 12, flags);
    view.setUint8(at + 13, 0);
    view.setUint16(at + 14, 0, true);
    for (let i = 0; i < 3; i++) view.setFloat32(at + 16 + i * 4, part.bounds.min[i], true);
    for (let i = 0; i < 3; i++) view.setFloat32(at + 28 + i * 4, part.bounds.max[i], true);
    at += RECORD_BYTES;

    for (let i = 0; i < part.positions.length; i++, at += 4) view.setFloat32(at, part.positions[i], true);
    for (let i = 0; i < part.normals.length; i++, at += 4) view.setFloat32(at, part.normals[i], true);
    for (let i = 0; i < part.indices.length; i++, at += 4) view.setUint32(at, part.indices[i], true);
    if (part.colorCodes !== undefined) {
      for (let i = 0; i < part.colorCodes.length; i++, at += 2) view.setUint16(at, part.colorCodes[i], true);
    }
  }
  return out;
}

/** Reads `geometry.bin`. Returns null when the bytes are not a readable version. */
export function unpackGeometry(buffer: ArrayBuffer): Map<string, PartGeometry> | null {
  if (buffer.byteLength < 16) return null;
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== GEOMETRY_MAGIC) return null;
  if (view.getUint16(4, true) !== GEOMETRY_FORMAT_VERSION) return null;

  const partCount = view.getUint32(8, true);
  const { strings, end } = readStringTable(view, 16, view.getUint32(12, true));
  const byId = new Map<string, PartGeometry>();

  let at = align4(end);
  for (let p = 0; p < partCount; p++) {
    const partId = strings[view.getUint32(at, true)];
    const vertexCount = view.getUint32(at + 4, true);
    const indexCount = view.getUint32(at + 8, true);
    const flags = view.getUint8(at + 12);
    const min = [
      view.getFloat32(at + 16, true),
      view.getFloat32(at + 20, true),
      view.getFloat32(at + 24, true),
    ] as unknown as PartGeometry['bounds']['min'];
    const max = [
      view.getFloat32(at + 28, true),
      view.getFloat32(at + 32, true),
      view.getFloat32(at + 36, true),
    ] as unknown as PartGeometry['bounds']['max'];
    at += RECORD_BYTES;

    const positions = new Float32Array(vertexCount * 3);
    for (let i = 0; i < positions.length; i++, at += 4) positions[i] = view.getFloat32(at, true);
    const normals = new Float32Array(vertexCount * 3);
    for (let i = 0; i < normals.length; i++, at += 4) normals[i] = view.getFloat32(at, true);
    const indices = new Uint32Array(indexCount);
    for (let i = 0; i < indices.length; i++, at += 4) indices[i] = view.getUint32(at, true);

    let colorCodes: Uint16Array | undefined;
    if ((flags & HAS_COLOR_CODES) !== 0) {
      colorCodes = new Uint16Array(vertexCount);
      for (let i = 0; i < colorCodes.length; i++, at += 2) colorCodes[i] = view.getUint16(at, true);
    }

    byId.set(partId, { partId, positions, normals, indices, bounds: { min, max }, ...(colorCodes ? { colorCodes } : {}) });
  }
  return byId;
}
