/// <reference types="node" />

import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import type { MirrorReader } from './mirror'
import {
  createLibraryReader,
  createShadowReader,
  mirrorExists,
  mirrorLayout,
  normalizeReference,
  readArchiveMeta,
  readColorLibrary,
} from './mirror'

/**
 * A slice of the real mirror: `parts/3001.dat` and the subpart and primitives it references,
 * plus their shadow files. Captured from `.cache/ldraw`, never fetched at test time.
 */
const MIRROR = fileURLToPath(new URL('./__fixtures__/mirror', import.meta.url))

describe('normalizeReference', () => {
  it('converts LDraw backslash separators', () => {
    expect(normalizeReference('s\\3001s01.dat')).toBe('s/3001s01.dat')
    expect(normalizeReference('48\\4-4cyli.dat')).toBe('48/4-4cyli.dat')
  })

  it('strips redundant separators and whitespace', () => {
    expect(normalizeReference('  ./p//stud.dat ')).toBe('p/stud.dat')
  })

  it('rejects anything escaping the mirror', () => {
    expect(normalizeReference('../../etc/passwd')).toBeNull()
    expect(normalizeReference('/etc/passwd')).toBeNull()
    expect(normalizeReference('C:\\Windows\\system.ini')).toBeNull()
    expect(normalizeReference('  ')).toBeNull()
  })
})

describe('createLibraryReader', () => {
  const read: MirrorReader = createLibraryReader(MIRROR)

  it('resolves a bare part name through parts/', async () => {
    const text = await read('3001.dat')
    expect(text).toContain('Brick  2 x  4')
  })

  it('resolves a bare primitive name through p/', async () => {
    const text = await read('stud.dat')
    expect(text).toContain('0 Stud')
  })

  it('resolves a path given with its search directory', async () => {
    expect(await read('p/stud.dat')).toBe(await read('stud.dat'))
    expect(await read('parts/3001.dat')).toBe(await read('3001.dat'))
  })

  it('resolves a subpart reference written with a backslash', async () => {
    const text = await read('s\\3001s01.dat')
    expect(text).toContain('0 ~Brick  2 x  4 without Front and Back Faces')
  })

  it('matches case-insensitively', async () => {
    expect(await read('3001.DAT')).toBe(await read('3001.dat'))
    expect(await read('S\\3001S01.DAT')).toBe(await read('s\\3001s01.dat'))
    expect(await read('ldconfig.ldr')).toContain('LDraw.org Configuration File')
  })

  it('returns null for a reference the mirror does not have', async () => {
    expect(await read('9999999.dat')).toBeNull()
  })

  it('returns null rather than escaping the mirror root', async () => {
    expect(await read('../../../package.json')).toBeNull()
  })

  it('serves repeated references from cache', async () => {
    const [a, b] = await Promise.all([read('stud.dat'), read('stud.dat')])
    expect(a).toBe(b)
  })
})

describe('createShadowReader', () => {
  const read: MirrorReader = createShadowReader(MIRROR)

  it('reads the annotation on a primitive', async () => {
    const text = await read('stud.dat')
    expect(text).toContain('0 !LDCAD SNAP_CYL [ID=studC] [gender=M] [caps=one] [secs=R 6 4]')
  })

  it('reads the annotation on a subpart', async () => {
    const text = await read('s\\3001s01.dat')
    expect(text).toContain('SNAP_CYL')
    expect(text).toContain('grid=')
  })

  it('returns null for a part the shadow library does not cover', async () => {
    // 3001's sockets live on its subpart, so 3001.dat itself has no shadow file at all.
    expect(await read('3001.dat')).toBeNull()
    expect(await read('4070.dat')).toBeNull()
  })

  it('does not resolve through models/', async () => {
    expect(await read('LDConfig.ldr')).toBeNull()
  })
})

describe('mirror layout', () => {
  it('places the two libraries and the archives under the root', () => {
    const layout = mirrorLayout('/tmp/mirror')
    expect(layout).toEqual({
      root: '/tmp/mirror',
      library: '/tmp/mirror/library',
      shadow: '/tmp/mirror/shadow',
      archives: '/tmp/mirror/archives',
    })
  })

  it('reports a populated mirror', async () => {
    expect(await mirrorExists(MIRROR)).toBe(true)
    expect(await mirrorExists(`${MIRROR}/nowhere`)).toBe(false)
  })

  it('returns null archive metadata when sync-mirror has not run', async () => {
    expect(await readArchiveMeta('complete', MIRROR)).toBeNull()
  })

  it('reads the color library from the mirror', async () => {
    const { colors, version } = await readColorLibrary(MIRROR)
    expect(version).toBe('2026-05-29')
    expect(colors.get(4)).toMatchObject({ name: 'Red' })
    expect(colors.get(16)).toBeDefined()
  })
})
