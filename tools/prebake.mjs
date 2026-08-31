#!/usr/bin/env node
/**
 * Bakes the shipped catalog from the local mirror into `public/baked/`.
 *
 * **This script makes no network requests.** Everything it needs comes from `.cache/ldraw/`,
 * populated separately by `tools/sync-mirror.mjs`. Re-baking a hundred times costs upstream
 * nothing, which is the whole point of the split.
 *
 * Usage: node tools/prebake.mjs [--mirror <dir>] [--out <dir>] [--chest <ids>] [--pretty]
 */

import { createHash } from 'node:crypto'
import fsp from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import {
  DEFAULT_MIRROR_ROOT,
  createLibraryReader,
  createShadowReader,
  mirrorExists,
  readArchiveMeta,
  readColorLibrary,
} from '../src/ldraw/mirror.ts'

/**
 * The chest during development. It grows into a curated popular set before shipping; the list is
 * deliberately literal rather than derived, because chest membership is a product decision.
 */
const DEFAULT_CHEST = [
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
function readPartHeader(text) {
  const lines = text.split(/\r?\n/)
  let title = ''
  let category = null

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

/**
 * ============================ INTEGRATION SEAM ============================
 * Connection-point resolution plugs in here. It belongs to the `src/snap/` slice, which owns the
 * shadow parser and the reference walk; this file deliberately does not import from it.
 *
 * The parser is injected with two readers, so it stays offline and testable:
 *
 *   resolvePart(partId, { readLibrary, readShadow }) -> PartDef
 *
 * Both readers have the signature `(relativePath: string) => Promise<string | null>` and are
 * already constructed below. When that lands, this function returns the resolved parts and the
 * writer gains `connections.bin` (packed points for the whole annotated corpus, ~4,200 parts) and
 * `geometry.bin` (flattened geometry, chest only). Until then the bake emits the colour library
 * and a catalog carrying real titles, which exercises the mirror end to end.
 * =========================================================================
 */
async function resolveConnections(partIds, readers) {
  void partIds
  void readers
  return { parts: [], covered: 0, implemented: false }
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
  constructor(outDir, pretty) {
    this.outDir = outDir
    this.pretty = pretty
    this.outputs = {}
  }

  async write(name, data) {
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data)
    const file = path.join(this.outDir, name)
    await fsp.mkdir(path.dirname(file), { recursive: true })
    await fsp.writeFile(file, buffer)
    this.outputs[name] = `sha256:${createHash('sha256').update(buffer).digest('hex')}`
    console.log(`  ${name.padEnd(24)} ${buffer.length.toLocaleString().padStart(12)} bytes`)
    return buffer.length
  }

  writeJson(name, value) {
    return this.write(name, `${JSON.stringify(value, null, this.pretty ? 2 : 0)}\n`)
  }
}

// ---------------------------------------------------------------------------
// Bake
// ---------------------------------------------------------------------------

async function bake(options) {
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
  const catalog = []
  const missing = []
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

  const connections = await resolveConnections(
    catalog.map((entry) => entry.partId),
    { readLibrary, readShadow },
  )

  await fsp.mkdir(options.out, { recursive: true })
  const writer = new Writer(options.out, options.pretty)
  console.log(`Writing ${path.resolve(options.out)}`)

  await writer.writeJson('colors.json', {
    version,
    colors: [...colors.values()].sort((a, b) => a.code - b.code),
  })
  await writer.writeJson('catalog.json', catalog)
  await writer.write('LICENSE.txt', LICENSE_TEXT)

  /**
   * The shadow library ships as a branch archive rather than a tagged release, so the recorded
   * revision is the archive's `ETag` digest — opaque, but it changes exactly when the contents do,
   * which is what staleness detection needs.
   */
  const manifest = {
    libraryVersion: version ?? partsMeta?.etag ?? 'unknown',
    shadowVersion: shadowMeta?.etag?.replace(/^W\/|"/g, '') ?? 'unknown',
    outputs: writer.outputs,
  }
  await writer.writeJson('manifest.json', manifest)

  console.log('')
  console.log(`library version   ${manifest.libraryVersion}`)
  console.log(`shadow revision   ${manifest.shadowVersion}`)
  console.log(`colours           ${colors.size}`)
  console.log(`catalog entries   ${catalog.length}`)
  console.log(
    `connections       ${
      connections.implemented ? `${connections.covered} parts` : 'not resolved (seam unimplemented)'
    }`,
  )
}

const USAGE = `Usage: node tools/prebake.mjs [options]

  --mirror <dir>  local mirror (default ${DEFAULT_MIRROR_ROOT})
  --out <dir>     output directory (default public/baked)
  --chest <ids>   comma-separated part ids to bake into the chest
  --pretty        indent the JSON output
  --help          show this message

Reads only the mirror. Makes no network requests.
`

function parseArgs(argv) {
  const options = {
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
    else if (arg === '--pretty') options.pretty = true
    else if (arg === '--help' || arg === '-h') options.help = true
    else throw new Error(`unknown argument ${arg}`)
  }
  if (options.mirror === undefined || options.out === undefined) {
    throw new Error('missing argument value')
  }
  return options
}

async function main() {
  let options
  try {
    options = parseArgs(process.argv.slice(2))
  } catch (error) {
    console.error(String(error.message))
    console.error(USAGE)
    process.exitCode = 2
    return
  }
  if (options.help) {
    console.log(USAGE)
    return
  }

  // Enforced, not merely documented: the bake reads the mirror and nothing else.
  globalThis.fetch = () => {
    throw new Error('prebake makes no network requests — run `npm run sync-mirror` instead')
  }

  const started = Date.now()
  try {
    await bake(options)
  } catch (error) {
    console.error(`prebake failed: ${error.message}`)
    process.exitCode = 1
    return
  }
  console.log(`\nbaked in ${((Date.now() - started) / 1000).toFixed(1)}s`)
}

await main()
