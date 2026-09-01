/**
 * The part source, over the captured corpus rather than the network.
 *
 * `createPartSource` is what the bridge hands the session, so what matters is that it
 * composes a complete `PartDef` — connections, bounds and occupancy — and that a failed
 * part does not poison the cache for the rest of the process.
 */

import { describe, expect, it, vi } from 'vitest';

import { fixtureReader } from '../../snap/__fixtures__/reader.ts';
import type { ReadFile } from '../../snap/resolvePart.ts';
import { createHttpReader } from '../../ldraw/httpReader.ts';
import { createPartSource } from './parts.ts';

describe('createPartSource', () => {
  it('composes a complete part definition', async () => {
    const part = await createPartSource(fixtureReader, { titles: { '3001': 'Brick 2 x 4' } })('3001');

    expect(part.title).toBe('Brick 2 x 4');
    expect(part.connections.length).toBeGreaterThan(0);
    expect(part.occupancy.bits.length).toBeGreaterThan(0);
    expect(part.bounds.max[0]).toBeGreaterThan(part.bounds.min[0]);
  });

  it('falls back to the part number when no title is known', async () => {
    expect((await createPartSource(fixtureReader)('3001')).title).toBe('3001');
  });

  it('resolves each part once, however often it is asked for', async () => {
    const read = vi.fn(fixtureReader);
    const source = createPartSource(read);

    await Promise.all([source('3001'), source('3001'), source('3001')]);
    const afterFirst = read.mock.calls.length;
    await source('3001');

    expect(read.mock.calls.length).toBe(afterFirst);
  });

  it('reports a part with no geometry rather than returning an empty one', async () => {
    await expect(createPartSource(fixtureReader)('not-a-part')).rejects.toThrow(/no geometry/);
  });

  it('lets a later call retry after a failure, rather than caching the error', async () => {
    let fail = true;
    const flaky: ReadFile = async (p) => {
      if (fail) throw new Error('network down');
      return fixtureReader(p);
    };
    const source = createPartSource(flaky);

    await expect(source('3001')).rejects.toThrow(/could not be read: network down/);
    fail = false;
    await expect(source('3001')).resolves.toMatchObject({ id: '3001' });
  });
});

describe('createHttpReader', () => {
  it('routes shadow and library paths to their own upstreams', async () => {
    const fetched: string[] = [];
    const fetchSpy = vi.fn(async (url: string) => {
      fetched.push(url);
      return new Response('0 stub', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchSpy);

    const read = createHttpReader({ ldrawBase: 'https://ldraw/', shadowBase: 'https://shadow/' });
    await read('ldraw/parts/3001.dat');
    await read('shadow/parts/3001.dat');

    expect(fetched).toEqual(['https://ldraw/parts/3001.dat', 'https://shadow/parts/3001.dat']);
    vi.unstubAllGlobals();
  });

  it('treats a 404 as a real answer and caches it', async () => {
    const fetchSpy = vi.fn(async () => new Response('', { status: 404 }));
    vi.stubGlobal('fetch', fetchSpy);

    const read = createHttpReader();
    expect(await read('ldraw/parts/nope.dat')).toBeNull();
    expect(await read('ldraw/parts/nope.dat')).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    vi.unstubAllGlobals();
  });

  it('does not cache a dropped connection', async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error('connection reset');
    });
    vi.stubGlobal('fetch', fetchSpy);

    const read = createHttpReader();
    await expect(read('ldraw/parts/3001.dat')).rejects.toThrow(/connection reset/);
    await expect(read('ldraw/parts/3001.dat')).rejects.toThrow(/connection reset/);
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    vi.unstubAllGlobals();
  });
});
