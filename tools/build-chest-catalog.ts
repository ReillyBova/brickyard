#!/usr/bin/env node
/**
 * Builds `src/ui/PartsChest/catalog.generated.json` — the parts chest's real names and
 * categories, read from the local LDraw mirror.
 *
 * **This script makes no network requests.** Titles come from line one of each part's
 * `.dat` file (`3001.dat` begins `0 Brick  2 x  4`); categories are curated below rather
 * than derived, because chest membership and grouping are product decisions, same as
 * `tools/prebake.ts`'s `DEFAULT_CHEST`.
 *
 * Source, in order:
 *   1. The local mirror at `.cache/ldraw/`, populated by `npm run sync-mirror`. Preferred
 *      because it covers the whole curated list.
 *   2. The committed fixture mirror at `src/ldraw/__fixtures__/mirror/`, which has the
 *      same `library/parts/…` layout but only a handful of real part files. Used so the
 *      chest still shows real names and a working catalog with no mirror synced — a
 *      reduced chest, not an empty or fabricated one.
 *
 * If neither source has any of the curated parts, the build fails with a message pointing
 * at `npm run sync-mirror` rather than emitting nothing.
 *
 * Usage: node tools/build-chest-catalog.ts [--mirror <dir>] [--out <file>]
 */

import fsp from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import { DEFAULT_MIRROR_ROOT, createLibraryReader, mirrorExists, type MirrorReader } from '../src/ldraw/mirror.ts'

const FIXTURE_MIRROR_ROOT = 'src/ui/PartsChest/__fixtures__/mirror'
const DEFAULT_OUT = 'src/ui/PartsChest/catalog.generated.json'

/**
 * The chest during development: a few dozen parts spanning connection types rather than
 * the full ~18,000-part library. Each entry names the category the tile groups under;
 * the title itself always comes from the real part file, never from this list.
 */
const CURATED_CHEST: readonly { id: string; category: string }[] = [
  // Bricks — plain studs, the baseline connection.
  { id: '3001', category: 'Bricks' },
  { id: '3002', category: 'Bricks' },
  { id: '3003', category: 'Bricks' },
  { id: '3004', category: 'Bricks' },
  { id: '3005', category: 'Bricks' },
  { id: '3010', category: 'Bricks' },
  { id: '2456', category: 'Bricks' },

  // Plates
  { id: '3020', category: 'Plates' },
  { id: '3022', category: 'Plates' },
  { id: '3023', category: 'Plates' },
  { id: '3024', category: 'Plates' },
  { id: '3031', category: 'Plates' },

  // Tiles — studless tops.
  { id: '3068b', category: 'Tiles' },
  { id: '3069b', category: 'Tiles' },
  { id: '3070b', category: 'Tiles' },
  { id: '4162', category: 'Tiles' },

  // Slopes
  { id: '3037', category: 'Slopes' },
  { id: '3040b', category: 'Slopes' },
  { id: '3665a', category: 'Slopes' },

  // Technic — a stepped pin hole, a pin, a liftarm.
  { id: '3700', category: 'Technic' },
  { id: '3701', category: 'Technic' },
  { id: '3673', category: 'Technic' },
  { id: '32523', category: 'Technic' },

  // Connectors — a clip and a bar, the two shapes Technic doesn't otherwise cover.
  { id: '4085c', category: 'Connectors' },
  { id: '30374', category: 'Connectors' },

  // Minifigure — torso, head, arm (a bar-and-socket joint), hand.
  { id: '973', category: 'Minifigure' },
  { id: '3626b', category: 'Minifigure' },
  { id: '3818', category: 'Minifigure' },
  { id: '3820', category: 'Minifigure' },

  // Round
  { id: '6141', category: 'Round' },
  { id: '3062b', category: 'Round' },
]

interface CatalogEntry {
  id: string
  title: string
  category: string
}

/** Line one of a part file, e.g. `0 Brick  2 x  4` — collapsed to single spaces. */
function readTitle(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? ''
  return firstLine.replace(/^0\s*/, '').trim().replace(/\s+/g, ' ')
}

interface BuildResult {
  catalog: CatalogEntry[]
  source: 'mirror' | 'fixtures'
  missing: string[]
}

async function readCatalog(readLibrary: MirrorReader, source: 'mirror' | 'fixtures'): Promise<BuildResult> {
  const catalog: CatalogEntry[] = []
  const missing: string[] = []
  for (const { id, category } of CURATED_CHEST) {
    const text = await readLibrary(`${id}.dat`)
    if (text === null) {
      missing.push(id)
      continue
    }
    catalog.push({ id, title: readTitle(text), category })
  }
  return { catalog, source, missing }
}

interface BuildOptions {
  mirror: string
  out: string
}

async function build(options: BuildOptions): Promise<BuildResult> {
  if (await mirrorExists(options.mirror)) {
    const result = await readCatalog(createLibraryReader(options.mirror), 'mirror')
    if (result.missing.length > 0) {
      throw new Error(
        `mirror at ${path.resolve(options.mirror)} is missing curated parts: ${result.missing.join(', ')}\n` +
          `Re-run \`npm run sync-mirror\` if the mirror looks stale, or drop those ids from CURATED_CHEST.`,
      )
    }
    return result
  }

  console.warn(
    `no mirror at ${path.resolve(options.mirror)} — falling back to the committed fixtures at ` +
      `${FIXTURE_MIRROR_ROOT}. Run \`npm run sync-mirror\` for the full curated chest.`,
  )
  const result = await readCatalog(createLibraryReader(FIXTURE_MIRROR_ROOT), 'fixtures')
  if (result.catalog.length === 0) {
    throw new Error(
      `no mirror at ${path.resolve(options.mirror)} and none of the curated parts are in the committed ` +
        `fixtures either — run \`npm run sync-mirror\` to populate the mirror, then re-run this script.`,
    )
  }
  if (result.missing.length > 0) {
    console.warn(
      `fixtures cover ${result.catalog.length} of ${CURATED_CHEST.length} curated parts. Missing: ` +
        `${result.missing.join(', ')}. Run \`npm run sync-mirror\` for the rest.`,
    )
  }
  return result
}

function parseArgs(argv: string[]): BuildOptions {
  const options: BuildOptions = { mirror: DEFAULT_MIRROR_ROOT, out: DEFAULT_OUT }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--mirror') options.mirror = argv[++i]
    else if (arg === '--out') options.out = argv[++i]
    else throw new Error(`unknown argument ${arg}`)
  }
  return options
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))

  // Enforced, not merely documented: this script reads local files and nothing else.
  globalThis.fetch = (() => {
    throw new Error('build-chest-catalog makes no network requests')
  }) as typeof fetch

  let result: BuildResult
  try {
    result = await build(options)
  } catch (error) {
    console.error(`build-chest-catalog failed: ${(error as Error).message}`)
    process.exitCode = 1
    return
  }

  const sorted = [...result.catalog].sort(
    (a, b) => a.category.localeCompare(b.category) || a.id.localeCompare(b.id, undefined, { numeric: true }),
  )
  await fsp.mkdir(path.dirname(options.out), { recursive: true })
  await fsp.writeFile(options.out, `${JSON.stringify(sorted, null, 2)}\n`)

  console.log(`wrote ${options.out} — ${sorted.length} parts, source: ${result.source}`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
