#!/usr/bin/env node
/**
 * Builds `src/ui/PartsChest/catalog.generated.json` — the parts chest's real names,
 * categories and popularity.
 *
 * Membership and ranking come from two local, offline sources: `public/models/*.mpd`
 * (parsed with the same `parseMpd` the running app uses, to count how often each part
 * id is actually placed) and `public/baked/connections.bin` (the committed connections
 * bake, to require that every candidate resolves to at least one connection point).
 * Neither needs the network — this script runs through `tools/run-with-vite.mjs` rather
 * than plain Node only because `parseMpd.ts` uses extensionless imports.
 *
 * Titles are a separate, best-effort concern, tried in order:
 *   1. `src/ui/PartsChest/catalog.generated.json`'s own previous contents — free, no I/O,
 *      and covers every part carried over from one generation to the next.
 *   2. The local LDraw mirror at `.cache/ldraw/` (`npm run sync-mirror`) if present, else
 *      the committed fixture mirror at `src/ui/PartsChest/__fixtures__/mirror/`, which
 *      covers only a handful of real part files.
 *   3. One HTTPS request per remaining id to the CORS-enabled GitHub mirror of the LDraw
 *      parts library (`raw.githubusercontent.com/gkjohnson/ldraw-parts-library`), run
 *      with bounded concurrency. This is the only network use in the build — a few
 *      hundred small, cached, same-shape GET requests for titles the first two sources
 *      don't have, not a crawl of the library.
 *   4. A placeholder title (`Part <id>`), logged as a warning, if all three come back
 *      empty — the part still counts toward its category by usage and connectivity, it
 *      just carries a name that says plainly it wasn't resolved.
 *
 * Usage: node tools/run-with-vite.mjs tools/build-chest-catalog.ts [--mirror <dir>] [--out <file>]
 */

import fsp from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import { parseMpd } from '../src/features/omr/parseMpd.ts'
import { unpackConnections } from '../src/snap/baked.ts'
import { DEFAULT_MIRROR_ROOT, createLibraryReader, mirrorExists, type MirrorReader } from '../src/ldraw/mirror.ts'

const FIXTURE_MIRROR_ROOT = 'src/ui/PartsChest/__fixtures__/mirror'
const DEFAULT_OUT = 'src/ui/PartsChest/catalog.generated.json'
const MODELS_DIR = 'public/models'
const CONNECTIONS_PATH = 'public/baked/connections.bin'
/** CORS-enabled GitHub mirror of the LDraw parts library — see the header comment. */
const NETWORK_TITLE_BASE = 'https://raw.githubusercontent.com/gkjohnson/ldraw-parts-library/master/complete/ldraw/parts/'
const NETWORK_CONCURRENCY = 16

type Category =
  | 'Bricks'
  | 'Plates'
  | 'Tiles'
  | 'Slopes'
  | 'Wedges'
  | 'Arches'
  | 'Round'
  | 'SNOT'
  | 'Hinges'
  | 'Connectors'
  | 'Technic'
  | 'Wheels'
  | 'Windows & Doors'
  | 'Plants'
  | 'Minifigure'

/**
 * How many of each category's most-used, still-connectable parts make the chest. Sized
 * to land the whole catalog in the same ~450-part, ~5KB-gzipped neighbourhood as before —
 * a product decision about how much of the rail a category may fill, independent of
 * which parts earn a spot inside it.
 */
const CATEGORY_CAPS: Record<Category, number> = {
  Bricks: 52,
  Plates: 48,
  Tiles: 34,
  Slopes: 42,
  Wedges: 22,
  Arches: 24,
  Round: 44,
  SNOT: 24,
  Hinges: 32,
  Connectors: 38,
  Technic: 70,
  Wheels: 30,
  'Windows & Doors': 32,
  Plants: 26,
  Minifigure: 44,
}

/**
 * Parts that resolve and carry connectivity but do not render — kept out of the chest
 * rather than shipped as blank tiles. Add here rather than hand-editing the generated
 * catalog, which a rebuild would overwrite.
 */
const EXCLUDED_PARTS = new Set(['3572', '5850'])

/**
 * Genuinely essential parts the 200-model corpus underrepresents enough that raw usage
 * would leave a category without its most basic shape. Checked against the same
 * connectivity requirement as every other entry — this pins a category, it does not
 * bypass the rule that everything in the chest must snap.
 *
 * Both entries exist because real official sets never place a bare minifig torso or
 * legs: every one they use is a specific character's printed variant, which the
 * `isDecorated` filter correctly drops to keep the category from filling with one-off
 * prints. That leaves zero usage for the plain shape itself, even though a builder
 * assembling a custom minifig needs exactly that — a torso and a pair of legs with no
 * print baked in.
 */
const WHITELIST: readonly { id: string; category: Category }[] = [
  { id: '17', category: 'Minifigure' }, // Minifig Torso with Integral Arms — the plain torso.
  { id: '15', category: 'Minifigure' }, // Minifig Hips and Legs with Integral Legs — the plain legs.
]

/** Line one of a part file, e.g. `0 Brick  2 x  4` — collapsed to single spaces. */
function readTitle(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? ''
  return firstLine.replace(/^0\s*/, '').trim().replace(/\s+/g, ' ')
}

/** LDraw's `~Moved to …` placeholders and `=Alias` redirects — never real geometry. */
function isMovedOrAlias(title: string): boolean {
  return title.startsWith('~') || title.startsWith('=')
}

/** Printed, stickered or logo'd variants of a base shape — a specific character's torso
 * art, a road-sign tile's arrow, a licensed logo. Filtered so a category reads as a set
 * of shapes, not one shape repeated per decoration. One carve-out: "Standard … Pattern"
 * is how the plain minifig head names its own sculpted (not printed) face — the base
 * shape, not a decorated variant of it. */
function isDecorated(title: string): boolean {
  if (/\bStandard\b.*\bPattern\b/i.test(title)) return false
  return /\b(Print|Pattern|Sticker|Logo|Decoration)\b/i.test(title)
}

/**
 * Buckets a real LDraw title into one of the chest's 15 categories. Order matters: each
 * rule is checked in sequence and the first match wins, so more specific patterns
 * (Technic-branded wheels, chain links sold as "Technic Chain Link") are tested ahead of
 * the generic rule they'd otherwise fall into. Validated against the previous 444-part
 * hand-curated catalog: 441/444 agreed, and the three disagreements were the previous
 * catalog's own mistakes (two Technic bushes filed under Plants, a wheel-hub dish filed
 * under Round instead of Wheels) rather than errors here.
 */
function classify(title: string): Category | null {
  const has = (re: RegExp) => re.test(title)

  if (has(/^Bracket\b/i)) return 'SNOT'
  if (has(/\b(Chain|Handle|Handlebars)\b/i)) return 'Connectors'
  if (has(/\b(Wheel|Tyre|Tire)\b/i) || has(/\bwith Rim\b/i)) return 'Wheels'
  if (has(/^Technic\b|\b(Axle|Gear|Liftarm|Buffer|Steering-Gear|with Pin)\b/i)) return 'Technic'
  if (has(/^(Minifig|Bigfig|Duplo Figure|Belville|Scala Figure|Homemaker Figure)\b/i)) return 'Minifigure'
  if (has(/\b(Plant|Flower|Leaves|Leaf|Palm|Vine|Bush|Branch)\b/i)) return 'Plants'
  if (has(/\b(Window|Windscreen|Door)\b/i)) return 'Windows & Doors'
  if (has(/\bArch\b/i)) return 'Arches'
  if (has(/\bHinge\b/i)) return 'Hinges'
  if (has(/\bWedge\b/i)) return 'Wedges'
  if (has(/\bSlope\b/i)) return 'Slopes'
  if (has(/(Stud(s)? on (1 |the )?(\d )?Side)|Jumper|Turntable|Headlight/i)) return 'SNOT'
  if (has(/\b(Clip|Bar|Socket|Hook|Claw)\b/i)) return 'Connectors'
  if (has(/\bTile\b/i) && has(/\b(Round|Ball|Circle)\b/i)) return 'Round'
  if (has(/\bTile\b/i)) return 'Tiles'
  if (has(/\b(Dish|Cone|Cylinder|Dome|Barrel|Round|Sphere|Ball)\b/i)) return 'Round'
  if (has(/\bPlate\b/i)) return 'Plates'
  if (has(/\bBrick\b/i)) return 'Bricks'
  return null
}

/**
 * Counts every leaf part reference across the 200 bundled `.mpd` files — real placements,
 * not just which models happen to include a part. Reuses `parseMpd`, the same parser the
 * running app uses to open a model, rather than a second one: submodel transforms and
 * `0 FILE` splitting are exactly the kind of thing that must not drift between two
 * readers of the same file format.
 */
async function countUsage(): Promise<Map<string, number>> {
  const dir = path.resolve(MODELS_DIR)
  const files = (await fsp.readdir(dir)).filter((f) => f.toLowerCase().endsWith('.mpd'))
  if (files.length === 0) throw new Error(`countUsage: no .mpd files found under ${dir}`)

  const usage = new Map<string, number>()
  for (const file of files) {
    const text = await fsp.readFile(path.join(dir, file), 'utf8')
    const parsed = parseMpd(text, file)
    for (const ref of parsed.refs) usage.set(ref.partId, (usage.get(ref.partId) ?? 0) + 1)
  }
  return usage
}

/**
 * Ids the committed connections bake (`public/baked/connections.bin`) resolves to at
 * least one connection point — the same pool the running app snaps against. A part
 * outside this set cannot connect to anything no matter how often it appears in a model,
 * so membership here is the one non-negotiable filter everything else sits inside.
 */
async function connectablePool(): Promise<Set<string>> {
  const buf = await fsp.readFile(path.resolve(CONNECTIONS_PATH))
  const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  const connections = unpackConnections(arrayBuffer)
  if (connections === null) {
    throw new Error(`connectablePool: could not read ${CONNECTIONS_PATH} — run \`npm run prebake\``)
  }
  const pool = new Set<string>()
  for (const [id, points] of connections) if (points.length > 0) pool.add(id)
  return pool
}

/** Reads whatever `out` already holds, keyed by id — the free, no-I/O title source. */
async function loadExistingTitles(out: string): Promise<Map<string, string>> {
  const titles = new Map<string, string>()
  try {
    const text = await fsp.readFile(out, 'utf8')
    const parsed = JSON.parse(text) as { id: string; title: string }[]
    for (const entry of parsed) titles.set(entry.id, entry.title)
  } catch {
    // No previous catalog, or it doesn't parse — start with nothing cached.
  }
  return titles
}

type TitleSource = 'cached' | 'local' | 'network' | 'placeholder'

interface TitleResolution {
  title: string
  source: TitleSource
}

/** Tries the cache, then the local mirror, then one network request — see the header
 * comment for the full precedence and why each step exists. */
function createTitleResolver(existingTitles: ReadonlyMap<string, string>, readLocal: MirrorReader) {
  return async function resolveTitle(id: string): Promise<TitleResolution> {
    const cached = existingTitles.get(id)
    if (cached !== undefined) return { title: cached, source: 'cached' }

    const local = await readLocal(`${id}.dat`)
    if (local !== null) return { title: readTitle(local), source: 'local' }

    try {
      const response = await fetch(`${NETWORK_TITLE_BASE}${id}.dat`)
      if (response.ok) return { title: readTitle(await response.text()), source: 'network' }
    } catch {
      // Offline, DNS-blocked, or the CDN hiccuped — fall through to the placeholder.
    }
    return { title: `Part ${id}`, source: 'placeholder' }
  }
}

/** Runs `worker` over `items` with at most `concurrency` in flight at once. */
async function runPool<T>(items: readonly T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  async function lane(): Promise<void> {
    while (next < items.length) {
      const item = items[next++]
      await worker(item)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, lane))
}

interface CatalogEntry {
  id: string
  title: string
  category: string
  usageCount: number
}

interface BuildResult {
  catalog: CatalogEntry[]
  warnings: string[]
  /** How each resolved title was found — for the run's summary line. */
  titleStats: { cached: number; local: number; network: number; placeholder: number }
}

async function readCatalog(readLocal: MirrorReader, existingTitles: ReadonlyMap<string, string>): Promise<BuildResult> {
  const usage = await countUsage()
  const pool = await connectablePool()
  const resolveTitle = createTitleResolver(existingTitles, readLocal)
  const warnings: string[] = []
  const titleStats = { cached: 0, local: 0, network: 0, placeholder: 0 }

  // Candidates: every connectable id used at least once in the bundled models, plus
  // anything on the short whitelist (still required to be connectable, see below).
  const candidateIds = new Set<string>()
  for (const id of pool) if ((usage.get(id) ?? 0) > 0) candidateIds.add(id)
  for (const entry of WHITELIST) candidateIds.add(entry.id)
  for (const id of EXCLUDED_PARTS) candidateIds.delete(id)

  const byCategory = new Map<Category, CatalogEntry[]>()

  await runPool([...candidateIds], NETWORK_CONCURRENCY, async (id) => {
    const whitelisted = WHITELIST.find((entry) => entry.id === id)
    if (!pool.has(id)) {
      warnings.push(`whitelisted id ${id} resolves to zero connection points — skipped`)
      return
    }

    const { title, source } = await resolveTitle(id)
    titleStats[source]++
    if (source === 'placeholder') warnings.push(`no title found for ${id} anywhere — used placeholder "${title}"`)

    if (isMovedOrAlias(title)) return
    if (isDecorated(title) && whitelisted === undefined) return
    const category = whitelisted?.category ?? classify(title)
    if (category === null) return

    const entry: CatalogEntry = { id, title, category, usageCount: usage.get(id) ?? 0 }
    const bucket = byCategory.get(category)
    if (bucket === undefined) byCategory.set(category, [entry])
    else bucket.push(entry)
  })

  const isWhitelisted = (entry: CatalogEntry) => WHITELIST.some((w) => w.id === entry.id)

  const catalog: CatalogEntry[] = []
  for (const [category, entries] of byCategory) {
    // Whitelisted entries are guaranteed a seat — that's the whole point of the list —
    // so they sit outside the usage sort and the cap only rations what's left. A
    // category can run slightly over its cap by the number of its own whitelist
    // entries; the cap still governs everything usage-driven.
    const pinned = entries.filter(isWhitelisted)
    const rest = entries
      .filter((entry) => !isWhitelisted(entry))
      .sort((a, b) => b.usageCount - a.usageCount || a.id.localeCompare(b.id, undefined, { numeric: true }))
    const capRemaining = Math.max(0, CATEGORY_CAPS[category] - pinned.length)
    catalog.push(...pinned, ...rest.slice(0, capRemaining))
  }
  return { catalog, warnings, titleStats }
}

interface BuildOptions {
  mirror: string
  out: string
}

async function build(options: BuildOptions): Promise<BuildResult> {
  const existingTitles = await loadExistingTitles(options.out)
  const haveMirror = await mirrorExists(options.mirror)
  const readLocal = createLibraryReader(haveMirror ? options.mirror : FIXTURE_MIRROR_ROOT)
  if (!haveMirror) {
    console.warn(
      `no mirror at ${path.resolve(options.mirror)} — using the committed fixtures at ` +
        `${FIXTURE_MIRROR_ROOT} plus the network title fallback (see this script's header comment).`,
    )
  }

  const result = await readCatalog(readLocal, existingTitles)
  if (result.catalog.length === 0) {
    throw new Error(
      `produced zero catalog entries — every candidate id was excluded, unclassifiable, or had no ` +
        `usable title. Check ${CONNECTIONS_PATH} and ${MODELS_DIR} are present.`,
    )
  }
  return result
}

function parseArgs(argv: string[]): BuildOptions {
  const options: BuildOptions = { mirror: DEFAULT_MIRROR_ROOT, out: DEFAULT_OUT }
  // Run through `tools/run-with-vite.mjs`, `process.argv` still carries that wrapper's
  // own target-path argument ahead of ours (same process, same argv) — skip to the
  // first real flag rather than assuming a fixed offset.
  const start = argv.findIndex((arg) => arg.startsWith('--'))
  const flags = start === -1 ? [] : argv.slice(start)
  for (let i = 0; i < flags.length; i++) {
    const arg = flags[i]
    if (arg === '--mirror') options.mirror = flags[++i]
    else if (arg === '--out') options.out = flags[++i]
    else throw new Error(`unknown argument ${arg}`)
  }
  return options
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))

  let result: BuildResult
  try {
    result = await build(options)
  } catch (error) {
    console.error(`build-chest-catalog failed: ${(error as Error).message}`)
    process.exitCode = 1
    return
  }

  for (const warning of result.warnings) console.warn(`  ${warning}`)

  const sorted = [...result.catalog].sort(
    (a, b) => a.category.localeCompare(b.category) || a.id.localeCompare(b.id, undefined, { numeric: true }),
  )
  await fsp.mkdir(path.dirname(options.out), { recursive: true })
  await fsp.writeFile(options.out, `${JSON.stringify(sorted, null, 2)}\n`)

  const { cached, local, network, placeholder } = result.titleStats
  console.log(
    `wrote ${options.out} — ${sorted.length} parts ` +
      `(titles: ${cached} cached, ${local} local mirror, ${network} network, ${placeholder} placeholder)`,
  )
}

await main()
