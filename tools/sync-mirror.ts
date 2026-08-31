#!/usr/bin/env node
/**
 * Populates the local upstream mirror in `.cache/ldraw/`.
 *
 * Two bulk archives, one conditional request each. Never crawls per-file APIs: the same bytes
 * would cost tens of thousands of requests against volunteer-run infrastructure. `ETag` and
 * `Last-Modified` are stored beside each archive, so later runs stop at `304`.
 *
 * Layout produced:
 *
 *   .cache/ldraw/archives/<name>.zip        the downloaded archive
 *   .cache/ldraw/archives/<name>.json       etag, last-modified, size, extracted file count
 *   .cache/ldraw/library/                   complete.zip, top-level `ldraw/` stripped
 *   .cache/ldraw/shadow/                    shadow library, top-level directory stripped
 *
 * Usage: node tools/sync-mirror.ts [--force] [--cache <dir>]
 */

import fs, { createWriteStream } from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import zlib from 'node:zlib'

interface Archive {
  name: string
  label: string
  url: string
  dest: string
}

const ARCHIVES: Archive[] = [
  {
    name: 'complete',
    label: 'LDraw parts library',
    url: 'https://library.ldraw.org/library/updates/complete.zip',
    dest: 'library',
  },
  {
    name: 'shadow',
    label: 'LDCad shadow library',
    url: 'https://github.com/RolandMelkert/LDCadShadowLibrary/archive/refs/heads/main.zip',
    dest: 'shadow',
  },
]

// ---------------------------------------------------------------------------
// Minimal zip reader — central directory + raw inflate, Node built-ins only.
// ---------------------------------------------------------------------------

const SIG_EOCD = 0x06054b50
const SIG_EOCD64_LOCATOR = 0x07064b50
const SIG_EOCD64 = 0x06064b50
const SIG_CENTRAL = 0x02014b50
const SIG_LOCAL = 0x04034b50

/** One central-directory record: enough to locate and inflate the entry's data. */
export interface ZipEntry {
  name: string
  method: number
  compressedSize: number
  uncompressedSize: number
  localHeaderOffset: number
}

export function findEndOfCentralDirectory(buf: Buffer): number {
  const min = Math.max(0, buf.length - 0x10000 - 22)
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) return i
  }
  throw new Error('not a zip archive: end of central directory not found')
}

/** Returns `{ count, offset }` for the central directory, resolving zip64 when present. */
export function readCentralDirectoryLocation(buf: Buffer): { count: number; offset: number } {
  const eocd = findEndOfCentralDirectory(buf)
  let count = buf.readUInt16LE(eocd + 10)
  let offset = buf.readUInt32LE(eocd + 16)

  if (count === 0xffff || offset === 0xffffffff) {
    const locator = eocd - 20
    if (locator < 0 || buf.readUInt32LE(locator) !== SIG_EOCD64_LOCATOR) {
      throw new Error('zip64 archive without an end-of-central-directory locator')
    }
    const eocd64 = Number(buf.readBigUInt64LE(locator + 8))
    if (buf.readUInt32LE(eocd64) !== SIG_EOCD64) {
      throw new Error('zip64 end of central directory not found')
    }
    count = Number(buf.readBigUInt64LE(eocd64 + 32))
    offset = Number(buf.readBigUInt64LE(eocd64 + 48))
  }
  return { count, offset }
}

/** Pulls sizes and the local-header offset out of a zip64 extended information extra field. */
export function readZip64Extra(extra: Buffer, entry: ZipEntry): void {
  let p = 0
  while (p + 4 <= extra.length) {
    const id = extra.readUInt16LE(p)
    const size = extra.readUInt16LE(p + 2)
    let q = p + 4
    if (id === 0x0001) {
      if (entry.uncompressedSize === 0xffffffff && q + 8 <= extra.length) {
        entry.uncompressedSize = Number(extra.readBigUInt64LE(q))
        q += 8
      }
      if (entry.compressedSize === 0xffffffff && q + 8 <= extra.length) {
        entry.compressedSize = Number(extra.readBigUInt64LE(q))
        q += 8
      }
      if (entry.localHeaderOffset === 0xffffffff && q + 8 <= extra.length) {
        entry.localHeaderOffset = Number(extra.readBigUInt64LE(q))
      }
      return
    }
    p += 4 + size
  }
}

/** Reads the central directory of a zip held entirely in memory. */
export function readZipEntries(buf: Buffer): ZipEntry[] {
  const { count, offset } = readCentralDirectoryLocation(buf)
  const entries: ZipEntry[] = []
  let p = offset
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== SIG_CENTRAL) {
      throw new Error(`corrupt central directory at entry ${i}`)
    }
    const method = buf.readUInt16LE(p + 10)
    const nameLength = buf.readUInt16LE(p + 28)
    const extraLength = buf.readUInt16LE(p + 30)
    const commentLength = buf.readUInt16LE(p + 32)
    const entry: ZipEntry = {
      name: buf.toString('utf8', p + 46, p + 46 + nameLength),
      method,
      compressedSize: buf.readUInt32LE(p + 20),
      uncompressedSize: buf.readUInt32LE(p + 24),
      localHeaderOffset: buf.readUInt32LE(p + 42),
    }
    if (extraLength > 0) {
      readZip64Extra(buf.subarray(p + 46 + nameLength, p + 46 + nameLength + extraLength), entry)
    }
    entries.push(entry)
    p += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

export function inflateEntry(buf: Buffer, entry: ZipEntry): Buffer {
  const head = entry.localHeaderOffset
  if (head < 0 || head + 30 > buf.length || buf.readUInt32LE(head) !== SIG_LOCAL) {
    throw new Error(`corrupt local header for ${entry.name}`)
  }
  const nameLength = buf.readUInt16LE(head + 26)
  const extraLength = buf.readUInt16LE(head + 28)
  const start = head + 30 + nameLength + extraLength
  const end = start + entry.compressedSize
  if (start > buf.length || end > buf.length) {
    throw new Error(
      `truncated archive: entry ${entry.name} claims ${entry.compressedSize} compressed bytes ` +
        `at offset ${start}, but the archive is only ${buf.length} bytes`,
    )
  }
  const data = buf.subarray(start, end)
  if (entry.method === 0) return data
  if (entry.method === 8) {
    try {
      return zlib.inflateRawSync(data)
    } catch (error) {
      throw new Error(`corrupt entry ${entry.name}: ${(error as Error).message}`)
    }
  }
  throw new Error(`unsupported compression method ${entry.method} for ${entry.name}`)
}

/** Rejects absolute paths and traversal, and normalises separators. */
export function safeEntryPath(name: string): string | null {
  const normalised = name.replace(/\\/g, '/')
  if (normalised.startsWith('/') || /^[a-zA-Z]:/.test(normalised)) return null
  if (normalised.split('/').some((segment) => segment === '..')) return null
  return normalised
}

/**
 * The single top-level directory shared by every entry that has one, or `null` when two
 * entries disagree. A stray top-level *file* (a `README.txt` beside the real root, say) is
 * ignored rather than treated as a competing root — but two genuine directories with
 * different names must not be silently flattened into each other, so any real disagreement
 * strips nothing.
 */
export function commonRoot(entries: ZipEntry[]): string | null {
  let root: string | null = null
  for (const entry of entries) {
    const slash = entry.name.indexOf('/')
    if (slash <= 0) continue // stray top-level file: ignore, don't veto
    const head = entry.name.slice(0, slash)
    if (root === null) root = head
    else if (root !== head) return null // no single shared root: strip nothing
  }
  return root
}

/** Extracts every file entry into `destination`, stripping a shared top-level directory. */
export function extractZip(
  buf: Buffer,
  destination: string,
): { files: number; bytes: number; root: string | null } {
  const entries = readZipEntries(buf)
  const root = commonRoot(entries)
  const prefix = root === null ? '' : `${root}/`
  const created = new Set<string>()
  let files = 0
  let bytes = 0

  for (const entry of entries) {
    if (entry.name.endsWith('/')) continue
    const relative = safeEntryPath(entry.name)
    if (relative === null) {
      console.warn(`  skipping unsafe entry ${entry.name}`)
      continue
    }
    const stripped = relative.startsWith(prefix) ? relative.slice(prefix.length) : relative
    if (stripped === '') continue

    const target = path.join(destination, stripped)
    const dir = path.dirname(target)
    if (!created.has(dir)) {
      fs.mkdirSync(dir, { recursive: true })
      created.add(dir)
    }
    const data = inflateEntry(buf, entry)
    fs.writeFileSync(target, data)
    files++
    bytes += data.length
  }
  return { files, bytes, root }
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

async function readJson(file: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8'))
  } catch {
    return null
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    await fsp.stat(file)
    return true
  } catch {
    return false
  }
}

/** Streams a response body to disk, reporting progress against `Content-Length`. */
async function download(response: Response, file: string): Promise<number> {
  const total = Number(response.headers.get('content-length')) || 0
  const partial = `${file}.part`
  let received = 0
  let lastReport = 0

  const source = Readable.fromWeb(response.body as import('node:stream/web').ReadableStream)
  source.on('data', (chunk: Buffer) => {
    received += chunk.length
    const now = Date.now()
    if (now - lastReport > 1000) {
      lastReport = now
      const pct = total > 0 ? ` (${((received / total) * 100).toFixed(0)}%)` : ''
      process.stdout.write(`  downloaded ${formatBytes(received)}${pct}\n`)
    }
  })
  await pipeline(source, createWriteStream(partial))
  await fsp.rename(partial, file)
  return received
}

interface SyncOptions {
  cache: string
  force: boolean
  help?: boolean
}

interface SyncResult {
  name: string
  downloaded: boolean
  meta: Record<string, unknown> | null
}

async function syncArchive(archive: Archive, options: SyncOptions): Promise<SyncResult> {
  const archiveDir = path.join(options.cache, 'archives')
  const zipFile = path.join(archiveDir, `${archive.name}.zip`)
  const metaFile = path.join(archiveDir, `${archive.name}.json`)
  const destination = path.join(options.cache, archive.dest)

  await fsp.mkdir(archiveDir, { recursive: true })
  const meta = options.force ? null : await readJson(metaFile)
  const haveZip = await exists(zipFile)
  const haveExtract = await exists(destination)

  console.log(`${archive.label}`)
  console.log(`  ${archive.url}`)

  const headers: Record<string, string> = {}
  if (meta && haveZip) {
    if (typeof meta.etag === 'string') headers['if-none-match'] = meta.etag
    if (typeof meta.lastModified === 'string') headers['if-modified-since'] = meta.lastModified
  }

  const response = await fetch(archive.url, { headers, redirect: 'follow' })

  if (response.status === 304) {
    await response.body?.cancel()
    if (haveExtract) {
      console.log(`  304 Not Modified — skipped, mirror is current`)
      return { name: archive.name, downloaded: false, meta }
    }
    console.log(`  304 Not Modified — re-extracting the stored archive`)
    const stats = await extractInto(zipFile, destination)
    const nextMeta = { ...meta, ...stats }
    await writeMeta(metaFile, nextMeta)
    return { name: archive.name, downloaded: false, meta: nextMeta }
  }

  if (!response.ok) {
    throw new Error(`${archive.url} responded ${response.status} ${response.statusText}`)
  }

  console.log(`  ${response.status} — downloading`)
  const size = await download(response, zipFile)
  console.log(`  downloaded ${formatBytes(size)}`)

  const stats = await extractInto(zipFile, destination)
  const next = {
    url: archive.url,
    etag: response.headers.get('etag') ?? null,
    lastModified: response.headers.get('last-modified') ?? null,
    archiveBytes: size,
    fetchedAt: new Date().toISOString(),
    ...stats,
  }
  await writeMeta(metaFile, next)
  return { name: archive.name, downloaded: true, meta: next }
}

async function writeMeta(file: string, meta: Record<string, unknown>): Promise<void> {
  await fsp.writeFile(file, `${JSON.stringify(meta, null, 2)}\n`)
}

/**
 * Extracts to a sibling temporary directory and swaps it in, so a failed extraction never
 * leaves a half-populated mirror behind.
 */
async function extractInto(
  zipFile: string,
  destination: string,
): Promise<{ files: number; extractedBytes: number; extractedAt: string }> {
  const staging = `${destination}.incoming`
  await fsp.rm(staging, { recursive: true, force: true })
  await fsp.mkdir(staging, { recursive: true })

  const buf = await fsp.readFile(zipFile)
  const started = Date.now()
  const { files, bytes, root } = extractZip(buf, staging)

  const previous = `${destination}.previous`
  await fsp.rm(previous, { recursive: true, force: true })
  if (await exists(destination)) await fsp.rename(destination, previous)
  await fsp.rename(staging, destination)
  await fsp.rm(previous, { recursive: true, force: true })

  const seconds = ((Date.now() - started) / 1000).toFixed(1)
  console.log(
    `  extracted ${files.toLocaleString()} files (${formatBytes(bytes)}) in ${seconds}s` +
      `${root ? ` — stripped '${root}/'` : ''}`,
  )
  return { files, extractedBytes: bytes, extractedAt: new Date().toISOString() }
}

function parseArgs(argv: string[]): SyncOptions {
  const options: SyncOptions = { cache: path.resolve('.cache/ldraw'), force: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--force') options.force = true
    else if (arg === '--cache') options.cache = path.resolve(argv[++i])
    else if (arg === '--help' || arg === '-h') options.help = true
    else throw new Error(`unknown argument ${arg}`)
  }
  return options
}

const USAGE = `Usage: node tools/sync-mirror.ts [options]

  --cache <dir>   mirror location (default .cache/ldraw)
  --force         ignore stored validators and re-download
  --help          show this message

Two bulk archives, one conditional request each. Never run on a loop.
`

export async function main(): Promise<void> {
  let options: SyncOptions
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

  await fsp.mkdir(options.cache, { recursive: true })
  console.log(`Mirror: ${options.cache}\n`)

  const results: SyncResult[] = []
  for (const archive of ARCHIVES) {
    results.push(await syncArchive(archive, options))
    console.log('')
  }

  const downloaded = results.filter((r) => r.downloaded).map((r) => r.name)
  const skipped = results.filter((r) => !r.downloaded).map((r) => r.name)
  console.log(`downloaded: ${downloaded.length ? downloaded.join(', ') : 'nothing'}`)
  console.log(`skipped (304): ${skipped.length ? skipped.join(', ') : 'nothing'}`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
