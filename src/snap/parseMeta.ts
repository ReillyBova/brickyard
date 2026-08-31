/**
 * Parsing of LDCad `0 !LDCAD SNAP_*` meta lines from shadow-library files.
 *
 * Pure: no three.js, no DOM, no I/O. Safe inside a worker.
 *
 * Reference: https://www.melkert.net/LDCad/tech/meta
 */

import type { Mat3, Vec3 } from '../types';
import type { Gender, Section, SectionVariant, SnapKind } from './types';

export type SnapCommand =
  | 'SNAP_CYL'
  | 'SNAP_CLP'
  | 'SNAP_FGR'
  | 'SNAP_GEN'
  | 'SNAP_INCL'
  | 'SNAP_CLEAR';

const COMMANDS: ReadonlySet<string> = new Set([
  'SNAP_CYL',
  'SNAP_CLP',
  'SNAP_FGR',
  'SNAP_GEN',
  'SNAP_INCL',
  'SNAP_CLEAR',
]);

/** Attribute names are matched case-insensitively; LDCad writes `id`, `ID` and `Id`. */
export type SnapAttributes = Readonly<Record<string, string>>;

export interface SnapMeta {
  command: SnapCommand;
  attrs: SnapAttributes;
}

/** One axis of a `grid` lattice. */
export interface GridAxis {
  count: number;
  centred: boolean;
  step: number;
}

export interface SnapGrid {
  x: GridAxis;
  z: GridAxis;
}

/**
 * Matches an active snap meta. A leading `//` comments the line out — the shadow library
 * uses that to park annotations, e.g. `0 //!LDCAD SNAP_CYL ...` in `p/stud4.dat` — and
 * such lines must not produce connections.
 */
const SNAP_LINE = /^0\s+!LDCAD\s+(SNAP_[A-Z]+)\s*(.*)$/i;

const ATTRIBUTE = /\[([^=\]]+)=([^\]]*)\]/g;

/** `[key=value]` pairs from the remainder of a meta line. Keys are lowercased. */
export function parseAttributes(rest: string): SnapAttributes {
  const out: Record<string, string> = {};
  for (const m of rest.matchAll(ATTRIBUTE)) {
    out[m[1].trim().toLowerCase()] = m[2].trim();
  }
  return out;
}

/** Returns null for any line that is not an active `SNAP_*` meta. */
export function parseSnapLine(line: string): SnapMeta | null {
  const m = line.match(SNAP_LINE);
  if (!m) return null;
  const command = m[1].toUpperCase();
  if (!COMMANDS.has(command)) return null;
  return { command: command as SnapCommand, attrs: parseAttributes(m[2]) };
}

export function parseNumbers(value: string | undefined): number[] {
  if (!value) return [];
  return value
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .map(Number);
}

export function parseVec3(value: string | undefined, fallback: Vec3 = [0, 0, 0]): Vec3 {
  const n = parseNumbers(value);
  if (n.length < 3 || n.some(Number.isNaN)) return fallback;
  return [n[0], n[1], n[2]];
}

const IDENTITY_3: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/**
 * `ori` is nine floats in LDraw's row-major order. `Mat3` is column-major, so the
 * transpose is the conversion, not a bug.
 */
export function parseOrientation(value: string | undefined): Mat3 {
  const n = parseNumbers(value);
  if (n.length < 9 || n.some(Number.isNaN)) return IDENTITY_3;
  return [n[0], n[3], n[6], n[1], n[4], n[7], n[2], n[5], n[8]];
}

export function parseBoolean(value: string | undefined): boolean {
  if (value === undefined) return false;
  const v = value.trim().toLowerCase();
  return v === 'true' || v === 'yes' || v === '1';
}

/**
 * `secs` is repeated `<variant> <radius> <length>`.
 *
 * Variants `R`, `S` and `A` are round, square and axle. `_L` and `L_` mark a flexible
 * radius transition to the previous and the next section respectively; the contract has
 * no variant for those, so they keep their own radius and length and inherit the variant
 * of the section they extend. The profile is preserved; only the transition's label is
 * dropped.
 */
export function parseSections(value: string | undefined): Section[] {
  const tokens = value ? value.trim().split(/\s+/).filter(Boolean) : [];
  type Raw = { label: string; radius: number; length: number };
  const raw: Raw[] = [];

  for (let i = 0; i + 2 < tokens.length; i += 3) {
    const radius = Number(tokens[i + 1]);
    const length = Number(tokens[i + 2]);
    if (Number.isNaN(radius) || Number.isNaN(length)) continue;
    raw.push({ label: tokens[i].toUpperCase(), radius, length });
  }

  const variantOf = (label: string): SectionVariant | null =>
    label === 'R' || label === 'S' || label === 'A' ? label : null;

  return raw.map((sec, i) => {
    const own = variantOf(sec.label);
    if (own) return { variant: own, radius: sec.radius, length: sec.length };

    // A flexible transition: look backwards for `_L`, forwards for `L_`.
    const search = sec.label === 'L_' ? 1 : -1;
    let variant: SectionVariant = 'R';
    for (let j = i + search; j >= 0 && j < raw.length; j += search) {
      const v = variantOf(raw[j].label);
      if (v) {
        variant = v;
        break;
      }
    }
    return { variant, radius: sec.radius, length: sec.length };
  });
}

/** `grid=[C]<countX> [C]<countZ> <stepX> <stepZ>`; `C` centres that axis. */
export function parseGrid(value: string | undefined): SnapGrid | null {
  if (!value) return null;
  const t = value.trim().split(/\s+/).filter(Boolean);
  let i = 0;
  const axis = (): { count: number; centred: boolean } => {
    let centred = false;
    if (t[i]?.toUpperCase() === 'C') {
      centred = true;
      i++;
    }
    const count = Number.parseInt(t[i++], 10);
    return { count: Number.isFinite(count) && count > 0 ? count : 1, centred };
  };
  const x = axis();
  const z = axis();
  const stepX = Number(t[i++]);
  const stepZ = Number(t[i++]);
  return {
    x: { ...x, step: Number.isFinite(stepX) ? stepX : 0 },
    z: { ...z, step: Number.isFinite(stepZ) ? stepZ : 0 },
  };
}

/**
 * Local offsets a grid replicates a snap over, in the snap's own frame. A null grid
 * yields the single zero offset, so callers need no special case.
 */
export function gridOffsets(grid: SnapGrid | null): Vec3[] {
  if (!grid) return [[0, 0, 0]];
  const at = (a: GridAxis, i: number) => (a.centred ? i - (a.count - 1) / 2 : i) * a.step;
  const out: Vec3[] = [];
  for (let i = 0; i < grid.x.count; i++) {
    for (let j = 0; j < grid.z.count; j++) {
      out.push([at(grid.x, i), 0, at(grid.z, j)]);
    }
  }
  return out;
}

/** `male`/`female`, or the single letters. SNAP_CYL and SNAP_GEN default to male. */
export function parseGender(value: string | undefined, fallback: Gender = 'M'): Gender {
  const v = value?.trim().toUpperCase();
  if (!v) return fallback;
  if (v === 'F' || v === 'FEMALE') return 'F';
  if (v === 'M' || v === 'MALE') return 'M';
  return fallback;
}

/**
 * SNAP_GEN carries a `bounding` volume rather than a section stack. Mapped onto the
 * contract's section profile so that every kind is described the same way:
 * `pnt` a degenerate point, `cyl`/`sph` round, `box`/`cube` square.
 */
export function parseBounding(value: string | undefined): Section[] {
  const t = value ? value.trim().split(/\s+/).filter(Boolean) : [];
  const n = (i: number) => {
    const v = Number(t[i]);
    return Number.isFinite(v) ? v : 0;
  };
  switch (t[0]?.toLowerCase()) {
    case 'box':
      return [{ variant: 'S', radius: Math.max(n(1), n(3)), length: n(2) * 2 }];
    case 'cube':
      return [{ variant: 'S', radius: n(1), length: n(1) * 2 }];
    case 'cyl':
      return [{ variant: 'R', radius: n(1), length: n(2) }];
    case 'sph':
      return [{ variant: 'R', radius: n(1), length: n(1) * 2 }];
    default:
      return [{ variant: 'R', radius: 0, length: 0 }];
  }
}

export const KIND_BY_COMMAND: Readonly<Record<string, SnapKind>> = {
  SNAP_CYL: 'cyl',
  SNAP_CLP: 'clip',
  SNAP_FGR: 'finger',
  SNAP_GEN: 'general',
};

const KIND_CODE: Readonly<Record<SnapKind, number>> = { cyl: 1, clip: 2, finger: 3, general: 4 };
const GENDER_CODE: Readonly<Record<Gender, number>> = { M: 1, F: 2 };
const VARIANT_CODE: Readonly<Record<SectionVariant, number>> = { R: 1, S: 2, A: 3 };

/** Radius bucket resolution: half an LDU. Distinguishes 2.5 from 3, and 4 from 6 from 8. */
const RADIUS_QUANTUM = 0.5;

/**
 * The section that actually does the mating. A male connector is limited by its widest
 * section — that is what has to fit — and a female one by its narrowest, the bore. So a
 * Technic pin hole `R 8 2 · R 6 16 · R 8 2` keys on radius 6, exactly like the pin that
 * enters it.
 */
export function matingSection(sections: readonly Section[], gender: Gender): Section | null {
  if (sections.length === 0) return null;
  let best = sections[0];
  for (const s of sections) {
    if (gender === 'F' ? s.radius < best.radius : s.radius > best.radius) best = s;
  }
  return best;
}

/**
 * Compatibility key. Packed so that matching is an integer table lookup rather than a
 * chain of comparisons on the hot path.
 *
 * ```
 *  bits  0..2   kind          1 cyl · 2 clip · 3 finger · 4 general
 *  bits  3..4   gender        1 M · 2 F
 *  bits  5..6   variant       1 R · 2 S · 3 A   (of the mating section)
 *  bits  7..14  radius        round(radius / 0.5), clamped to 0..255
 *  bit   15     slide
 * ```
 *
 * Zero in the variant and radius fields means "no section profile", which is how a
 * SNAP_GEN point with a degenerate bounding volume reads.
 */
export function packKey(
  kind: SnapKind,
  gender: Gender,
  sections: readonly Section[],
  slide: boolean,
): number {
  const sec = matingSection(sections, gender);
  const variant = sec ? VARIANT_CODE[sec.variant] : 0;
  const bucket = sec ? Math.min(255, Math.max(0, Math.round(sec.radius / RADIUS_QUANTUM))) : 0;
  return (
    KIND_CODE[kind] |
    (GENDER_CODE[gender] << 3) |
    (variant << 5) |
    (bucket << 7) |
    ((slide ? 1 : 0) << 15)
  );
}
