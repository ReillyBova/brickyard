/**
 * Round-trips `geometry.bin` through synthetic `PartGeometry` values.
 *
 * Unlike `src/snap/baked.test.ts`, this isn't fixture-backed against real resolved
 * parts: `geometry.bin` is produced by `tools/bakeGeometry.ts`, which runs three.js's
 * `LDrawLoader` under Node and isn't something a `src/**` unit test can invoke (it isn't
 * pure — no three.js, no DOM per `CLAUDE.md` — and vitest only collects `src/**`). What
 * this format needs to prove is the same thing `baked.ts`'s tests prove for connections
 * and occupancy: that packing and unpacking are inverses, byte for byte, for shapes a
 * real part can produce — a handful of triangles, an odd vertex count, an optional
 * `colorCodes` array, and the it's-actually-typed-arrays plumbing through `bakedParts.ts`.
 * Small hand-built geometry says that as directly as a real part would, without needing
 * the mirror on disk.
 */

import { describe, expect, it } from 'vitest';

import {
  GEOMETRY_FORMAT_VERSION,
  GEOMETRY_SEMANTICS_VERSION,
  packGeometry,
  unpackGeometry,
} from './geometryBaked.ts';
import type { PartGeometry } from './types.ts';

const bytesOf = (data: Uint8Array): ArrayBuffer =>
  data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;

/** A single triangle — three unique vertices, one index run, odd vertex count. */
const TRIANGLE: PartGeometry = {
  partId: '3001',
  positions: new Float32Array([0, 0, 0, 20, 0, 0, 0, 24, 0]),
  normals: new Float32Array([0, -1, 0, 0, -1, 0, 0, -1, 0]),
  indices: new Uint32Array([0, 1, 2]),
  bounds: { min: [0, 0, 0], max: [20, 24, 0] },
};

/** A degenerate "quad" (two triangles sharing an edge) with hardcoded per-vertex colour. */
const COLORED_QUAD: PartGeometry = {
  partId: '3062b',
  positions: new Float32Array([0, 0, 0, 10, 0, 0, 10, 10, 0, 0, 10, 0]),
  normals: new Float32Array([0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0]),
  indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
  colorCodes: new Uint16Array([16, 16, 71, 71]),
  bounds: { min: [0, 0, 0], max: [10, 10, 0] },
};

describe('geometry.bin', () => {
  it('returns null for a valid header over a short body', () => {
    // The header reads clean and the declared offsets run past the end — a truncated
    // download, or a deploy that copied half the file. Null means "no bake, resolve from
    // source"; a throw would reject the load promise every part in the session shares.
    const packed = packGeometry([TRIANGLE, COLORED_QUAD]);
    expect(unpackGeometry(bytesOf(packed.slice(0, 24)))).toBeNull();
  });

  it('round-trips positions, normals, indices and bounds', () => {
    const packed = packGeometry([TRIANGLE]);
    const read = unpackGeometry(bytesOf(packed));
    expect(read).not.toBeNull();

    const decoded = read?.get('3001');
    expect(decoded).toBeDefined();
    expect(decoded?.partId).toBe('3001');
    expect(Array.from(decoded?.positions ?? [])).toEqual(Array.from(TRIANGLE.positions));
    expect(Array.from(decoded?.normals ?? [])).toEqual(Array.from(TRIANGLE.normals));
    expect(Array.from(decoded?.indices ?? [])).toEqual(Array.from(TRIANGLE.indices));
    expect(decoded?.bounds).toEqual(TRIANGLE.bounds);
    expect(decoded?.colorCodes).toBeUndefined();
  });

  it('round-trips colorCodes when present, and omits it when absent', () => {
    const packed = packGeometry([TRIANGLE, COLORED_QUAD]);
    const read = unpackGeometry(bytesOf(packed));

    expect(read?.get('3001')?.colorCodes).toBeUndefined();
    const quad = read?.get('3062b');
    expect(Array.from(quad?.colorCodes ?? [])).toEqual(Array.from(COLORED_QUAD.colorCodes ?? []));
  });

  it('preserves multiple parts independently', () => {
    const read = unpackGeometry(bytesOf(packGeometry([TRIANGLE, COLORED_QUAD])));
    expect([...(read?.keys() ?? [])].sort()).toEqual(['3001', '3062b']);
  });

  it('returns null for bytes that are not geometry.bin', () => {
    expect(unpackGeometry(new ArrayBuffer(4))).toBeNull();
    expect(unpackGeometry(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer)).toBeNull();
  });

  it('returns null for a future format version this build cannot read', () => {
    const packed = packGeometry([TRIANGLE]);
    const view = new DataView(bytesOf(packed));
    view.setUint16(4, GEOMETRY_FORMAT_VERSION + 1, true);
    expect(unpackGeometry(view.buffer)).toBeNull();
  });

  it('returns null for a semantics version this build no longer shares', () => {
    // Layout is unaffected — the reserved header field just now carries a meaning. A file
    // baked before this field existed reads as semantics 0, which never matches.
    const packed = packGeometry([TRIANGLE]);
    const view = new DataView(bytesOf(packed));
    view.setUint16(6, GEOMETRY_SEMANTICS_VERSION + 1, true);
    expect(unpackGeometry(view.buffer)).toBeNull();
  });

  it('round-trips an empty chest', () => {
    const read = unpackGeometry(bytesOf(packGeometry([])));
    expect(read).not.toBeNull();
    expect(read?.size).toBe(0);
  });
});
