/**
 * Binary formats for the baked connection and occupancy sets, and the readers that turn
 * them back into `ConnectionPoint`s and `OccupancyMask`s.
 *
 * Pack and unpack live together on purpose: the writer (`tools/prebake.ts`) and the
 * reader (the app, at load) have to agree byte for byte, and a format that is described
 * in one file cannot drift from itself. Both formats are little-endian.
 *
 * Two files, not one, because the sets differ: connections exist only for the parts the
 * shadow library annotates, while a mask is derivable for any part in the library. They
 * also go stale on different upstreams and carry different licences — see
 * `docs/PREBAKE.md`.
 *
 * Each header carries two independent version numbers: `BAKED_FORMAT_VERSION` says a reader
 * can find the bytes at all, `SEMANTICS_VERSION` says the bytes still mean what the reader
 * thinks they mean — see that constant's doc and `docs/PREBAKE.md`. Both readers treat a
 * mismatch on either exactly like a truncated file.
 *
 * Pure: no three.js, no DOM. Safe inside a worker, and directly runnable under Node so
 * the bake can use the same code the browser does.
 */

import type { Bounds, Vec3 } from '../types.ts';
import { OCC_CELL } from './collision.ts';
import type {
  ConnectionPoint,
  Gender,
  OccupancyMask,
  Section,
  SectionVariant,
  SnapKind,
} from './types.ts';

/** Bumped when either layout changes in a way a reader cannot detect on its own. */
export const BAKED_FORMAT_VERSION = 2;

/**
 * Bumped when what a packed field MEANS changes, independent of the byte layout: `packKey`'s
 * bit assignments (`src/snap/parseMeta.ts`), which section `matingSection` picks, connection
 * id composition, or what `buildOccupancy` counts as solid.
 *
 * `BAKED_FORMAT_VERSION` says a reader can find the bytes; this says the bytes still mean
 * what the reader thinks they mean. Both `connections.bin` and `occupancy.bin` are resolved
 * by the same corpus walk in `tools/prebake.ts`, so one version covers both — a change to
 * `matingSection` or to occupancy's fill rule invalidates the same committed bake either way.
 *
 * `readConnections`/`readOccupancy` reject a mismatch exactly like a truncated file: null,
 * not a throw, so the app falls back to resolving from source instead of trusting stale
 * semantics. Bumping this number, alone, changes no behaviour — it only stops an
 * old-semantics file from being accepted by a new-semantics reader. See
 * `src/snap/fixtureDigest.ts`, which is what makes forgetting the bump a failing test
 * instead of a silent miss, and `docs/PREBAKE.md`.
 */
export const SEMANTICS_VERSION = 1;

const CONNECTIONS_MAGIC = 0x4e43_5942; // 'BYCN', little-endian
const OCCUPANCY_MAGIC = 0x434f_5942; // 'BYOC'

const KINDS: readonly SnapKind[] = ['cyl', 'clip', 'finger', 'general'];
const VARIANTS: readonly SectionVariant[] = ['R', 'S', 'A'];

/** Flag bits packed beside the kind in one byte. */
const GENDER_FEMALE = 1 << 2;
const SLIDE = 1 << 3;
/** The orientation basis is left-handed — a mirrored part. See `quaternionOf`. */
const LEFT_HANDED = 1 << 4;

const NO_STRING = 0xffff_ffff;

// ---------------------------------------------------------------------------
// String table
// ---------------------------------------------------------------------------

/**
 * Every string in these files — part ids, connection ids, source paths, SNAP_GEN groups
 * — is written once into a shared table and referenced by index.
 *
 * Deduplication is the whole reason the point record can stay under 50 bytes. Connection
 * ids are `${source}#${ordinal}`, so `p/stud.dat#0` is the same string on thousands of
 * parts; storing the id verbatim rather than reconstructing it from parts keeps the
 * format free of assumptions about how `resolvePart` composes ids.
 */
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

/** Concatenates chunks into one buffer, padded to a 4-byte boundary. */
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
// Orientation: quaternion plus handedness
// ---------------------------------------------------------------------------

/**
 * The basis as a unit quaternion, with mirroring carried separately.
 *
 * Measured over the annotated corpus, every basis is orthonormal to about 1e-8 — but
 * 5.3% of points are left-handed, because a mirrored part reference flips one axis. A
 * quaternion cannot represent a reflection, so those bases are negated into a rotation
 * here and flipped back on read, with the `LEFT_HANDED` flag saying which. Dropping that
 * distinction would silently mirror every connector on every mirrored part.
 *
 * Components are quantised to int16 over [-1, 1]: about 3e-5 per component, an angular
 * error near 1e-4 radians. `mating.ts` matches axes to about two degrees and positions to
 * 0.6 LDU, so the quantisation is four orders of magnitude inside what matching cares
 * about.
 */
function quaternionOf(basis: readonly number[]): { q: [number, number, number, number]; mirrored: boolean } {
  const det =
    basis[0] * (basis[4] * basis[8] - basis[5] * basis[7]) -
    basis[3] * (basis[1] * basis[8] - basis[2] * basis[7]) +
    basis[6] * (basis[1] * basis[5] - basis[2] * basis[4]);
  const mirrored = det < 0;
  const s = mirrored ? -1 : 1;
  const m = basis.map((v) => v * s);

  // Shepperd's method: take the largest diagonal term so the divisor is never near zero.
  const [m00, m01, m02, m10, m11, m12, m20, m21, m22] = m;
  const trace = m00 + m11 + m22;
  let x: number, y: number, z: number, w: number;
  if (trace > 0) {
    const r = Math.sqrt(1 + trace) * 2;
    w = r / 4;
    x = (m12 - m21) / r;
    y = (m20 - m02) / r;
    z = (m01 - m10) / r;
  } else if (m00 > m11 && m00 > m22) {
    const r = Math.sqrt(1 + m00 - m11 - m22) * 2;
    w = (m12 - m21) / r;
    x = r / 4;
    y = (m10 + m01) / r;
    z = (m20 + m02) / r;
  } else if (m11 > m22) {
    const r = Math.sqrt(1 + m11 - m00 - m22) * 2;
    w = (m20 - m02) / r;
    x = (m10 + m01) / r;
    y = r / 4;
    z = (m21 + m12) / r;
  } else {
    const r = Math.sqrt(1 + m22 - m00 - m11) * 2;
    w = (m01 - m10) / r;
    x = (m20 + m02) / r;
    y = (m21 + m12) / r;
    z = r / 4;
  }
  const norm = Math.hypot(x, y, z, w) || 1;
  return { q: [x / norm, y / norm, z / norm, w / norm], mirrored };
}

/** Inverse of `quaternionOf`: a column-major basis, re-mirrored if it started that way. */
function basisOf(q: readonly [number, number, number, number], mirrored: boolean): number[] {
  const [x, y, z, w] = q;
  const basis = [
    1 - 2 * (y * y + z * z),
    2 * (x * y + z * w),
    2 * (x * z - y * w),
    2 * (x * y - z * w),
    1 - 2 * (x * x + z * z),
    2 * (y * z + x * w),
    2 * (x * z + y * w),
    2 * (y * z - x * w),
    1 - 2 * (x * x + y * y),
  ];
  return mirrored ? basis.map((v) => -v) : basis;
}

const toI16 = (v: number): number => Math.max(-32767, Math.min(32767, Math.round(v * 32767)));

// ---------------------------------------------------------------------------
// connections.bin
// ---------------------------------------------------------------------------

/** One part's resolved connection set, as the bake produces it. */
export interface BakedConnections {
  partId: string;
  points: readonly ConnectionPoint[];
}

/** Fixed part of a point record; sections follow, 12 bytes each. */
const POINT_BYTES = 40;
const SECTION_BYTES = 12;

/**
 * `connections.bin`:
 *
 * ```
 * magic u32 'BYCN' | version u16 | semantics u16 | partCount u32 | stringCount u32
 * string table:  [ length u16, utf8 bytes ] * stringCount, padded to 4
 * parts:         [ idIndex u32, pointCount u32, points... ]
 * point:         idIndex u32 | sourceIndex u32 | groupIndex u32 | key u32
 *                flags u8 | sectionCount u8 | reserved u16
 *                position f32 * 3 | quaternion i16 * 4
 *                sections: [ variant u8, reserved u8, reserved u16, radius f32, length f32 ]
 * ```
 */
export function packConnections(parts: readonly BakedConnections[]): Uint8Array {
  const table = new StringTable();
  let bodyBytes = 0;
  for (const part of parts) {
    table.intern(part.partId);
    bodyBytes += 8;
    for (const point of part.points) {
      table.intern(point.id);
      table.intern(point.source);
      if (point.group !== undefined) table.intern(point.group);
      bodyBytes += POINT_BYTES + point.sections.length * SECTION_BYTES;
    }
  }

  const strings = concat(table.encode());
  const out = new Uint8Array(16 + strings.length + bodyBytes);
  const view = new DataView(out.buffer);
  view.setUint32(0, CONNECTIONS_MAGIC, true);
  view.setUint16(4, BAKED_FORMAT_VERSION, true);
  view.setUint16(6, SEMANTICS_VERSION, true);
  view.setUint32(8, parts.length, true);
  view.setUint32(12, table.count, true);
  out.set(strings, 16);

  let at = 16 + strings.length;
  for (const part of parts) {
    view.setUint32(at, table.intern(part.partId), true);
    view.setUint32(at + 4, part.points.length, true);
    at += 8;
    for (const point of part.points) {
      const { q, mirrored } = quaternionOf(point.orientation);
      const flags =
        KINDS.indexOf(point.kind) |
        (point.gender === 'F' ? GENDER_FEMALE : 0) |
        (point.slide ? SLIDE : 0) |
        (mirrored ? LEFT_HANDED : 0);

      view.setUint32(at, table.intern(point.id), true);
      view.setUint32(at + 4, table.intern(point.source), true);
      view.setUint32(at + 8, point.group === undefined ? NO_STRING : table.intern(point.group), true);
      view.setUint32(at + 12, point.key, true);
      view.setUint8(at + 16, flags);
      view.setUint8(at + 17, point.sections.length);
      view.setUint16(at + 18, 0, true);
      for (let i = 0; i < 3; i++) view.setFloat32(at + 20 + i * 4, point.position[i], true);
      for (let i = 0; i < 4; i++) view.setInt16(at + 32 + i * 2, toI16(q[i]), true);
      at += POINT_BYTES;

      for (const section of point.sections) {
        view.setUint8(at, VARIANTS.indexOf(section.variant));
        view.setUint8(at + 1, 0);
        view.setUint16(at + 2, 0, true);
        view.setFloat32(at + 4, section.radius, true);
        view.setFloat32(at + 8, section.length, true);
        at += SECTION_BYTES;
      }
    }
  }
  return out;
}

/**
 * Reads `connections.bin`. Returns null when the bytes are not a readable version — either
 * `BAKED_FORMAT_VERSION` (the layout) or `SEMANTICS_VERSION` (what the fields mean) — the
 * same null path a truncated file takes, so a stale bake degrades to source resolution
 * instead of shipping wrong snapping behaviour.
 */
function readConnections(buffer: ArrayBuffer): Map<string, ConnectionPoint[]> | null {
  if (buffer.byteLength < 16) return null;
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== CONNECTIONS_MAGIC) return null;
  if (view.getUint16(4, true) !== BAKED_FORMAT_VERSION) return null;
  if (view.getUint16(6, true) !== SEMANTICS_VERSION) return null;

  const partCount = view.getUint32(8, true);
  const { strings, end } = readStringTable(view, 16, view.getUint32(12, true));
  const byId = new Map<string, ConnectionPoint[]>();

  let at = align4(end);
  for (let p = 0; p < partCount; p++) {
    const partId = strings[view.getUint32(at, true)];
    const pointCount = view.getUint32(at + 4, true);
    at += 8;
    const points: ConnectionPoint[] = [];
    for (let i = 0; i < pointCount; i++) {
      const base = at;
      const flags = view.getUint8(base + 16);
      const sectionCount = view.getUint8(base + 17);
      const groupIndex = view.getUint32(base + 8, true);
      const q: [number, number, number, number] = [
        view.getInt16(base + 32, true) / 32767,
        view.getInt16(base + 34, true) / 32767,
        view.getInt16(base + 36, true) / 32767,
        view.getInt16(base + 38, true) / 32767,
      ];
      at = base + POINT_BYTES;

      const sections: Section[] = [];
      for (let s = 0; s < sectionCount; s++) {
        sections.push({
          variant: VARIANTS[view.getUint8(at)],
          radius: view.getFloat32(at + 4, true),
          length: view.getFloat32(at + 8, true),
        });
        at += SECTION_BYTES;
      }

      points.push({
        id: strings[view.getUint32(base, true)],
        kind: KINDS[flags & 0b11],
        gender: (flags & GENDER_FEMALE) === 0 ? ('M' as Gender) : ('F' as Gender),
        sections,
        position: [
          view.getFloat32(base + 20, true),
          view.getFloat32(base + 24, true),
          view.getFloat32(base + 28, true),
        ] as unknown as Vec3,
        orientation: basisOf(q, (flags & LEFT_HANDED) !== 0) as ConnectionPoint['orientation'],
        slide: (flags & SLIDE) !== 0,
        ...(groupIndex === NO_STRING ? {} : { group: strings[groupIndex] }),
        key: view.getUint32(base + 12, true),
        source: strings[view.getUint32(base + 4, true)],
      });
    }
    byId.set(partId, points);
  }
  return byId;
}

// ---------------------------------------------------------------------------
// occupancy.bin
// ---------------------------------------------------------------------------

/** One part's collision data: the bounds the mask is expressed in, and the mask. */
export interface BakedOccupancy {
  partId: string;
  bounds: Bounds;
  occupancy: OccupancyMask;
}

/**
 * `occupancy.bin`:
 *
 * ```
 * magic u32 'BYOC' | version u16 | cellSize u16 | semantics u16 | reserved u16
 * partCount u32 | stringCount u32
 * string table:  [ length u16, utf8 bytes ] * stringCount, padded to 4
 * parts:         [ idIndex u32, dims u16 * 3, reserved u16,
 *                  min f32 * 3, max f32 * 3, maskBytes u32, mask..., padded to 4 ]
 * ```
 *
 * `cellSize` is written so a reader can reject a bake made at a different `OCC_CELL`
 * rather than misinterpret its grid; `semantics` is `SEMANTICS_VERSION`, so a reader can
 * likewise reject a bake whose fill rule it no longer shares — see that constant's doc.
 */
export function packOccupancy(parts: readonly BakedOccupancy[]): Uint8Array {
  const table = new StringTable();
  let bodyBytes = 0;
  for (const part of parts) {
    table.intern(part.partId);
    bodyBytes += 40 + align4(part.occupancy.bits.length);
  }

  const strings = concat(table.encode());
  const out = new Uint8Array(20 + strings.length + bodyBytes);
  const view = new DataView(out.buffer);
  view.setUint32(0, OCCUPANCY_MAGIC, true);
  view.setUint16(4, BAKED_FORMAT_VERSION, true);
  view.setUint16(6, OCC_CELL, true);
  view.setUint16(8, SEMANTICS_VERSION, true);
  view.setUint16(10, 0, true);
  view.setUint32(12, parts.length, true);
  view.setUint32(16, table.count, true);
  out.set(strings, 20);

  let at = 20 + strings.length;
  for (const part of parts) {
    view.setUint32(at, table.intern(part.partId), true);
    for (let i = 0; i < 3; i++) view.setUint16(at + 4 + i * 2, part.occupancy.dims[i], true);
    view.setUint16(at + 10, 0, true);
    for (let i = 0; i < 3; i++) view.setFloat32(at + 12 + i * 4, part.bounds.min[i], true);
    for (let i = 0; i < 3; i++) view.setFloat32(at + 24 + i * 4, part.bounds.max[i], true);
    view.setUint32(at + 36, part.occupancy.bits.length, true);
    out.set(part.occupancy.bits, at + 40);
    at += 40 + align4(part.occupancy.bits.length);
  }
  return out;
}

/**
 * Reads `occupancy.bin`. Returns null when the bytes are not a readable version, were baked
 * at a different cell size than this build voxelises at, or carry a fill-rule semantics this
 * build no longer shares — see `SEMANTICS_VERSION`.
 */
function readOccupancy(
  buffer: ArrayBuffer,
): Map<string, { bounds: Bounds; occupancy: OccupancyMask }> | null {
  if (buffer.byteLength < 20) return null;
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== OCCUPANCY_MAGIC) return null;
  if (view.getUint16(4, true) !== BAKED_FORMAT_VERSION) return null;
  if (view.getUint16(6, true) !== OCC_CELL) return null;
  if (view.getUint16(8, true) !== SEMANTICS_VERSION) return null;

  const partCount = view.getUint32(12, true);
  const { strings, end } = readStringTable(view, 20, view.getUint32(16, true));
  const byId = new Map<string, { bounds: Bounds; occupancy: OccupancyMask }>();

  let at = align4(end);
  for (let p = 0; p < partCount; p++) {
    const partId = strings[view.getUint32(at, true)];
    const dims = [
      view.getUint16(at + 4, true),
      view.getUint16(at + 6, true),
      view.getUint16(at + 8, true),
    ] as unknown as OccupancyMask['dims'];
    const min = [
      view.getFloat32(at + 12, true),
      view.getFloat32(at + 16, true),
      view.getFloat32(at + 20, true),
    ] as unknown as Vec3;
    const max = [
      view.getFloat32(at + 24, true),
      view.getFloat32(at + 28, true),
      view.getFloat32(at + 32, true),
    ] as unknown as Vec3;
    const maskBytes = view.getUint32(at + 36, true);
    // Copied rather than viewed: a subarray would pin the whole file in memory for as
    // long as any one part's mask is alive.
    const bits = new Uint8Array(buffer.slice(at + 40, at + 40 + maskBytes));
    byId.set(partId, { bounds: { min, max }, occupancy: { dims, bits } });
    at += 40 + align4(maskBytes);
  }
  return byId;
}

// ---------------------------------------------------------------------------
// Reading bytes that may not be whole
// ---------------------------------------------------------------------------

/**
 * A header can be valid while the body is short — a truncated download, a proxy that cut
 * the response, a deploy that copied half a file. Both readers walk offsets the header
 * declares, so short bytes surface as a `RangeError` from `DataView` or a typed array
 * constructor rather than as a clean null.
 *
 * Callers read null as "no bake, resolve from source", which is slower and correct. An
 * exception is neither: it rejects the shared load promise in `src/scene/bakedParts.ts`,
 * so one truncated file fails every part in the session rather than the parts that file
 * covered. These wrappers are what make the documented fallback true.
 */
export function unpackConnections(buffer: ArrayBuffer): Map<string, ConnectionPoint[]> | null {
  try {
    return readConnections(buffer);
  } catch {
    return null;
  }
}

export function unpackOccupancy(
  buffer: ArrayBuffer,
): Map<string, { bounds: Bounds; occupancy: OccupancyMask }> | null {
  try {
    return readOccupancy(buffer);
  } catch {
    return null;
  }
}
