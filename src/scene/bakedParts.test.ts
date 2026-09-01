/**
 * `loadBakedParts` fetches three optional files and decodes what's there, so the
 * interesting behaviour is entirely about which subset showed up — this mocks `fetch`
 * rather than touching the real `public/baked/` output (present only after `npm run
 * prebake`, deliberately gitignored).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { packGeometry } from '../ldraw/geometryBaked.ts';
import type { PartGeometry } from '../ldraw/types.ts';
import { loadBakedParts, resetBakedParts } from './bakedParts.ts';

const GEOMETRY: PartGeometry = {
  partId: '3001',
  positions: new Float32Array([0, 0, 0, 20, 0, 0, 0, 24, 0]),
  normals: new Float32Array([0, -1, 0, 0, -1, 0, 0, -1, 0]),
  indices: new Uint32Array([0, 1, 2]),
  bounds: { min: [0, 0, 0], max: [20, 24, 0] },
};

function bytesOf(data: Uint8Array): ArrayBuffer {
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}

function mockFetch(available: ReadonlySet<string>): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.endsWith('geometry.bin') && available.has('geometry')) {
        return { ok: true, arrayBuffer: async () => bytesOf(packGeometry([GEOMETRY])) };
      }
      return { ok: false, arrayBuffer: async () => new ArrayBuffer(0) };
    }),
  );
}

beforeEach(() => {
  resetBakedParts();
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetBakedParts();
});

describe('loadBakedParts', () => {
  it('decodes geometry.bin when present', async () => {
    mockFetch(new Set(['geometry']));
    const baked = await loadBakedParts('/base/');
    expect(baked.geometry.get('3001')?.partId).toBe('3001');
    expect(Array.from(baked.geometry.get('3001')?.positions ?? [])).toEqual(
      Array.from(GEOMETRY.positions),
    );
  });

  it('comes back with empty maps, not an error, when nothing is served', async () => {
    mockFetch(new Set());
    const baked = await loadBakedParts('/base/');
    expect(baked.connections.size).toBe(0);
    expect(baked.occupancy.size).toBe(0);
    expect(baked.geometry.size).toBe(0);
  });

  it('degrades to empty maps when a served file is truncated', async () => {
    // A half-written file is the realistic corruption: the header reads fine and the body
    // stops early. If a reader throws on that, it rejects the promise every caller shares,
    // so one truncated file fails every part in the session — including the parts that
    // file never covered, which would otherwise have resolved from source.
    const whole = new Uint8Array(bytesOf(packGeometry([GEOMETRY])));
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.endsWith('geometry.bin')
          ? { ok: true, arrayBuffer: async () => bytesOf(whole.slice(0, 24)) }
          : { ok: false, arrayBuffer: async () => new ArrayBuffer(0) },
      ),
    );
    const baked = await loadBakedParts('/base/');
    expect(baked.geometry.size).toBe(0);
    expect(baked.connections.size).toBe(0);
    expect(baked.occupancy.size).toBe(0);
  });

  it('caches the result across calls until reset', async () => {
    mockFetch(new Set(['geometry']));
    const first = await loadBakedParts('/base/');
    const second = await loadBakedParts('/base/');
    expect(second).toBe(first);
  });
});
