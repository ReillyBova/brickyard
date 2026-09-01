/**
 * Flattens chest-part geometry for `geometry.bin`, using three.js's own `LDrawLoader`
 * under Node rather than reimplementing BFC winding and normal smoothing.
 *
 * ## Why the real loader, not a from-scratch triangle walk
 *
 * `partTriangles` (`src/ldraw/bounds.ts`) triangulates every `3`/`4` line in file order
 * with no regard for winding, which is fine for bounds and occupancy but wrong for
 * shading: a face's normal is the cross product of its edge vectors, so getting winding
 * wrong flips the normal and the face renders dark from the "outside". Getting winding
 * right means implementing LDraw's BFC state machine (`CERTIFY CW/CCW`, `INVERTNEXT`,
 * mirrored reference matrices) and then, on top of that, `LDrawLoader`'s edge-driven
 * normal smoothing — it merges normals across a shared vertex only when no explicit type-2
 * line marks that edge as a crease, which is how curved primitives (studs, cylinders,
 * minifig limbs) stay smooth while brick corners stay sharp. Both are exactly what
 * `LDrawLoader` already does, tested against the whole parts library for years.
 *
 * Reimplementing that in `src/ldraw/` would mean carrying a second, parallel
 * implementation of BFC and creasing that has to agree with three.js's forever. Running
 * the genuine loader once, at bake time, means baked and cold-fetched geometry for the
 * same part cannot visually disagree — they are the same code path, one fed from the
 * mirror on disk instead of a network request.
 *
 * ## How it runs offline
 *
 * `LDrawLoader.parse()` still recurses into referenced subfiles via `THREE.FileLoader`,
 * which normally calls `fetch`. Rather than fight that, this walks each chest part's
 * reference tree itself (same resolution order LDraw specifies: try as-is, then `parts/`,
 * `p/`, `models/`), reads every reachable file from the mirror, and seeds `THREE.Cache`
 * with them under the exact keys `FileLoader` will probe. `FileLoader.load` checks
 * `Cache.get` before ever calling `fetch`, so every subfile resolves from memory.
 *
 * Two details make that safe rather than merely usually-true:
 *
 * - `LDrawLoader` tries several candidate paths per reference before landing on the one
 *   that matches how this walk names it (`parts/x` before `p/x`, see `collectPartFiles`
 *   and the search order documented in `src/ldraw/mirror.ts`). The earlier candidates
 *   deliberately miss `Cache`.
 * - Node's `fetch` requires an absolute URL — `new Request('parts/x.dat')` with no base
 *   throws a `TypeError` synchronously, before any promise chain exists. `FileLoader`
 *   only cleans up its in-flight-request bookkeeping inside a `.catch()`, so a synchronous
 *   throw orphans that bookkeeping, and a *later* part that happens to probe the same
 *   candidate string (extremely common — nearly every part references `stud.dat`) hangs
 *   forever waiting on a callback that will never fire. `partsLibraryPath` is set to an
 *   absolute `file://` URL specifically so every candidate — hit or miss — is a
 *   syntactically valid `Request`, and only `fetch` itself ever rejects, the way a real
 *   network failure would. `installOfflineFetch` below is what makes that rejection
 *   instant and network-free rather than an actual `file://` fetch.
 *
 * Node-only: build-time code, run directly by `node`'s type stripping. Nothing in the
 * running application imports this file.
 */

import * as THREE from 'three'
import { LDrawLoader } from 'three/examples/jsm/loaders/LDrawLoader.js'
import { LDrawConditionalLineMaterial } from 'three/examples/jsm/materials/LDrawConditionalLineMaterial.js'
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

import { boundsFromPositions } from '../src/ldraw/bounds.ts'
import type { PartGeometry } from '../src/ldraw/types.ts'
import type { MirrorReader } from '../src/ldraw/mirror.ts'

/** Guards against reference cycles in malformed data, same default as `partTriangles`. */
const MAX_DEPTH = 24

/** A base under which every candidate path is a syntactically valid URL — see module doc. */
const BASE_URL = 'file:///brickyard-geometry-bake/'

// `FileLoader` (which `LDrawLoader` uses for every subfile) checks `THREE.Cache` before
// ever calling `fetch`. Enabling it once, globally, is what lets this whole module run
// off the mirror in memory instead of the network — see the module doc above.
THREE.Cache.enabled = true

/**
 * Replaces `fetch` with one that always rejects, instantly. `tools/prebake.ts` already
 * installs a guard that *throws*, which is exactly what breaks `FileLoader` here (see the
 * module doc) — this installs a spec-shaped replacement instead: every candidate probe
 * that isn't in `Cache` is a genuine cache miss (`collectPartFiles` only seeds the
 * candidates that actually resolve), and this makes that miss behave like a real fetch
 * failure — an asynchronous rejection — rather than a synchronous throw. No branch of this
 * function ever performs I/O. Installed lazily, not at module load, so it applies after
 * `prebake.ts`'s own guard rather than being clobbered by it.
 */
function installOfflineFetch(): void {
  globalThis.fetch = (() => Promise.reject(new Error('geometry bake: cache miss, no network'))) as typeof fetch
}

const normalise = (ref: string): string => ref.replace(/\\/g, '/').toLowerCase().trim()

function referenceCandidates(ref: string): string[] {
  const n = normalise(ref)
  if (n.length === 0) return []
  if (/^(parts|p|models)\//.test(n)) return [n]
  return [`parts/${n}`, `p/${n}`, `models/${n}`]
}

/**
 * Walks a part's reference tree (`1` lines only — the geometry doesn't need line or
 * optional-line data) and returns every file it touched, keyed by the mirror-relative
 * path `FileLoader`'s own matching candidate will end up probing.
 */
async function collectPartFiles(partId: string, readLibrary: MirrorReader): Promise<Map<string, string>> {
  const files = new Map<string, string>()
  const visited = new Set<string>()

  async function resolve(ref: string): Promise<{ path: string; text: string } | null> {
    for (const candidate of referenceCandidates(ref)) {
      const cached = files.get(candidate)
      if (cached !== undefined) return { path: candidate, text: cached }
      const text = await readLibrary(candidate)
      if (text !== null) {
        files.set(candidate, text)
        return { path: candidate, text }
      }
    }
    return null
  }

  async function walk(path: string, text: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH || visited.has(path)) return
    visited.add(path)
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim()
      if (!line.startsWith('1')) continue
      const tok = line.split(/\s+/)
      if (tok.length < 15) continue
      const child = await resolve(tok.slice(14).join(' '))
      if (child !== null) await walk(child.path, child.text, depth + 1)
    }
  }

  const top = await resolve(`parts/${partId}.dat`)
  if (top === null) throw new Error(`geometry bake: ${partId} not found in the mirror`)
  await walk(top.path, top.text, 0)
  return files
}

/**
 * Strips colour and pulls every `Mesh` under `group` into one merged geometry — the same
 * transform-baking `mergeMeshGeometry` in `src/scene/partSource.ts` does for the runtime
 * loader, duplicated here because this file runs under Node and that one imports the
 * browser-only conditional line material wiring alongside it.
 */
function mergeMeshGeometry(group: THREE.Object3D): THREE.BufferGeometry {
  group.updateMatrixWorld(true)
  const geometries: THREE.BufferGeometry[] = []
  group.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    const source = child.geometry as THREE.BufferGeometry
    const position = source.getAttribute('position')
    const normal = source.getAttribute('normal')
    if (position === undefined || normal === undefined) return
    const stripped = new THREE.BufferGeometry()
    stripped.setAttribute('position', position)
    stripped.setAttribute('normal', normal)
    if (source.index !== null) stripped.setIndex(source.index)
    stripped.applyMatrix4(child.matrixWorld)
    geometries.push(stripped)
  })
  if (geometries.length === 0) return new THREE.BufferGeometry()
  return mergeGeometries(geometries, false) ?? geometries[0]
}

/**
 * Bakes one part's flattened geometry. `colorLibraryText` is `LDConfig.ldr`'s raw text —
 * `LDrawLoader` needs it preloaded to resolve colour-16 passthrough materials, even though
 * the baked output itself carries no colour (see the chest-wide note in the caller).
 */
export async function bakePartGeometry(
  partId: string,
  readLibrary: MirrorReader,
  colorLibraryText: string,
): Promise<PartGeometry> {
  const files = await collectPartFiles(partId, readLibrary)
  for (const [path, text] of files) THREE.Cache.add(`file:${BASE_URL}${path}`, text)
  THREE.Cache.add(`file:${BASE_URL}LDConfig.ldr`, colorLibraryText)

  const loader = new LDrawLoader()
  loader.setPath(BASE_URL)
  loader.setPartsLibraryPath(BASE_URL)
  loader.setConditionalLineMaterial(LDrawConditionalLineMaterial)
  loader.smoothNormals = true
  await loader.preloadMaterials('LDConfig.ldr')

  const topPath = referenceCandidates(`parts/${partId}.dat`)[0]
  const topText = files.get(topPath)
  if (topText === undefined) throw new Error(`geometry bake: ${partId} missing after collection`)

  const group = await new Promise<THREE.Group>((resolve, reject) => {
    loader.parse(topText, (g: THREE.Group) => resolve(g), reject)
  })

  const merged = mergeMeshGeometry(group)
  const indexed = mergeVertices(merged, 1e-4)
  const position = indexed.getAttribute('position')
  const normal = indexed.getAttribute('normal')
  const index = indexed.getIndex()
  if (position === undefined || normal === undefined || index === null) {
    throw new Error(`geometry bake: ${partId} produced no fillable geometry`)
  }

  const positions = Float32Array.from(position.array as ArrayLike<number>)
  const normals = Float32Array.from(normal.array as ArrayLike<number>)
  const indices = Uint32Array.from(index.array as ArrayLike<number>)

  return {
    partId,
    positions,
    normals,
    indices,
    bounds: boundsFromPositions(positions),
  }
}

/**
 * Bakes every part in the chest, in list order, so output byte layout is a pure function
 * of the chest list regardless of `--jobs` — geometry baking never uses the worker pool
 * the connection/occupancy resolve does, since the chest is small (dozens of parts, not
 * thousands) and three.js's `LDrawLoader` keeps mutable state (`THREE.Cache`) that would
 * have to be duplicated per worker for no real benefit.
 */
export async function bakeChestGeometry(
  chest: readonly string[],
  readLibrary: MirrorReader,
  colorLibraryText: string,
): Promise<PartGeometry[]> {
  installOfflineFetch()
  const out: PartGeometry[] = []
  for (const partId of chest) {
    out.push(await bakePartGeometry(partId, readLibrary, colorLibraryText))
  }
  return out
}
