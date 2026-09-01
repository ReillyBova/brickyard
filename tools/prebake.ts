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

import { createHash } from 'node:crypto'
import fsp from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import { boundsFromTriangles, partTriangles } from '../src/ldraw/bounds.ts'
import type { CatalogEntry } from '../src/ldraw/types.ts'
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
  packConnections,
  packOccupancy,
  type BakedConnections,
  type BakedOccupancy,
} from '../src/snap/baked.ts'
import { buildOccupancy } from '../src/snap/collision.ts'
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
  const started = Date.now()

  for (const [index, partId] of partIds.entries()) {
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
    if ((index + 1) % 250 === 0) {
      const elapsed = (Date.now() - started) / 1000
      console.log(`  ${index + 1}/${partIds.length} parts  ${elapsed.toFixed(0)}s`)
    }
  }

  return { connections, occupancy, failures, seconds: (Date.now() - started) / 1000 }
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
  /** Caps the corpus, for a fast bake while working on the pipeline itself. */
  limit?: number
  help?: boolean
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
  console.log(`Resolving ${wanted.length.toLocaleString()} parts from the mirror`)
  const resolved = await resolveCorpus(wanted, { readLibrary, readShadow })

  await fsp.mkdir(options.out, { recursive: true })
  const writer = new Writer(options.out, options.pretty)
  console.log(`Writing ${path.resolve(options.out)}`)

  await writer.writeJson('colors.json', {
    version,
    colors: [...colors.values()].sort((a, b) => a.code - b.code),
  })
  await writer.writeJson('catalog.json', catalog)
  await writer.write('connections.bin', Buffer.from(packConnections(resolved.connections)))
  await writer.write('occupancy.bin', Buffer.from(packOccupancy(resolved.occupancy)))
  await writer.write('LICENSE.txt', LICENSE_TEXT)

  /**
   * The shadow library ships as a branch archive rather than a tagged release, so the recorded
   * revision is the archive's `ETag` digest — opaque, but it changes exactly when the contents do,
   * which is what staleness detection needs.
   */
  const manifest = {
    libraryVersion: version ?? partsMeta?.etag ?? 'unknown',
    shadowVersion: shadowMeta?.etag?.replace(/^W\/|"/g, '') ?? 'unknown',
    /** Shipped masks pin the voxel size and fill semantics; see `docs/PREBAKE.md`. */
    occupancyFormat: BAKED_FORMAT_VERSION,
    outputs: writer.outputs,
  }
  await writer.writeJson('manifest.json', manifest)

  console.log('')
  console.log(`library version   ${manifest.libraryVersion}`)
  console.log(`shadow revision   ${manifest.shadowVersion}`)
  console.log(`colors           ${colors.size}`)
  console.log(`catalog entries   ${catalog.length}`)
  console.log(`connections       ${resolved.connections.length.toLocaleString()} parts`)
  console.log(`occupancy         ${resolved.occupancy.length.toLocaleString()} parts`)
  console.log(`unreadable        ${resolved.failures.length.toLocaleString()} parts`)
  console.log(`resolve time      ${resolved.seconds.toFixed(0)}s`)
}

const USAGE = `Usage: node tools/prebake.ts [options]

  --mirror <dir>  local mirror (default ${DEFAULT_MIRROR_ROOT})
  --out <dir>     output directory (default public/baked)
  --chest <ids>   comma-separated part ids to bake into the chest
  --limit <n>     cap the resolved corpus, for a fast bake while iterating
  --pretty        indent the JSON output
  --help          show this message

Reads only the mirror. Makes no network requests.
`

function parseArgs(argv: string[]): BakeOptions {
  const options: BakeOptions = {
    mirror: DEFAULT_MIRROR_ROOT,
    out: 'public/baked',
    chest: DEFAULT_CHEST,
    pretty: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--mirror') options.mirror = argv[++i]
    else if (arg === '--out') options.out = argv[++i]
    else if (arg === '--chest') options.chest = argv[++i].split(',').map((id) => id.trim())
    else if (arg === '--limit') options.limit = Number(argv[++i])
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
