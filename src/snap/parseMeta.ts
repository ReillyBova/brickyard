/**
 * Parsing of LDCad `0 !LDCAD SNAP_*` meta lines from shadow-library files.
 *
 * Pure: no three.js, no DOM, no I/O. Safe inside a worker.
 *
 * Reference: https://www.melkert.net/LDCad/tech/meta
 */

import type { Mat3, Vec3 } from '../types.ts';
import type { Gender, Section, SectionVariant, SnapKind } from './types.ts';

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

/** The radius field is 8 bits (see `packKey`), so `round(radius / RADIUS_QUANTUM)` must fit in 0..255. */
const RADIUS_BUCKET_MAX = 255;

/**
 * The section that actually does the mating: whichever radius accounts for the most of
 * the profile's total length, regardless of gender.
 *
 * A stepped profile almost always has one dominant section — the real shaft or bore that
 * does the engaging — plus one or two short features at the ends: a collar, a chamfer, a
 * locking ridge. Picking a fixed extreme (always widest, always narrowest) gets fooled by
 * whichever of those short features happens to be more extreme than the shaft:
 *
 * - The real Technic pin (`3673`) is `_L 6.25 2 · R 6 16 · R 8 4 · R 6 16 · _L 6.25 2` — a
 *   radius-8 collar sits in the *middle*, deliberately meant to stay outside any single
 *   hole (it's the stop between two beams when a pin joins them front-to-back). Always
 *   picking the widest section grabs the collar (8) instead of the shaft (6) that
 *   actually enters `3700`'s hole, `R 8 2 · R 6 16 · R 8 2` — and the two read as
 *   incompatible even though they are the textbook fit.
 * - The round brick `3062b`'s underside socket is `R 6 20 · R 4 8` — a normal radius-6
 *   bore for almost its whole depth, narrowing to 4 only in the last 8 LDU where no stud
 *   ever reaches. Always picking the narrowest section grabs that unreachable neck (4)
 *   instead of the bore (6) that a real stud engages — measured directly against the
 *   bundled models, every `3062b` in Shipwrecked Pirate came in reading as incompatible
 *   with the stud it visibly sits on, for exactly this reason.
 *
 * In both real cases the short, unrepresentative feature loses on total length, and the
 * shaft or bore that actually does the work wins — which is what this picks.
 */
export function matingSection(sections: readonly Section[]): Section | null {
  if (sections.length === 0) return null;
  const totalByRadius = new Map<number, number>();
  for (const s of sections) {
    totalByRadius.set(s.radius, (totalByRadius.get(s.radius) ?? 0) + s.length);
  }
  let best = sections[0];
  let bestTotal = totalByRadius.get(best.radius)!;
  for (const s of sections) {
    const total = totalByRadius.get(s.radius)!;
    if (total > bestTotal) {
      best = s;
      bestTotal = total;
    }
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
 *  bits  7..14  radius        round(radius / 0.5), must fit in 0..255
 *  bit   15     slide
 * ```
 *
 * Zero in the variant and radius fields means "no section profile", which is how a
 * SNAP_GEN point with a degenerate bounding volume reads.
 *
 * The radius bucket is not clamped. A part whose mating radius rounds to more than 255
 * half-LDU steps (roughly 127.75 LDU, ~51mm) would silently collapse into the same bucket
 * as every other oversized part and read as compatible with them — a correctness bug, not
 * a display quirk, since this key drives the mating solver. Throwing surfaces the part
 * immediately instead of shipping a latent false-positive match; if a real part needs it,
 * the fix is to widen the field, not to clamp quietly.
 */
export function packKey(
  kind: SnapKind,
  gender: Gender,
  sections: readonly Section[],
  slide: boolean,
): number {
  const sec = matingSection(sections);
  const variant = sec ? VARIANT_CODE[sec.variant] : 0;
  let bucket = 0;
  if (sec) {
    bucket = Math.max(0, Math.round(sec.radius / RADIUS_QUANTUM));
    if (bucket > RADIUS_BUCKET_MAX) {
      throw new RangeError(
        `packKey: radius ${sec.radius} LDU exceeds the packable range ` +
          `(max ${RADIUS_BUCKET_MAX * RADIUS_QUANTUM} LDU); widen the radius field, don't clamp it.`,
      );
    }
  }
  return (
    KIND_CODE[kind] |
    (GENDER_CODE[gender] << 3) |
    (variant << 5) |
    (bucket << 7) |
    ((slide ? 1 : 0) << 15)
  );
}
