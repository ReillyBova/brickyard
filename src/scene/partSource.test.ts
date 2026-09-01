import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PartGeometry } from '../ldraw/types.ts';
import { packGeometry } from '../ldraw/geometryBaked.ts';
import type { BakedParts } from './bakedParts.ts';
import { BakedPartSource, type LoadedPart, type PartGeometrySource } from './partSource.ts';

const BAKED_3001: PartGeometry = {
  partId: '3001',
  positions: new Float32Array([0, 0, 0, 20, 0, 0, 0, 24, 0]),
  normals: new Float32Array([0, -1, 0, 0, -1, 0, 0, -1, 0]),
  indices: new Uint32Array([0, 1, 2]),
  bounds: { min: [0, 0, 0], max: [20, 24, 0] },
};

function bakedPartsOf(geometry: PartGeometry): Promise<BakedParts> {
  return Promise.resolve({
    connections: new Map(),
    occupancy: new Map(),
    geometry: new Map([[geometry.partId, geometry]]),
  });
}

describe('BakedPartSource', () => {
  it('answers a chest part from the bake, never touching the fallback', async () => {
    const fallback: PartGeometrySource = { load: vi.fn() };
    const source = new BakedPartSource(fallback, bakedPartsOf(BAKED_3001));

    const loaded = await source.load('3001');

    expect(fallback.load).not.toHaveBeenCalled();
    expect(loaded.partId).toBe('3001');
    expect(loaded.bounds).toEqual(BAKED_3001.bounds);
    expect(Array.from(loaded.geometry.getAttribute('position').array)).toEqual(
      Array.from(BAKED_3001.positions),
    );
    expect(Array.from(loaded.geometry.getIndex()?.array ?? [])).toEqual(
      Array.from(BAKED_3001.indices),
    );
  });

  it('falls through to the fallback source for a part outside the chest', async () => {
    const fallbackResult: LoadedPart = {
      partId: '9999',
      geometry: new THREE.BufferGeometry(),
      bounds: { min: [0, 0, 0], max: [1, 1, 1] },
    };
    const fallback: PartGeometrySource = { load: vi.fn().mockResolvedValue(fallbackResult) };
    const source = new BakedPartSource(fallback, bakedPartsOf(BAKED_3001));

    const loaded = await source.load('9999');

    expect(fallback.load).toHaveBeenCalledWith('9999');
    expect(loaded).toBe(fallbackResult);
  });
});

describe('BakedPartSource, hosted tier', () => {
  const HOSTED_3020: PartGeometry = {
    partId: '3020',
    positions: new Float32Array([0, 0, 0, 40, 0, 0, 0, 8, 0]),
    normals: new Float32Array([0, -1, 0, 0, -1, 0, 0, -1, 0]),
    indices: new Uint32Array([0, 1, 2]),
    bounds: { min: [0, 0, 0], max: [40, 8, 0] },
  };

  const bytesOf = (data: Uint8Array): ArrayBuffer =>
    data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;

  const failingFallback = (): PartGeometrySource => ({
    load: vi.fn(async () => {
      throw new Error('fell through to upstream when a tier above should have answered');
    }),
  });

  const upstream = (): { source: PartGeometrySource; result: LoadedPart } => {
    const result: LoadedPart = {
      partId: '3020',
      geometry: new THREE.BufferGeometry(),
      bounds: { min: [0, 0, 0], max: [1, 1, 1] },
    };
    return { source: { load: vi.fn(async () => result) }, result };
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('serves a hosted part from our own origin instead of walking upstream', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        expect(url).toBe('/base/baked/geometry/3020.bin');
        return { ok: true, arrayBuffer: async () => bytesOf(packGeometry([HOSTED_3020])) };
      }),
    );
    const source = new BakedPartSource(failingFallback(), bakedPartsOf(BAKED_3001), '/base/');

    const loaded = await source.load('3020');

    expect(loaded.partId).toBe('3020');
    expect(loaded.bounds).toEqual(HOSTED_3020.bounds);
  });

  it('fetches a hosted part once, however many times it is placed', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => bytesOf(packGeometry([HOSTED_3020])),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const source = new BakedPartSource(failingFallback(), bakedPartsOf(BAKED_3001), '/base/');

    await Promise.all([source.load('3020'), source.load('3020')]);
    await source.load('3020');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls through to upstream when no hosted file exists', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, arrayBuffer: async () => new ArrayBuffer(0) })));
    const { source: fallback, result } = upstream();
    const source = new BakedPartSource(fallback, bakedPartsOf(BAKED_3001), '/base/');

    expect(await source.load('3020')).toBe(result);
  });

  it('falls through to upstream when a hosted file is truncated', async () => {
    // Half a file reads as a miss, not a failure: the tier below still has the part.
    const whole = new Uint8Array(bytesOf(packGeometry([HOSTED_3020])));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, arrayBuffer: async () => bytesOf(whole.slice(0, 24)) })),
    );
    const { source: fallback, result } = upstream();
    const source = new BakedPartSource(fallback, bakedPartsOf(BAKED_3001), '/base/');

    expect(await source.load('3020')).toBe(result);
  });

  it('falls through to upstream when the origin is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network down'); }));
    const { source: fallback, result } = upstream();
    const source = new BakedPartSource(fallback, bakedPartsOf(BAKED_3001), '/base/');

    expect(await source.load('3020')).toBe(result);
  });
});
