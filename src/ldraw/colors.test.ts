/// <reference types="node" />

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  EDGE_COLOR_CODE,
  INHERIT_COLOR_CODE,
  isSentinelCode,
  parseColorLibrary,
  parseLibraryVersion,
} from './colors'

/** The real LDConfig.ldr, captured from the mirror. Never fetched at test time. */
const LDCONFIG = readFileSync(
  fileURLToPath(new URL('./__fixtures__/mirror/library/LDConfig.ldr', import.meta.url)),
  'utf8',
)

describe('parseColorLibrary, against the real LDConfig.ldr', () => {
  const colors = parseColorLibrary(LDCONFIG)

  it('parses every declared colour', () => {
    const declared = LDCONFIG.split(/\r?\n/).filter((line) =>
      line.trim().startsWith('0 !COLOUR'),
    ).length
    expect(declared).toBe(322)
    expect(colors.size).toBe(322)
  })

  it('reads a solid colour exactly', () => {
    expect(colors.get(0)).toEqual({
      code: 0,
      name: 'Black',
      value: 0x1b2a34,
      edge: 0x808080,
      material: 'solid',
    })
    expect(colors.get(4)).toMatchObject({ name: 'Red', value: 0xb40000, material: 'solid' })
  })

  it('reads alpha and classes the colour transparent', () => {
    expect(colors.get(47)).toEqual({
      code: 47,
      name: 'Trans_Clear',
      value: 0xfcfcfc,
      edge: 0xc9c9c9,
      alpha: 128,
      material: 'transparent',
    })
  })

  it('omits alpha for opaque colours', () => {
    expect(colors.get(0)?.alpha).toBeUndefined()
    expect(colors.get(0)?.luminance).toBeUndefined()
  })

  it('reads luminance where a colour declares it', () => {
    expect(colors.get(21)).toMatchObject({ name: 'Glow_In_Dark_Opaque', alpha: 245, luminance: 15 })
  })

  it('classes finishes', () => {
    expect(colors.get(334)?.material).toBe('chrome') // Chrome_Gold
    expect(colors.get(297)?.material).toBe('pearlescent') // Pearl_Gold
    expect(colors.get(80)?.material).toBe('metallic') // Metallic_Silver, METAL
    expect(colors.get(20000)).toMatchObject({
      name: 'Canvas_Black',
      value: 0x1b2a34,
      material: 'fabric',
    }) // MATERIAL FABRIC CANVAS
    expect(colors.get(20001)?.material).toBe('fabric') // Canvas_Blue
    expect(colors.get(256)?.material).toBe('rubber') // Rubber_Black
    expect(colors.get(133)?.material).toBe('speckle') // Speckle_Black_Gold
  })

  it('lets a finish beat transparency', () => {
    const glitter = colors.get(114) // Glitter_Trans_Dark_Pink
    expect(glitter?.material).toBe('glitter')
    expect(glitter?.alpha).toBe(128)
  })

  it('does not mistake a MATERIAL particle VALUE for the colour value', () => {
    // 0 !COLOUR ... VALUE #DF6695 ... MATERIAL GLITTER VALUE #923978 ...
    expect(colors.get(114)?.value).toBe(0xdf6695)
  })

  it('carries the inherit and edge sentinels', () => {
    expect(colors.get(INHERIT_COLOR_CODE)).toMatchObject({ code: 16, name: 'Main_Colour' })
    expect(colors.get(EDGE_COLOR_CODE)).toMatchObject({ code: 24, name: 'Edge_Colour' })
    expect(isSentinelCode(16)).toBe(true)
    expect(isSentinelCode(24)).toBe(true)
    expect(isSentinelCode(0)).toBe(false)
  })

  it('reads the library version from the header', () => {
    expect(parseLibraryVersion(LDCONFIG)).toBe('2026-05-29')
  })
})

describe('parseColorLibrary, line handling', () => {
  it('supplies the sentinels when LDConfig omits them', () => {
    const colors = parseColorLibrary('0 !COLOUR Red CODE 4 VALUE #B40000 EDGE #333333')
    expect(colors.size).toBe(3)
    expect(colors.get(16)).toMatchObject({ code: 16, material: 'solid' })
    expect(colors.get(24)).toMatchObject({ code: 24, material: 'solid' })
  })

  it('resolves an EDGE given as a colour code', () => {
    const colors = parseColorLibrary(
      ['0 !COLOUR Blue CODE 1 VALUE #1E5AA8 EDGE #333333', '0 !COLOUR Odd CODE 9 VALUE #FFFFFF EDGE 1'].join(
        '\n',
      ),
    )
    expect(colors.get(9)?.edge).toBe(0x1e5aa8)
  })

  it('skips malformed lines rather than throwing', () => {
    const colors = parseColorLibrary(
      ['0 !COLOUR Broken CODE', '0 !COLOUR NoValue CODE 5 EDGE #333333', '0 // a comment', '1 16 0 0 0'].join(
        '\n',
      ),
    )
    expect([...colors.keys()].sort((a, b) => a - b)).toEqual([16, 24])
  })

  it('accepts lowercase keywords', () => {
    const colors = parseColorLibrary('0 !colour Red code 4 value #b40000 edge #333333 alpha 128')
    expect(colors.get(4)).toMatchObject({ value: 0xb40000, alpha: 128, material: 'transparent' })
  })

  it('returns null for a version LDConfig does not declare', () => {
    expect(parseLibraryVersion('0 !COLOUR Red CODE 4 VALUE #B40000 EDGE #333333')).toBeNull()
  })
})
