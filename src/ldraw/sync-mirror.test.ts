/// <reference types="node" />

import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  commonRoot,
  extractZip,
  inflateEntry,
  readCentralDirectoryLocation,
  readZipEntries,
  safeEntryPath,
} from '../../tools/sync-mirror.ts'

// ---------------------------------------------------------------------------
// Hand-built zips. No archiver dependency: this writes the same central-directory
// + local-header bytes `sync-mirror.ts` reads, entry by entry, so the fixture can
// be corrupted precisely for the failure-path tests.
// ---------------------------------------------------------------------------

const SIG_LOCAL = 0x04034b50
const SIG_CENTRAL = 0x02014b50
const SIG_EOCD = 0x06054b50
const SIG_EOCD64 = 0x06064b50
const SIG_EOCD64_LOCATOR = 0x07064b50
const METHOD_STORE = 0
const METHOD_DEFLATE = 8

interface RawEntry {
  name: string
  method: number
  data: Buffer
  uncompressedSize: number
  /** Overrides the compressed-size field written into both headers, for corruption tests. */
  compressedSizeOverride?: number
  /** Overrides the size field with the zip64 sentinel plus a zip64 extra field. */
  zip64: boolean
}

function entry(name: string, content: string, opts: { deflate?: boolean; zip64?: boolean } = {}): RawEntry {
  const uncompressed = Buffer.from(content, 'utf8')
  const method = opts.deflate ? METHOD_DEFLATE : METHOD_STORE
  const data = opts.deflate ? zlib.deflateRawSync(uncompressed) : uncompressed
  return { name, method, data, uncompressedSize: uncompressed.length, zip64: opts.zip64 ?? false }
}

/** Builds a minimal, valid zip from raw entries. Returns the buffer and each entry's central-directory offset. */
function buildZip(entries: RawEntry[]) {
  const localChunks: Buffer[] = []
  const localOffsets: number[] = []
  let cursor = 0

  for (const e of entries) {
    localOffsets.push(cursor)
    const nameBuf = Buffer.from(e.name, 'utf8')
    const compressedSize = e.compressedSizeOverride ?? e.data.length
    const header = Buffer.alloc(30)
    header.writeUInt32LE(SIG_LOCAL, 0)
    header.writeUInt16LE(20, 4) // version needed
    header.writeUInt16LE(0, 6) // flags
    header.writeUInt16LE(e.method, 8)
    header.writeUInt16LE(0, 10) // mod time
    header.writeUInt16LE(0, 12) // mod date
    header.writeUInt32LE(0, 14) // crc32 — unchecked by the reader
    header.writeUInt32LE(e.zip64 ? 0xffffffff : compressedSize, 18)
    header.writeUInt32LE(e.zip64 ? 0xffffffff : e.uncompressedSize, 22)
    header.writeUInt16LE(nameBuf.length, 26)
    header.writeUInt16LE(0, 28) // no local extra field needed for these tests
    const chunk = Buffer.concat([header, nameBuf, e.data])
    localChunks.push(chunk)
    cursor += chunk.length
  }

  const centralChunks: Buffer[] = []
  const centralOffsets: number[] = []
  let centralCursor = 0
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    const nameBuf = Buffer.from(e.name, 'utf8')
    const compressedSize = e.compressedSizeOverride ?? e.data.length
    const zip64Extra = e.zip64
      ? (() => {
          const extra = Buffer.alloc(4 + 16)
          extra.writeUInt16LE(0x0001, 0)
          extra.writeUInt16LE(16, 2)
          extra.writeBigUInt64LE(BigInt(e.uncompressedSize), 4)
          extra.writeBigUInt64LE(BigInt(compressedSize), 12)
          return extra
        })()
      : Buffer.alloc(0)

    const header = Buffer.alloc(46)
    header.writeUInt32LE(SIG_CENTRAL, 0)
    header.writeUInt16LE(20, 4) // version made by
    header.writeUInt16LE(20, 6) // version needed
    header.writeUInt16LE(0, 8) // flags
    header.writeUInt16LE(e.method, 10)
    header.writeUInt16LE(0, 12) // mod time
    header.writeUInt16LE(0, 14) // mod date
    header.writeUInt32LE(0, 16) // crc32
    header.writeUInt32LE(e.zip64 ? 0xffffffff : compressedSize, 20)
    header.writeUInt32LE(e.zip64 ? 0xffffffff : e.uncompressedSize, 24)
    header.writeUInt16LE(nameBuf.length, 28)
    header.writeUInt16LE(zip64Extra.length, 30)
    header.writeUInt16LE(0, 32) // comment length
    header.writeUInt16LE(0, 34) // disk number start
    header.writeUInt16LE(0, 36) // internal attrs
    header.writeUInt32LE(0, 38) // external attrs
    header.writeUInt32LE(localOffsets[i], 42)
    const chunk = Buffer.concat([header, nameBuf, zip64Extra])
    centralOffsets.push(centralCursor)
    centralChunks.push(chunk)
    centralCursor += chunk.length
  }

  const localSection = Buffer.concat(localChunks)
  const centralSection = Buffer.concat(centralChunks)
  const centralOffset = localSection.length

  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(SIG_EOCD, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralSection.length, 12)
  eocd.writeUInt32LE(centralOffset, 16)
  eocd.writeUInt16LE(0, 20)

  const buf = Buffer.concat([localSection, centralSection, eocd])
  // Absolute offset of each entry's central-directory record, so a test can corrupt
  // a specific field (e.g. the compressed-size at record offset + 20).
  const absoluteCentralOffsets = centralOffsets.map((o) => centralOffset + o)
  return { buf, centralOffset, absoluteCentralOffsets }
}

/** Builds a zip whose EOCD claims a zip64 record even though the archive is tiny — exercises the locator path. */
function buildZip64LocatorZip(entries: RawEntry[]) {
  const built = buildZip(entries)
  const eocdOffset = built.buf.length - 22

  const eocd64 = Buffer.alloc(56)
  eocd64.writeUInt32LE(SIG_EOCD64, 0)
  eocd64.writeBigUInt64LE(44n, 4) // size of remaining record
  eocd64.writeUInt16LE(45, 12) // version made by
  eocd64.writeUInt16LE(45, 14) // version needed
  eocd64.writeUInt32LE(0, 16)
  eocd64.writeUInt32LE(0, 20)
  eocd64.writeBigUInt64LE(BigInt(entries.length), 24)
  eocd64.writeBigUInt64LE(BigInt(entries.length), 32)
  const centralSize = built.buf.length - 22 - built.centralOffset
  eocd64.writeBigUInt64LE(BigInt(centralSize), 40)
  eocd64.writeBigUInt64LE(BigInt(built.centralOffset), 48)

  const locator = Buffer.alloc(20)
  locator.writeUInt32LE(SIG_EOCD64_LOCATOR, 0)
  locator.writeUInt32LE(0, 4)
  locator.writeBigUInt64LE(BigInt(eocdOffset), 8)
  locator.writeUInt32LE(1, 16)

  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(SIG_EOCD, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(0xffff, 8) // sentinel — forces the zip64 lookup
  eocd.writeUInt16LE(0xffff, 10)
  eocd.writeUInt32LE(0xffffffff, 12)
  eocd.writeUInt32LE(0xffffffff, 16)
  eocd.writeUInt16LE(0, 20)

  const withoutEocd = built.buf.subarray(0, eocdOffset)
  const buf = Buffer.concat([withoutEocd, eocd64, locator, eocd])
  return buf
}

let workdir: string

beforeEach(() => {
  workdir = mkdtempSync(path.join(tmpdir(), 'sync-mirror-test-'))
})

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true })
})

/** Every file path actually written under `dir`, relative to it, forward-slashed. */
function listFiles(dir: string): string[] {
  const out: string[] = []
  const walk = (d: string, prefix: string) => {
    for (const name of readdirSync(d, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${name.name}` : name.name
      if (name.isDirectory()) walk(path.join(d, name.name), rel)
      else out.push(rel)
    }
  }
  try {
    walk(dir, '')
  } catch {
    // directory doesn't exist — no files
  }
  return out.sort()
}

describe('safeEntryPath', () => {
  it('rejects absolute unix paths', () => {
    expect(safeEntryPath('/etc/passwd')).toBeNull()
  })

  it('rejects relative traversal', () => {
    expect(safeEntryPath('../../etc/passwd')).toBeNull()
    expect(safeEntryPath('good/../../evil.txt')).toBeNull()
    expect(safeEntryPath('..')).toBeNull()
  })

  it('rejects windows drive-letter paths', () => {
    expect(safeEntryPath('C:\\Windows\\system.ini')).toBeNull()
  })

  it('rejects traversal written with backslashes', () => {
    expect(safeEntryPath('..\\..\\evil.txt')).toBeNull()
    expect(safeEntryPath('good\\..\\..\\evil.txt')).toBeNull()
  })

  it('accepts and normalises an ordinary nested path', () => {
    expect(safeEntryPath('parts\\3001.dat')).toBe('parts/3001.dat')
    expect(safeEntryPath('parts/3001.dat')).toBe('parts/3001.dat')
  })
})

describe('extractZip — path traversal', () => {
  it('writes safe entries and skips every malicious one, none escaping the destination', () => {
    // Deliberately no shared top-level directory here: mixing traversal-check fixtures with
    // commonRoot's root-stripping is covered separately below (a malicious entry's own
    // fabricated head, e.g. '..' from '../../etc/passwd', must not interact with stripping
    // decisions for legitimate entries).
    const zip = buildZip([
      entry('good.txt', 'fine'),
      entry('../../etc/passwd', 'evil'),
      entry('/etc/passwd', 'evil'),
      entry('C:\\Windows\\system.ini', 'evil'),
      entry('good/../../evil.txt', 'evil'),
      entry('..', 'evil'),
      entry('..\\..\\evil.txt', 'evil'),
    ])
    const destination = path.join(workdir, 'dest')
    const result = extractZip(zip.buf, destination)

    // Only the one safe entry.
    expect(listFiles(destination)).toEqual(['good.txt'])
    expect(result.files).toBe(1)
    expect(readFileSync(path.join(destination, 'good.txt'), 'utf8')).toBe('fine')

    // Nothing landed anywhere outside the destination directory.
    expect(listFiles(workdir)).toEqual(['dest/good.txt'])
  })
})

describe('extractZip — zip64', () => {
  it('extracts an entry whose sizes are carried in a zip64 extra field', () => {
    const content = 'zip64 entry content'.repeat(5)
    const zip = buildZip([entry('root/big.dat', content, { zip64: true })])
    const destination = path.join(workdir, 'dest')
    const result = extractZip(zip.buf, destination)

    expect(result.files).toBe(1)
    expect(readFileSync(path.join(destination, 'big.dat'), 'utf8')).toBe(content)
  })

  it('resolves the central directory through an EOCD64 record and locator', () => {
    const zip = buildZip64LocatorZip([entry('root/a.dat', 'hello')])
    const { count, offset } = readCentralDirectoryLocation(zip)
    expect(count).toBe(1)

    const entries = readZipEntries(zip)
    expect(entries).toHaveLength(1)
    expect(entries[0].name).toBe('root/a.dat')

    const destination = path.join(workdir, 'dest')
    const result = extractZip(zip, destination)
    expect(result.files).toBe(1)
    expect(readFileSync(path.join(destination, 'a.dat'), 'utf8')).toBe('hello')
    void offset
  })
})

describe('extractZip — corrupt or truncated entries', () => {
  it('fails with a clear message when an entry claims more compressed bytes than the archive has', () => {
    const zip = buildZip([entry('root/a.dat', 'hello world')])
    // Lie about the compressed size in the central directory, as a truncated download would
    // effectively do: the entry now claims data that runs past the end of the buffer.
    const centralOffset = zip.absoluteCentralOffsets[0]
    zip.buf.writeUInt32LE(zip.buf.length + 1000, centralOffset + 20)

    expect(() => extractZip(zip.buf, path.join(workdir, 'dest'))).toThrow(/truncated archive/)
  })

  it('fails with a clear message when a deflate entry is corrupt', () => {
    const zip = buildZip([entry('root/a.dat', 'hello world, this is deflated content', { deflate: true })])
    const entries = readZipEntries(zip.buf)
    const target = entries[0]
    // Scramble the compressed bytes in place without changing their length, so the size
    // fields stay consistent and only the deflate stream itself is broken.
    const nameLength = zip.buf.readUInt16LE(target.localHeaderOffset + 26)
    const dataStart = target.localHeaderOffset + 30 + nameLength
    for (let i = 0; i < target.compressedSize; i++) {
      zip.buf[dataStart + i] = 0xff
    }

    expect(() => inflateEntry(zip.buf, target)).toThrow(/corrupt entry/)
    expect(() => extractZip(zip.buf, path.join(workdir, 'dest'))).toThrow(/corrupt entry/)
  })

  it('fails with a clear message when the local header offset itself is bogus', () => {
    const zip = buildZip([entry('root/a.dat', 'hello')])
    const entries = readZipEntries(zip.buf)
    const target = { ...entries[0], localHeaderOffset: zip.buf.length + 10 }
    expect(() => inflateEntry(zip.buf, target)).toThrow(/corrupt local header/)
  })
})

describe('commonRoot — a stray top-level file does not veto the shared root', () => {
  it('still strips the shared root when one stray top-level entry has none', () => {
    const entries = readZipEntries(
      buildZip([
        entry('shared-root/parts/3001.dat', 'part data'),
        entry('shared-root/p/stud.dat', 'primitive data'),
        entry('README.txt', 'stray top-level file'),
      ]).buf,
    )
    expect(commonRoot(entries)).toBe('shared-root')
  })

  it('extracts the shared-root entries stripped and the stray entry unstripped', () => {
    const zip = buildZip([
      entry('shared-root/parts/3001.dat', 'part data'),
      entry('shared-root/p/stud.dat', 'primitive data'),
      entry('README.txt', 'stray top-level file'),
    ])
    const destination = path.join(workdir, 'dest')
    const result = extractZip(zip.buf, destination)

    expect(result.root).toBe('shared-root')
    expect(listFiles(destination)).toEqual(['README.txt', 'p/stud.dat', 'parts/3001.dat'])
    expect(readFileSync(path.join(destination, 'README.txt'), 'utf8')).toBe('stray top-level file')
    expect(readFileSync(path.join(destination, 'parts/3001.dat'), 'utf8')).toBe('part data')
  })
})

describe('commonRoot — two genuine, disagreeing roots strip nothing', () => {
  it('returns null rather than picking a winner', () => {
    const entries = readZipEntries(
      buildZip([
        entry('parts/3001.dat', 'part data'),
        entry('parts/3002.dat', 'part data'),
        entry('parts/3003.dat', 'part data'),
        entry('p/stud.dat', 'primitive data'),
      ]).buf,
    )
    // 'parts' has three entries and 'p' has one — a "most common wins" policy would pick
    // 'parts' and silently flatten it while leaving 'p' alone. That's wrong: an archive with
    // two real content roots and no shared parent must be left unstripped rather than mangled.
    expect(commonRoot(entries)).toBeNull()
  })

  it('extracts every entry at its own un-stripped path', () => {
    const zip = buildZip([
      entry('parts/3001.dat', 'part data'),
      entry('p/stud.dat', 'primitive data'),
    ])
    const destination = path.join(workdir, 'dest')
    const result = extractZip(zip.buf, destination)

    expect(result.root).toBeNull()
    expect(listFiles(destination)).toEqual(['p/stud.dat', 'parts/3001.dat'])
  })
})
