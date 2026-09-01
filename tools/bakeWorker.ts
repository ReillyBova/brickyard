/**
 * One bake worker: resolves parts to connection points and an occupancy mask.
 *
 * Runs under `node:worker_threads`, driven by `tools/prebake.ts`. The parent hands out
 * one part at a time rather than a fixed slice, because per-part cost spans three orders
 * of magnitude — a 1x1 plate against a 32x32 baseplate — and a static split leaves most
 * of the machine idle waiting for whichever worker drew the baseplates.
 *
 * Masks are transferred, not copied: they are the bulk of what crosses the boundary.
 */

import { parentPort, workerData } from 'node:worker_threads'

import { boundsFromTriangles, partTriangles } from '../src/ldraw/bounds.ts'
import { createLibraryReader, createShadowReader } from '../src/ldraw/mirror.ts'
import { buildOccupancy } from '../src/snap/collision.ts'
import { resolvePart, type ReadFile } from '../src/snap/resolvePart.ts'
import type { Bounds } from '../src/types.ts'
import type { ConnectionPoint } from '../src/snap/types.ts'

export interface BakeRequest {
  partId: string
}

export type BakeResult =
  | {
      ok: true
      partId: string
      points: ConnectionPoint[]
      bounds: Bounds
      dims: [number, number, number]
      bits: Uint8Array
      milliseconds: number
    }
  | { ok: false; partId: string; milliseconds: number }

const { mirror } = workerData as { mirror: string }
const readLibrary = createLibraryReader(mirror)
const readShadow = createShadowReader(mirror)

/** The same namespacing adapter `prebake.ts` uses; see the note there. */
const read: ReadFile = (relativePath) =>
  relativePath.startsWith('shadow/')
    ? readShadow(relativePath.slice('shadow/'.length))
    : readLibrary(relativePath.replace(/^ldraw\//, ''))

parentPort?.on('message', (request: BakeRequest | null) => {
  if (request === null) {
    parentPort?.close()
    return
  }
  const started = Date.now()
  void (async () => {
    try {
      const [points, triangles] = await Promise.all([
        resolvePart(request.partId, read),
        partTriangles(request.partId, read),
      ])
      if (triangles.length === 0) {
        parentPort?.postMessage({ ok: false, partId: request.partId, milliseconds: Date.now() - started })
        return
      }
      const bounds = boundsFromTriangles(triangles)
      const mask = buildOccupancy(triangles, bounds, points)
      const result: BakeResult = {
        ok: true,
        partId: request.partId,
        points,
        bounds,
        dims: [...mask.dims] as [number, number, number],
        bits: mask.bits,
        milliseconds: Date.now() - started,
      }
      parentPort?.postMessage(result, [mask.bits.buffer as ArrayBuffer])
    } catch {
      parentPort?.postMessage({ ok: false, partId: request.partId, milliseconds: Date.now() - started })
    }
  })()
})
