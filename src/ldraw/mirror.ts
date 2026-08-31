/**
 * Reading LDraw source files from the local mirror populated by `tools/sync-mirror.ts`.
 *
 * This is what makes the bake offline: a reader with this signature is injected into a parser,
 * which then never knows whether bytes came from disk or from the network.
 *
 * Layout, relative to the mirror root (`.cache/ldraw` by default):
 *
 *   library/    the LDraw parts library — `parts/`, `p/`, `models/`, `LDConfig.ldr`
 *   shadow/     the LDCad shadow library — `parts/`, `p/`
 *   archives/   the downloaded archives and their validators
 *
 * Node-only: build-time code. Nothing in the running application imports it.
 */

/// <reference types="node" />

import fsp from 'node:fs/promises'
import path from 'node:path'

import type { ColorLibrary } from './types.ts'
import { parseColorLibrary, parseLibraryVersion } from './colors.ts'

/** Reads one LDraw reference, returning `null` when the mirror does not have it. */
export type MirrorReader = (relativePath: string) => Promise<string | null>

export const DEFAULT_MIRROR_ROOT = '.cache/ldraw'

/** Reference resolution order, per the LDraw specification. */
export const LIBRARY_SEARCH_PATHS = ['parts', 'p', 'models'] as const

/** The shadow library mirrors the same tree, minus `models/`. */
export const SHADOW_SEARCH_PATHS = ['parts', 'p'] as const

export interface MirrorLayout {
  root: string
  library: string
  shadow: string
  archives: string
}

export function mirrorLayout(root: string = DEFAULT_MIRROR_ROOT): MirrorLayout {
  const resolved = path.resolve(root)
  return {
    root: resolved,
    library: path.join(resolved, 'library'),
    shadow: path.join(resolved, 'shadow'),
    archives: path.join(resolved, 'archives'),
  }
}

/**
 * Normalises an LDraw reference name: backslash separators (`s\3001s01.dat`), redundant `./`,
 * and surrounding whitespace. Returns `null` for anything that escapes the base directory.
 */
export function normalizeReference(reference: string): string | null {
  const slashed = reference.trim().replace(/\\/g, '/').replace(/\/+/g, '/')
  if (slashed === '') return null
  if (slashed.startsWith('/') || /^[a-zA-Z]:/.test(slashed)) return null
  const segments: string[] = []
  for (const segment of slashed.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') return null
    segments.push(segment)
  }
  return segments.length === 0 ? null : segments.join('/')
}

interface ReaderOptions {
  /**
   * Directories searched, in order, when a reference does not resolve as given. Defaults to the
   * LDraw order: `parts/`, `p/`, `models/`.
   */
  searchPaths?: readonly string[]
}

/**
 * Builds a reader rooted at `base`.
 *
 * Resolution tries the reference as given, then each search path in order. Matching is
 * case-insensitive, because part files reference each other with inconsistent case while the
 * mirror is extracted onto whatever the local filesystem does. Directory listings and resolved
 * paths are memoised, so repeated references — and the library is nothing but repeated references
 * to `p/` primitives — cost one lookup each.
 */
export function createFileReader(base: string, options: ReaderOptions = {}): MirrorReader {
  const searchPaths = options.searchPaths ?? LIBRARY_SEARCH_PATHS
  const root = path.resolve(base)
  /** Lowercased entry name to real entry name, per directory. */
  const listings = new Map<string, Promise<Map<string, string> | null>>()
  /** Reference to absolute path, or `null` for a miss. */
  const resolved = new Map<string, Promise<string | null>>()

  function listDirectory(directory: string): Promise<Map<string, string> | null> {
    let listing = listings.get(directory)
    if (listing === undefined) {
      listing = fsp
        .readdir(directory)
        .then((names) => {
          const map = new Map<string, string>()
          for (const name of names) map.set(name.toLowerCase(), name)
          return map
        })
        .catch(() => null)
      listings.set(directory, listing)
    }
    return listing
  }

  /** Walks `relative` segment by segment, falling back to a case-insensitive match. */
  async function resolveWithin(relative: string): Promise<string | null> {
    const segments = relative.split('/')
    let current = root
    for (let i = 0; i < segments.length; i++) {
      const listing = await listDirectory(current)
      if (listing === null) return null
      const actual = listing.get(segments[i].toLowerCase())
      if (actual === undefined) return null
      current = path.join(current, actual)
    }
    return current
  }

  async function locate(reference: string): Promise<string | null> {
    const normalised = normalizeReference(reference)
    if (normalised === null) return null

    const direct = await resolveWithin(normalised)
    if (direct !== null) return direct

    const head = normalised.split('/', 1)[0].toLowerCase()
    for (const searchPath of searchPaths) {
      // `p/stud.dat` must not be retried as `parts/p/stud.dat`.
      if (head === searchPath.toLowerCase()) continue
      const candidate = await resolveWithin(`${searchPath}/${normalised}`)
      if (candidate !== null) return candidate
    }
    return null
  }

  return async function read(relativePath: string): Promise<string | null> {
    let lookup = resolved.get(relativePath)
    if (lookup === undefined) {
      lookup = locate(relativePath)
      resolved.set(relativePath, lookup)
    }
    const file = await lookup
    if (file === null) return null
    try {
      return await fsp.readFile(file, 'utf8')
    } catch {
      return null
    }
  }
}

/** A reader over the LDraw parts library in the mirror. */
export function createLibraryReader(root: string = DEFAULT_MIRROR_ROOT): MirrorReader {
  return createFileReader(mirrorLayout(root).library, { searchPaths: LIBRARY_SEARCH_PATHS })
}

/** A reader over the LDCad shadow library in the mirror. */
export function createShadowReader(root: string = DEFAULT_MIRROR_ROOT): MirrorReader {
  return createFileReader(mirrorLayout(root).shadow, { searchPaths: SHADOW_SEARCH_PATHS })
}

export interface MirrorArchiveMeta {
  url: string
  etag: string | null
  lastModified: string | null
  archiveBytes: number
  fetchedAt: string
  files: number
  extractedBytes: number
  extractedAt: string
}

/** Reads what `sync-mirror` recorded for one archive, or `null` when it has not run. */
export async function readArchiveMeta(
  name: 'complete' | 'shadow',
  root: string = DEFAULT_MIRROR_ROOT,
): Promise<MirrorArchiveMeta | null> {
  const file = path.join(mirrorLayout(root).archives, `${name}.json`)
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8')) as MirrorArchiveMeta
  } catch {
    return null
  }
}

/** `true` when both halves of the mirror are present. */
export async function mirrorExists(root: string = DEFAULT_MIRROR_ROOT): Promise<boolean> {
  const layout = mirrorLayout(root)
  const present = await Promise.all(
    [path.join(layout.library, 'LDConfig.ldr'), layout.shadow].map((target) =>
      fsp.stat(target).then(
        () => true,
        () => false,
      ),
    ),
  )
  return present.every(Boolean)
}

export interface MirrorColors {
  colors: ColorLibrary
  /** The release LDConfig declares, e.g. `2026-05-29`. */
  version: string | null
}

/** Reads and parses `LDConfig.ldr` from the mirror. */
export async function readColorLibrary(root: string = DEFAULT_MIRROR_ROOT): Promise<MirrorColors> {
  const file = path.join(mirrorLayout(root).library, 'LDConfig.ldr')
  const text = await fsp.readFile(file, 'utf8')
  return { colors: parseColorLibrary(text), version: parseLibraryVersion(text) }
}
