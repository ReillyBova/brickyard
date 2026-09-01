import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

import type { PartGeometry } from '../ldraw/types.ts';
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
