/**
 * LDConfig.ldr parsing: the official LDraw colour palette.
 *
 * One `0 !COLOUR` line per colour, of the form
 *
 *   0 !COLOUR <name> CODE <n> VALUE #RRGGBB EDGE #RRGGBB [ALPHA <0-255>] [LUMINANCE <n>]
 *                    [CHROME | PEARLESCENT | RUBBER | MATTE_METALLIC | METAL |
 *                     MATERIAL <kind> ...]
 *
 * A `MATERIAL` block introduces its own `VALUE`, `FRACTION`, `SIZE` keys describing the
 * speckle or glitter particles, so top-level parsing stops where that block begins.
 */

import type { ColorLibrary, LDrawColor, MaterialClass } from './types.ts'

/** Colour 16 inherits from the referencing line. */
export const INHERIT_COLOR_CODE = 16
/** Colour 24 is the edge colour matching an inherited colour. */
export const EDGE_COLOR_CODE = 24

/**
 * Sentinels, used when LDConfig omits them. Both are resolved against the parent reference at
 * render time and never drawn literally, so the values matter only as a visible fallback.
 */
const SENTINEL_DEFAULTS: readonly LDrawColor[] = [
  { code: INHERIT_COLOR_CODE, name: 'Main_Colour', value: 0xffff80, edge: 0x333333, material: 'solid' },
  { code: EDGE_COLOR_CODE, name: 'Edge_Colour', value: 0x7f7f7f, edge: 0x333333, material: 'solid' },
]

/** `true` when `code` resolves against the referencing line rather than the palette. */
export function isSentinelCode(code: number): boolean {
  return code === INHERIT_COLOR_CODE || code === EDGE_COLOR_CODE
}

function parseHex(token: string | undefined): number | null {
  if (token === undefined || !token.startsWith('#')) return null
  const digits = token.slice(1)
  if (digits.length === 3) {
    const n = Number.parseInt(digits, 16)
    if (Number.isNaN(n)) return null
    const r = (n >> 8) & 0xf
    const g = (n >> 4) & 0xf
    const b = n & 0xf
    return (r * 0x11) * 0x10000 + (g * 0x11) * 0x100 + b * 0x11
  }
  if (digits.length !== 6) return null
  const n = Number.parseInt(digits, 16)
  return Number.isNaN(n) ? null : n
}

function parseNumber(token: string | undefined): number | undefined {
  if (token === undefined) return undefined
  const n = Number(token)
  return Number.isFinite(n) ? n : undefined
}

/**
 * Finish keywords beat transparency: a glittered transparent colour is `glitter`, because the
 * finish is what a renderer has to treat specially.
 */
function materialFor(finish: string | null, alpha: number | undefined): MaterialClass {
  switch (finish) {
    case 'CHROME':
      return 'chrome'
    case 'PEARLESCENT':
      return 'pearlescent'
    case 'METAL':
    case 'MATTE_METALLIC':
      return 'metallic'
    case 'RUBBER':
      return 'rubber'
    case 'GLITTER':
      return 'glitter'
    case 'SPECKLE':
      return 'speckle'
    case 'FABRIC':
      return 'fabric'
    default:
      return alpha !== undefined && alpha < 255 ? 'transparent' : 'solid'
  }
}

interface ParsedLine {
  color: LDrawColor
  /** Set when `EDGE` named a colour code instead of a hex triplet; resolved in a second pass. */
  edgeRef?: number
}

function parseColorLine(tokens: readonly string[]): ParsedLine | null {
  // tokens[0] is '!COLOUR', tokens[1] the name.
  const name = tokens[1]
  if (name === undefined) return null

  let code: number | undefined
  let value: number | undefined
  let edge: number | undefined
  let edgeRef: number | undefined
  let alpha: number | undefined
  let luminance: number | undefined
  let finish: string | null = null

  for (let i = 2; i < tokens.length; i++) {
    const key = tokens[i].toUpperCase()
    switch (key) {
      case 'CODE':
        code = parseNumber(tokens[++i])
        break
      case 'VALUE':
        value = parseHex(tokens[++i]) ?? undefined
        break
      case 'EDGE': {
        const token = tokens[++i]
        const hex = parseHex(token)
        if (hex === null) edgeRef = parseNumber(token)
        else edge = hex
        break
      }
      case 'ALPHA':
        alpha = parseNumber(tokens[++i])
        break
      case 'LUMINANCE':
        luminance = parseNumber(tokens[++i])
        break
      case 'CHROME':
      case 'PEARLESCENT':
      case 'RUBBER':
      case 'METAL':
      case 'MATTE_METALLIC':
        finish = key
        break
      case 'MATERIAL':
        // Everything after MATERIAL belongs to the particle description.
        finish = (tokens[++i] ?? '').toUpperCase()
        i = tokens.length
        break
      default:
        break
    }
  }

  if (code === undefined || value === undefined) return null

  const color: LDrawColor = {
    code,
    name,
    value,
    edge: edge ?? 0x333333,
    material: materialFor(finish, alpha),
  }
  if (alpha !== undefined && alpha < 255) color.alpha = alpha
  if (luminance !== undefined) color.luminance = luminance

  return edgeRef === undefined ? { color } : { color, edgeRef }
}

/**
 * Parses the text of `LDConfig.ldr` into a `ColorLibrary`.
 *
 * Malformed `!COLOUR` lines are skipped rather than throwing: one bad line upstream should not
 * cost the whole palette. Codes 16 and 24 are always present in the result.
 */
export function parseColorLibrary(text: string): ColorLibrary {
  const parsed: ParsedLine[] = []

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line.startsWith('0 ')) continue
    const tokens = line.slice(2).trim().split(/\s+/)
    if (tokens[0]?.toUpperCase() !== '!COLOUR') continue
    const entry = parseColorLine(tokens)
    if (entry !== null) parsed.push(entry)
  }

  const colors = new Map<number, LDrawColor>()
  for (const { color } of parsed) colors.set(color.code, color)

  // Second pass: `EDGE <code>` referring to another palette entry.
  for (const { color, edgeRef } of parsed) {
    if (edgeRef === undefined) continue
    const referenced = colors.get(edgeRef)
    if (referenced !== undefined) color.edge = referenced.value
  }

  for (const sentinel of SENTINEL_DEFAULTS) {
    if (!colors.has(sentinel.code)) colors.set(sentinel.code, sentinel)
  }

  return colors
}

/** The library release LDConfig declares, e.g. `2026-05-29`, or `null` when it carries none. */
export function parseLibraryVersion(text: string): string | null {
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line.startsWith('0 ')) continue
    const match = /^0\s+!LDRAW_ORG\s+Configuration\s+UPDATE\s+(\S+)/i.exec(line)
    if (match !== null) return match[1]
    if (line.startsWith('0 !COLOUR')) break
  }
  return null
}
