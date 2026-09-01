#!/usr/bin/env node
/**
 * Bakes the shipped catalog from the local mirror into `public/baked/`.
 *
 * **This script makes no network requests.** Everything it needs comes from `.cache/ldraw/`,
 * populated separately by `tools/sync-mirror.ts`. Re-baking a hundred times costs upstream
 * nothing, which is the whole point of the split.
 *
 * Usage: node tools/prebake.ts [--mirror <dir>] [--out <dir>] [--chest <ids>] [--pretty]
 */

import { availableParallelism } from 'node:os'
import { createHash } from 'node:crypto'
import fsp from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'

import type { BakeResult } from './bakeWorker.ts'
import { bakeChestGeometry, bakePartGeometry } from './bakeGeometry.ts'

import { boundsFromTriangles, partTriangles } from '../src/ldraw/bounds.ts'
import { GEOMETRY_FORMAT_VERSION, GEOMETRY_SEMANTICS_VERSION } from '../src/ldraw/geometryBaked.ts'
import { packGeometry } from '../src/ldraw/geometryBaked.ts'
import type { BakedManifest, CatalogEntry } from '../src/ldraw/types.ts'
import {
  DEFAULT_MIRROR_ROOT,
  createLibraryReader,
  createShadowReader,
  mirrorExists,
  mirrorLayout,
  readArchiveMeta,
  readColorLibrary,
  type MirrorReader,
} from '../src/ldraw/mirror.ts'
import {
  BAKED_FORMAT_VERSION,
  SEMANTICS_VERSION,
  packConnections,
  packOccupancy,
  type BakedConnections,
  type BakedOccupancy,
} from '../src/snap/baked.ts'
import { buildOccupancy } from '../src/snap/collision.ts'
import { computeFixtureDigest } from '../src/snap/fixtureDigest.ts'
import { resolvePart, type ReadFile } from '../src/snap/resolvePart.ts'

/**
 * The chest during development. It grows into a curated popular set before shipping; the list is
 * deliberately literal rather than derived, because chest membership is a product decision.
 */
const DEFAULT_CHEST: readonly string[] = [
  '3001', // Brick 2 x 4
  '3002', // Brick 2 x 3
  '3003', // Brick 2 x 2
  '3004', // Brick 1 x 2
  '3005', // Brick 1 x 1
  '3020', // Plate 2 x 4
  '3022', // Plate 2 x 2
  '3023', // Plate 1 x 2
  '3024', // Plate 1 x 1
  '3062b', // Brick 1 x 1 Round with Hollow Stud
  '3068b', // Tile 2 x 2 with Groove
  '3069b', // Tile 1 x 2 with Groove
  '3700', // Technic Brick 1 x 2 with Hole
  '3794a', // Plate 1 x 2 with Stud
  '4070', // Brick 1 x 1 with Headlight
  '3040b', // Slope Brick 45 2 x 1
  '3660', // Slope Brick 45 2 x 2 Inverted
  '3626bp01', // Minifig Head
  '3818', // Minifig Arm Right
  '3815', // Minifig Hips
]

// ---------------------------------------------------------------------------
// Part metadata, read straight from the mirror
// ---------------------------------------------------------------------------

/**
 * Title and category from a part header. Line 1 is the description; `0 !CATEGORY` overrides the
 * implicit category, which is otherwise the first word of the description.
 */
function readPartHeader(text: string): { title: string; category: string } {
  const lines = text.split(/\r?\n/)
  let title = ''
  let category: string | null = null

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (line === '') continue
    if (!line.startsWith('0')) break
    const body = line.slice(1).trim()
    if (title === '' && !body.startsWith('!') && !/^(Name|Author):/i.test(body)) {
      title = body
      continue
    }
    const match = /^!CATEGORY\s+(.+)$/i.exec(body)
    if (match !== null) category = match[1].trim()
  }

  if (category === null) {
    const first = title.replace(/^[_~=]/, '').trim().split(/\s+/)[0]
    category = first === undefined || first === '' ? 'Unsorted' : first
  }
  return { title, category }
}

// ---------------------------------------------------------------------------
// Fixture digest — the semantics staleness guard's other half
// ---------------------------------------------------------------------------

/**
 * Reads the committed fixture corpus (`src/snap/__fixtures__/`) straight off disk.
 *
 * `computeFixtureDigest` is deliberately reader-agnostic (`src/snap/fixtureDigest.ts`), and
 * `src/snap/__fixtures__/reader.ts`'s own reader is built on `import.meta.glob`, a Vite
 * transform this plain-Node script never runs through — so the bake needs its own reader
 * over the same directory to record the same digest `manifest.json` will be checked against.
 */
const FIXTURES_ROOT = fileURLToPath(new URL('../src/snap/__fixtures__', import.meta.url))

const readFixture: ReadFile = async (relativePath) => {
  try {
    return await fsp.readFile(path.join(FIXTURES_ROOT, relativePath), 'utf8')
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Seam: connection-point resolution
// ---------------------------------------------------------------------------

interface ConnectionReaders {
  readLibrary: MirrorReader
  readShadow: MirrorReader
}

interface ConnectionResolution {
  connections: BakedConnections[]
  occupancy: BakedOccupancy[]
  /** Parts in the annotated set whose geometry or metadata the mirror could not supply. */
  failures: string[]
  /** The slowest parts, so a pathological one is named rather than merely felt. */
  slow: { partId: string; seconds: number }[]
  seconds: number
}

/**
 * The parts the shadow library annotates, which is the set connection data covers. Read
 * from the mirror's own directory listing rather than a checked-in list, so a shadow
 * release that adds or drops coverage is picked up by re-syncing.
 */
async function annotatedParts(mirror: string): Promise<string[]> {
  const directory = path.join(mirrorLayout(mirror).shadow, 'parts')
  const names = await fsp.readdir(directory)
  return names
    .filter((name) => name.toLowerCase().endsWith('.dat'))
    .map((name) => name.replace(/\.dat$/i, ''))
    .sort()
}

/**
 * `resolvePart` and `partTriangles` read namespaced paths (`ldraw/parts/3001.dat`,
 * `shadow/p/stud.dat`); the mirror readers are already rooted at each library. This is
 * the whole adapter between them.
 */
function namespacedReader(readers: ConnectionReaders): ReadFile {
  return (relativePath) =>
    relativePath.startsWith('shadow/')
      ? readers.readShadow(relativePath.slice('shadow/'.length))
      : readers.readLibrary(relativePath.replace(/^ldraw\//, ''))
}

/**
 * Resolves the corpus across a pool of workers, handing each one part at a time.
 *
 * Per-part cost spans three orders of magnitude, so work is dispatched on completion
 * rather than split up front — a static split leaves the machine waiting on whichever
 * worker drew the baseplates. Results are collected into a map and emitted in the
 * caller's order, so the output is identical whatever order the workers finish in and
 * the bake stays a pure function of the mirror.
 */
async function resolveInParallel(
  partIds: readonly string[],
  mirror: string,
  jobs: number,
): Promise<ConnectionResolution> {
  const workerPath = fileURLToPath(new URL('./bakeWorker.ts', import.meta.url))
  const results = new Map<string, BakeResult>()
  const failures: string[] = []
  const slow: { partId: string; seconds: number }[] = []
  const started = Date.now()
  let next = 0
  let finished = 0

  await new Promise<void>((resolve, reject) => {
    let live = jobs
    const workers: Worker[] = []
    /** Stops the whole pool, so one worker's failure does not leave the rest baking. */
    const stopAll = (error: Error): void => {
      for (const w of workers) void w.terminate()
      reject(error)
    }

    for (let i = 0; i < jobs; i++) {
      const worker = new Worker(workerPath, { workerData: { mirror } })
      workers.push(worker)
      /** The part this worker is currently resolving, so a death can be attributed. */
      let inFlight: string | undefined

      const dispatch = (): void => {
        if (next >= partIds.length) {
          inFlight = undefined
          worker.postMessage(null)
          return
        }
        inFlight = partIds[next++]
        worker.postMessage({ partId: inFlight })
      }

      worker.on('message', (result: BakeResult) => {
        results.set(result.partId, result)
        if (!result.ok) failures.push(result.partId)
        if (result.milliseconds > 2000) slow.push({ partId: result.partId, seconds: result.milliseconds / 1000 })
        finished++
        if (finished % 250 === 0) {
          console.log(`  ${finished}/${partIds.length} parts  ${((Date.now() - started) / 1000).toFixed(0)}s`)
        }
        dispatch()
      })
      worker.on('error', stopAll)
      worker.on('exit', (code) => {
        // A worker can die without ever emitting `error` — an OOM kill, or a bug that
        // calls process.exit mid-part. Left unchecked that silently drops whatever it
        // was resolving: absent from the output, absent from `failures`, and the bake
        // still exits 0. A part is missing from the catalog and nothing says so.
        if (code !== 0) {
          stopAll(
            new Error(
              `bake worker exited with code ${code}` +
                (inFlight === undefined ? '' : ` while resolving ${inFlight}`),
            ),
          )
          return
        }
        live--
        if (live === 0) resolve()
      })
      dispatch()
    }
  })

  const connections: BakedConnections[] = []
  const occupancy: BakedOccupancy[] = []
  for (const partId of partIds) {
    const result = results.get(partId)
    if (result === undefined || !result.ok) continue
    if (result.points.length > 0) connections.push({ partId, points: result.points })
    occupancy.push({
      partId,
      bounds: result.bounds,
      occupancy: { dims: result.dims, bits: result.bits },
    })
  }

  slow.sort((a, b) => b.seconds - a.seconds)
  return { connections, occupancy, failures, slow, seconds: (Date.now() - started) / 1000 }
}

/**
 * Resolves every part in `partIds` to its connection points and its occupancy mask,
 * using the same `src/snap/` code the app runs — one implementation, so a baked part and
 * a cold-resolved one cannot disagree.
 *
 * Sequential, because the work is CPU-bound in one process and ordered output keeps the
 * bake a pure function of the mirror. Parts whose geometry or shadow file is unreadable
 * are counted and skipped: a part missing from an upstream release should not fail a
 * bake of the other four thousand.
 */
async function resolveCorpus(
  partIds: readonly string[],
  readers: ConnectionReaders,
): Promise<ConnectionResolution> {
  const read = namespacedReader(readers)
  const connections: BakedConnections[] = []
  const occupancy: BakedOccupancy[] = []
  const failures: string[] = []
  /** Parts that took long enough to be worth naming in the bake's own output. */
  const slow: { partId: string; seconds: number }[] = []
  const started = Date.now()

  for (const [index, partId] of partIds.entries()) {
    const partStarted = Date.now()
    try {
      const [points, triangles] = await Promise.all([
        resolvePart(partId, read),
        partTriangles(partId, read),
      ])
      if (triangles.length === 0) {
        failures.push(partId)
        continue
      }
      const bounds = boundsFromTriangles(triangles)
      if (points.length > 0) connections.push({ partId, points })
      occupancy.push({ partId, bounds, occupancy: buildOccupancy(triangles, bounds, points) })
    } catch {
      failures.push(partId)
    }
    const took = Date.now() - partStarted
    if (took > 2000) slow.push({ partId, seconds: took / 1000 })
    if ((index + 1) % 100 === 0) {
      const elapsed = (Date.now() - started) / 1000
      console.log(`  ${index + 1}/${partIds.length} parts  ${elapsed.toFixed(0)}s`)
    }
  }

  slow.sort((a, b) => b.seconds - a.seconds)
  return { connections, occupancy, failures, slow, seconds: (Date.now() - started) / 1000 }
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

const LICENSE_TEXT = `Baked output in this directory is derived from third-party open datasets and
carries their terms, not the application's licence.

LDraw parts library — geometry, part titles and categories
  (c) LDraw.org contributors, CC BY 2.0
  https://library.ldraw.org/

LDCad shadow library — connection metadata
  (c) Roland Melkert and contributors, CC BY-SA 4.0
  Files derived from it are themselves CC BY-SA 4.0.
  https://github.com/RolandMelkert/LDCadShadowLibrary

LDraw Official Model Repository — model manifests
  (c) their respective authors, CC BY 4.0
  https://omr.ldraw.org/

LEGO is a trademark of the LEGO Group, which does not sponsor or endorse this project.
`

class Writer {
  outDir: string
  pretty: boolean
  outputs: Record<string, string> = {}

  constructor(outDir: string, pretty: boolean) {
    this.outDir = outDir
    this.pretty = pretty
  }

  async write(name: string, data: string | Buffer): Promise<number> {
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data)
    const file = path.join(this.outDir, name)
    await fsp.mkdir(path.dirname(file), { recursive: true })
    await fsp.writeFile(file, buffer)
    this.outputs[name] = `sha256:${createHash('sha256').update(buffer).digest('hex')}`
    console.log(`  ${name.padEnd(24)} ${buffer.length.toLocaleString().padStart(12)} bytes`)
    return buffer.length
  }

  writeJson(name: string, value: unknown): Promise<number> {
    return this.write(name, `${JSON.stringify(value, null, this.pretty ? 2 : 0)}\n`)
  }
}

// ---------------------------------------------------------------------------
// Bake
// ---------------------------------------------------------------------------

interface BakeOptions {
  mirror: string
  out: string
  chest: readonly string[]
  pretty: boolean
  /** Bundled models, whose parts define the hosted tier's set. */
  models: string
  /**
   * Size ceiling for the hosted tier, in MB. These bytes are committed and shipped, so
   * the tier is capped rather than allowed to track the corpus: see `docs/PREBAKE.md` for
   * the measurements behind the default.
   */
  hostedBudgetMb: number
  /** Caps the corpus, for a fast bake while working on the pipeline itself. */
  limit?: number
  /** Worker threads to resolve on. 1 runs in-process, which is the readable path to debug. */
  jobs?: number
  help?: boolean
}

/**
 * The hosted tier's part set: every part the bundled models actually use, minus the chest
 * parts already bundled in `geometry.bin`.
 *
 * Scoped to the bundled models rather than the whole annotated corpus because the whole
 * corpus measures 3,304 files and 224 MB — the flattened median is 33 KB per part against
 * `docs/PREBAKE.md`'s pending ~17 KB estimate, so the doc's own fallback applies and the
 * set narrows. Narrowing to what ships buys a property worth having: opening any bundled
 * model needs nothing from upstream. Anything outside still resolves over the network,
 * which is the fetched tier working as designed.
 *
 * Read from the model manifests rather than a hand-kept list, so adding a model to
 * `public/models/` widens the hosted set on the next bake instead of silently leaving that
 * model's parts on the slow path.
 */
async function hostedParts(modelsDir: string, chest: readonly string[]): Promise<string[]> {
  let names: string[]
  try {
    names = await fsp.readdir(modelsDir)
  } catch {
    return []
  }
  const bundled = new Set(chest)
  const uses = new Map<string, number>()
  for (const name of names.filter((n) => n.endsWith('.manifest.json'))) {
    const text = await fsp.readFile(path.join(modelsDir, name), 'utf8')
    const manifest = JSON.parse(text) as { partIds?: string[] }
    for (const partId of manifest.partIds ?? []) {
      if (!bundled.has(partId)) uses.set(partId, (uses.get(partId) ?? 0) + 1)
    }
  }
  // Most-used first, ties by id: the budget below cuts the tail, so the order decides what
  // survives, and it has to be a pure function of the manifests for the bake to be one too.
  return [...uses.keys()].sort((a, b) => (uses.get(b) ?? 0) - (uses.get(a) ?? 0) || a.localeCompare(b))
}

interface HostedResult {
  written: number
  failures: string[]
  /** Parts left out because the budget ran out, not because they failed. */
  skipped: number
  bytes: number
  /** One hash over every hosted file, so the manifest can detect drift without 800 entries. */
  digest: string
  seconds: number
}

/**
 * Writes one flattened geometry file per hosted part, as `geometry/<partId>.bin`.
 *
 * Each file is a complete `geometry.bin` payload holding a single part, so the reader that
 * decodes the bundled file decodes these unchanged — one format, one code path, and a
 * per-part file that can be validated on its own.
 *
 * Parts the mirror cannot supply are counted and skipped. A model referencing one still
 * works: the runtime falls through to the network exactly as it does for any uncovered
 * part.
 */
async function bakeHostedGeometry(
  partIds: readonly string[],
  outDir: string,
  readLibrary: MirrorReader,
  colorLibraryText: string,
  budgetBytes: number,
): Promise<HostedResult> {
  const started = Date.now()
  const directory = path.join(outDir, 'geometry')
  // Cleared, not merged: a shrinking set would otherwise leave orphans that ship forever
  // and never appear in the digest.
  await fsp.rm(directory, { recursive: true, force: true })
  await fsp.mkdir(directory, { recursive: true })

  const failures: string[] = []
  const perFile = createHash('sha256')
  let written = 0
  let bytes = 0

  let skipped = 0
  for (const [index, partId] of partIds.entries()) {
    if (bytes >= budgetBytes) {
      skipped = partIds.length - index
      break
    }
    let packed: Buffer
    try {
      packed = Buffer.from(packGeometry([await bakePartGeometry(partId, readLibrary, colorLibraryText)]))
    } catch {
      failures.push(partId)
      continue
    }
    await fsp.writeFile(path.join(directory, `${partId}.bin`), packed)
    // Hashed in the caller's sorted order, so the digest is a pure function of the set.
    perFile.update(partId)
    perFile.update(createHash('sha256').update(packed).digest())
    written++
    bytes += packed.length
    if ((index + 1) % 200 === 0) {
      console.log(`  ${index + 1}/${partIds.length} hosted parts  ${((Date.now() - started) / 1000).toFixed(0)}s`)
    }
  }

  return {
    written,
    failures,
    skipped,
    bytes,
    digest: `sha256:${perFile.digest('hex')}`,
    seconds: (Date.now() - started) / 1000,
  }
}

async function bake(options: BakeOptions): Promise<void> {
  if (!(await mirrorExists(options.mirror))) {
    throw new Error(
      `no mirror at ${path.resolve(options.mirror)} — run \`npm run sync-mirror\` first`,
    )
  }

  const readLibrary = createLibraryReader(options.mirror)
  const readShadow = createShadowReader(options.mirror)

  const { colors, version } = await readColorLibrary(options.mirror)
  const partsMeta = await readArchiveMeta('complete', options.mirror)
  const shadowMeta = await readArchiveMeta('shadow', options.mirror)

  // Catalog. Titles and categories come from the real part headers, so a missing or renamed part
  // fails the bake here rather than at runtime.
  const catalog: CatalogEntry[] = []
  const missing: string[] = []
  for (const partId of options.chest) {
    const text = await readLibrary(`${partId}.dat`)
    if (text === null) {
      missing.push(partId)
      continue
    }
    const { title, category } = readPartHeader(text)
    catalog.push({ partId, title, category, tier: 'bundled' })
  }
  if (missing.length > 0) {
    throw new Error(`not in the mirror: ${missing.join(', ')}`)
  }

  // Connections cover the annotated corpus; occupancy covers that set plus anything in the
  // chest the shadow library does not annotate, since a part with no connection points
  // still has a body that collides.
  const annotated = await annotatedParts(options.mirror)
  const corpus = [...new Set([...annotated, ...options.chest])].sort()
  const wanted = options.limit === undefined ? corpus : corpus.slice(0, options.limit)
  const jobs = options.jobs ?? Math.max(1, Math.min(availableParallelism(), 12))
  console.log(`Resolving ${wanted.length.toLocaleString()} parts from the mirror on ${jobs} ${jobs === 1 ? 'thread' : 'threads'}`)
  const resolved =
    jobs === 1
      ? await resolveCorpus(wanted, { readLibrary, readShadow })
      : await resolveInParallel(wanted, options.mirror, jobs)

  await fsp.mkdir(options.out, { recursive: true })
  const writer = new Writer(options.out, options.pretty)
  console.log(`Writing ${path.resolve(options.out)}`)

  // Geometry — the curated chest only, see docs/PREBAKE.md. Sequential and separate from
  // the worker pool above: the chest is a couple dozen parts, not thousands, and the
  // three.js LDrawLoader this leans on (see tools/bakeGeometry.ts) keeps mutable state
  // that isn't worth duplicating per worker.
  console.log(`Baking geometry for ${options.chest.length} chest parts`)
  const colorLibraryText = await readLibrary('LDConfig.ldr')
  if (colorLibraryText === null) {
    throw new Error('LDConfig.ldr missing from the mirror')
  }
  const geometryStarted = Date.now()
  const geometry = await bakeChestGeometry(options.chest, readLibrary, colorLibraryText)
  const geometrySeconds = (Date.now() - geometryStarted) / 1000

  await writer.writeJson('colors.json', {
    version,
    colors: [...colors.values()].sort((a, b) => a.code - b.code),
  })
  await writer.writeJson('catalog.json', catalog)
  await writer.write('connections.bin', Buffer.from(packConnections(resolved.connections)))
  await writer.write('occupancy.bin', Buffer.from(packOccupancy(resolved.occupancy)))
  await writer.write('geometry.bin', Buffer.from(packGeometry(geometry)))

  // The hosted tier: one file per part, fetched on demand from our own origin. Written
  // outside `writer` because a per-file hash for each of hundreds of parts would bloat the
  // manifest past usefulness; `hostedGeometryDigest` covers the whole set in one line.
  const hostedSet = await hostedParts(options.models, options.chest)
  console.log(
    `Baking hosted geometry for up to ${hostedSet.length.toLocaleString()} parts used by bundled models, ` +
      `budget ${options.hostedBudgetMb} MB`,
  )
  const hosted = await bakeHostedGeometry(
    hostedSet,
    options.out,
    readLibrary,
    colorLibraryText,
    options.hostedBudgetMb * 1e6,
  )

  await writer.write('LICENSE.txt', LICENSE_TEXT)

  /**
   * The shadow library ships as a branch archive rather than a tagged release, so the recorded
   * revision is the archive's `ETag` digest — opaque, but it changes exactly when the contents do,
   * which is what staleness detection needs.
   */
  const fixtureDigest = await computeFixtureDigest(readFixture)
  const manifest: BakedManifest = {
    libraryVersion: version ?? partsMeta?.etag ?? 'unknown',
    shadowVersion: shadowMeta?.etag?.replace(/^W\/|"/g, '') ?? 'unknown',
    /** Shipped bytes pin their layout and the meaning of their fields; see `docs/PREBAKE.md`. */
    bakedFormatVersion: BAKED_FORMAT_VERSION,
    semanticsVersion: SEMANTICS_VERSION,
    geometryFormatVersion: GEOMETRY_FORMAT_VERSION,
    geometrySemanticsVersion: GEOMETRY_SEMANTICS_VERSION,
    fixtureDigest,
    hostedGeometryParts: hosted.written,
    hostedGeometryDigest: hosted.digest,
    outputs: writer.outputs,
  }
  await writer.writeJson('manifest.json', manifest)

  console.log('')
  console.log(`library version   ${manifest.libraryVersion}`)
  console.log(`shadow revision   ${manifest.shadowVersion}`)
  console.log(`baked format      ${manifest.bakedFormatVersion}`)
  console.log(`semantics         ${manifest.semanticsVersion}`)
  console.log(`geometry format   ${manifest.geometryFormatVersion}`)
  console.log(`geometry semantics ${manifest.geometrySemanticsVersion}`)
  console.log(`fixture digest    ${manifest.fixtureDigest}`)
  console.log(`colors           ${colors.size}`)
  console.log(`catalog entries   ${catalog.length}`)
  console.log(`connections       ${resolved.connections.length.toLocaleString()} parts`)
  console.log(`occupancy         ${resolved.occupancy.length.toLocaleString()} parts`)
  console.log(`geometry          ${geometry.length.toLocaleString()} parts (bundled)`)
  console.log(
    `hosted geometry   ${hosted.written.toLocaleString()} parts, ${(hosted.bytes / 1e6).toFixed(1)} MB, ` +
      `${hosted.failures.length} unavailable, ${hosted.skipped} past budget`,
  )
  console.log(`unreadable        ${resolved.failures.length.toLocaleString()} parts`)
  console.log(`resolve time      ${resolved.seconds.toFixed(0)}s`)
  console.log(`geometry time     ${geometrySeconds.toFixed(1)}s`)
  console.log(`hosted time       ${hosted.seconds.toFixed(0)}s`)
  for (const { partId, seconds } of resolved.slow.slice(0, 10)) {
    console.log(`  slowest: ${partId.padEnd(16)} ${seconds.toFixed(1)}s`)
  }
}

const USAGE = `Usage: node tools/prebake.ts [options]

  --mirror <dir>  local mirror (default ${DEFAULT_MIRROR_ROOT})
  --out <dir>     output directory (default public/baked)
  --models <dir>  bundled models whose parts define the hosted set (default public/models)
  --hosted-budget-mb <n>  size ceiling for the hosted tier (default 40)
  --chest <ids>   comma-separated part ids to bake into the chest
  --limit <n>     cap the resolved corpus, for a fast bake while iterating
  --jobs <n>      worker threads (default: cores, capped at 12; 1 runs in-process)
  --pretty        indent the JSON output
  --help          show this message

Reads only the mirror. Makes no network requests.
`

function parseArgs(argv: string[]): BakeOptions {
  const options: BakeOptions = {
    mirror: DEFAULT_MIRROR_ROOT,
    out: 'public/baked',
    models: 'public/models',
    hostedBudgetMb: 40,
    chest: DEFAULT_CHEST,
    pretty: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--mirror') options.mirror = argv[++i]
    else if (arg === '--out') options.out = argv[++i]
    else if (arg === '--models') options.models = argv[++i]
    else if (arg === '--hosted-budget-mb') options.hostedBudgetMb = Number(argv[++i])
    else if (arg === '--chest') options.chest = argv[++i].split(',').map((id) => id.trim())
    else if (arg === '--limit') options.limit = Number(argv[++i])
    else if (arg === '--jobs') options.jobs = Math.max(1, Number(argv[++i]))
    else if (arg === '--pretty') options.pretty = true
    else if (arg === '--help' || arg === '-h') options.help = true
    else throw new Error(`unknown argument ${arg}`)
  }
  if (options.mirror === undefined || options.out === undefined) {
    throw new Error('missing argument value')
  }
  return options
}

async function main(): Promise<void> {
  let options: BakeOptions
  try {
    options = parseArgs(process.argv.slice(2))
  } catch (error) {
    console.error(String((error as Error).message))
    console.error(USAGE)
    process.exitCode = 2
    return
  }
  if (options.help) {
    console.log(USAGE)
    return
  }

  // Enforced, not merely documented: the bake reads the mirror and nothing else.
  globalThis.fetch = (() => {
    throw new Error('prebake makes no network requests — run `npm run sync-mirror` instead')
  }) as typeof fetch

  const started = Date.now()
  try {
    await bake(options)
  } catch (error) {
    console.error(`prebake failed: ${(error as Error).message}`)
    process.exitCode = 1
    return
  }
  console.log(`\nbaked in ${((Date.now() - started) / 1000).toFixed(1)}s`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
