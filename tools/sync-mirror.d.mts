/**
 * Ambient declarations for the pure zip-reading functions in `sync-mirror.mjs`, so
 * `src/ldraw/sync-mirror.test.ts` can import them with types. `tools/` is plain JS and outside
 * the app's `tsc` project; this file exists only to satisfy that one cross-boundary import.
 */

export interface ZipEntry {
  name: string
  method: number
  compressedSize: number
  uncompressedSize: number
  localHeaderOffset: number
}

export function findEndOfCentralDirectory(buf: Buffer): number
export function readCentralDirectoryLocation(buf: Buffer): { count: number; offset: number }
export function readZip64Extra(extra: Buffer, entry: ZipEntry): void
export function readZipEntries(buf: Buffer): ZipEntry[]
export function inflateEntry(buf: Buffer, entry: ZipEntry): Buffer
export function safeEntryPath(name: string): string | null
export function commonRoot(entries: ZipEntry[]): string | null
export function extractZip(
  buf: Buffer,
  destination: string,
): { files: number; bytes: number; root: string | null }
