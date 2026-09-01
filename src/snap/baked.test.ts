/**
 * Round-trips the baked formats through real resolved parts.
 *
 * The assertions are equality against what `resolvePart` and `buildOccupancy` produce
 * live, because that is the contract: a part read from the bake has to behave exactly
 * like one resolved from source, or snapping and collision quietly diverge depending on
 * which tier a part came from. Orientation is the one lossy field — quantised to int16
 * per component — so it is compared within a tolerance far below what matching resolves.
 */

import { describe, expect, it } from 'vitest';

import { boundsFromTriangles, partTriangles } from '../ldraw/bounds.ts';
import { fixtureReader } from './__fixtures__/reader.ts';
import {
  BAKED_FORMAT_VERSION,
  packConnections,
  packOccupancy,
  unpackConnections,
  unpackOccupancy,
  type BakedConnections,
  type BakedOccupancy,
} from './baked.ts';
import { buildOccupancy, OCC_CELL } from './collision.ts';
import { resolvePart } from './resolvePart.ts';
import type { ConnectionPoint } from './types.ts';

const PARTS = ['3001', '4070', '3700', '3818', '2335', '3937', '3947'] as const;

const bytesOf = (data: Uint8Array): ArrayBuffer =>
  data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;

async function resolveAll(): Promise<BakedConnections[]> {
  return Promise.all(
    PARTS.map(async (partId) => ({ partId, points: await resolvePart(partId, fixtureReader) })),
  );
}

async function occupancyAll(): Promise<BakedOccupancy[]> {
  return Promise.all(
    PARTS.map(async (partId) => {
      const triangles = await partTriangles(partId, fixtureReader);
      const bounds = boundsFromTriangles(triangles);
      return { partId, bounds, occupancy: buildOccupancy(triangles, bounds) };
    }),
  );
}

/** Every field except `orientation`, which is quantised and compared separately. */
function withoutOrientation(point: ConnectionPoint): Omit<ConnectionPoint, 'orientation'> {
  const { orientation: _orientation, ...rest } = point;
  return rest;
}

describe('connections.bin', () => {
  it('round-trips every field of every point', async () => {
    const parts = await resolveAll();
    const read = unpackConnections(bytesOf(packConnections(parts)));
    expect(read).not.toBeNull();

    for (const { partId, points } of parts) {
      const decoded = read?.get(partId);
      expect(decoded, partId).toBeDefined();
      expect(decoded?.length, partId).toBe(points.length);
      for (let i = 0; i < points.length; i++) {
        const source = points[i];
        const target = decoded?.[i] as ConnectionPoint;
        // Positions are float32; the source values are float64 but originate in
        // decimal part files, so a float32 round-trip is exact to within its precision.
        expect(withoutOrientation(target), `${partId} #${i}`).toEqual({
          ...withoutOrientation(source),
          position: source.position.map((v) => Math.fround(v)),
        });
        for (let a = 0; a < 9; a++) {
          expect(target.orientation[a], `${partId} #${i} basis[${a}]`).toBeCloseTo(
            source.orientation[a],
            4,
          );
        }
      }
    }
  });

  it('preserves handedness on a mirrored basis', () => {
    // A basis with one axis flipped: determinant -1, which no quaternion can carry.
    const mirrored: ConnectionPoint = {
      id: 'test#0',
      kind: 'cyl',
      gender: 'M',
      sections: [{ variant: 'R', radius: 6, length: 4 }],
      position: [1, 2, 3],
      orientation: [-1, 0, 0, 0, 1, 0, 0, 0, 1],
      slide: false,
      key: 1234,
      source: 'p/stud.dat',
    };
    const read = unpackConnections(bytesOf(packConnections([{ partId: 'x', points: [mirrored] }])));
    const decoded = read?.get('x')?.[0];
    for (let a = 0; a < 9; a++) {
      expect(decoded?.orientation[a], `basis[${a}]`).toBeCloseTo(mirrored.orientation[a], 4);
    }
  });

  it('rejects bytes it cannot read', () => {
    const packed = packConnections([]);
    expect(unpackConnections(bytesOf(packed.slice(0, 8)))).toBeNull();

    const wrongVersion = packConnections([]);
    new DataView(wrongVersion.buffer).setUint16(4, BAKED_FORMAT_VERSION + 1, true);
    expect(unpackConnections(bytesOf(wrongVersion))).toBeNull();

    expect(unpackConnections(new ArrayBuffer(4))).toBeNull();
  });
});

describe('occupancy.bin', () => {
  it('round-trips masks and bounds exactly', async () => {
    const parts = await occupancyAll();
    const read = unpackOccupancy(bytesOf(packOccupancy(parts)));
    expect(read).not.toBeNull();

    for (const { partId, bounds, occupancy } of parts) {
      const decoded = read?.get(partId);
      expect(decoded, partId).toBeDefined();
      expect([...(decoded?.occupancy.dims ?? [])], partId).toEqual([...occupancy.dims]);
      expect(decoded?.occupancy.bits, partId).toEqual(occupancy.bits);
      expect(decoded?.bounds.min.map(Math.fround), partId).toEqual(bounds.min.map(Math.fround));
      expect(decoded?.bounds.max.map(Math.fround), partId).toEqual(bounds.max.map(Math.fround));
    }
  });

  it('refuses a bake made at a different cell size', async () => {
    const packed = packOccupancy(await occupancyAll());
    new DataView(packed.buffer).setUint16(6, OCC_CELL * 2, true);
    expect(unpackOccupancy(bytesOf(packed))).toBeNull();
  });

  it('does not pin the source buffer', async () => {
    const parts = await occupancyAll();
    const read = unpackOccupancy(bytesOf(packOccupancy(parts)));
    const bits = read?.get('3001')?.occupancy.bits;
    expect(bits?.buffer.byteLength).toBe(bits?.byteLength);
  });
});
