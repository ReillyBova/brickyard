/**
 * Walks an LDraw part's subfile tree and emits its `ConnectionPoint[]`.
 *
 * Geometry lives in the LDraw library; connectivity lives in the LDCad shadow library,
 * whose files sit at the same relative paths. At every file in the walk we look for a
 * shadow twin and, if one exists, place its `SNAP_*` metas at the accumulated transform.
 * Most annotations sit on primitives — `p/stud.dat` is annotated once and every part that
 * references a stud inherits a stud connector for free.
 *
 * Pure: no three.js, no DOM, no I/O of its own. All file access goes through the injected
 * reader, which is what keeps this safe in a worker and offline in tests.
 */

import type { Mat3, Vec3 } from '../types';
import type { ConnectionPoint, Gender, Section, SnapKind } from './types';
import type { SnapAttributes, SnapCommand } from './parseMeta';
import {
  KIND_BY_COMMAND,
  gridOffsets,
  packKey,
  parseBoolean,
  parseBounding,
  parseGender,
  parseGrid,
  parseNumbers,
  parseOrientation,
  parseSections,
  parseSnapLine,
  parseVec3,
} from './parseMeta';

/**
 * Reads one library file. Paths are namespaced: `ldraw/parts/3001.dat` for geometry,
 * `shadow/p/stud.dat` for connectivity. Returns null when the file does not exist —
 * missing files are ordinary here, not errors: most parts have no shadow twin and
 * resolution probes several directories for every reference.
 */
export type ReadFile = (relativePath: string) => Promise<string | null>;

export interface ResolveOptions {
  /** Guards against reference cycles in malformed data. */
  maxDepth?: number;
}

const DEFAULT_MAX_DEPTH = 24;

// ---------------------------------------------------------------------------
// Column-major 4x4 helpers, matching the layout of `Mat4` and `Matrix4.elements`.
// Element (row r, column c) is at index c * 4 + r.
// ---------------------------------------------------------------------------

type M4 = number[];

const IDENTITY: M4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function multiply(a: M4, b: M4): M4 {
  const out = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = sum;
    }
  }
  return out;
}

/** Builds a 4x4 from a column-major 3x3 basis and a translation. */
function compose(basis: Mat3, position: Vec3, scale: Vec3 = [1, 1, 1]): M4 {
  return [
    basis[0] * scale[0],
    basis[1] * scale[0],
    basis[2] * scale[0],
    0,
    basis[3] * scale[1],
    basis[4] * scale[1],
    basis[5] * scale[1],
    0,
    basis[6] * scale[2],
    basis[7] * scale[2],
    basis[8] * scale[2],
    0,
    position[0],
    position[1],
    position[2],
    1,
  ];
}

const translationOf = (m: M4): Vec3 => [m[12], m[13], m[14]];

/**
 * The part-local basis, with each column normalised. References may carry scale or a
 * mirror; normalising keeps `orientation` an actual basis while preserving handedness,
 * which the mating solver relies on.
 */
function basisOf(m: M4): Mat3 {
  const out = [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]];
  for (let c = 0; c < 3; c++) {
    const i = c * 3;
    const len = Math.hypot(out[i], out[i + 1], out[i + 2]);
    if (len > 1e-9) {
      out[i] /= len;
      out[i + 1] /= len;
      out[i + 2] /= len;
    }
  }
  return out;
}

/** `1 <colour> x y z a b c d e f g h i <file>` — the 3x3 is row-major. */
function referenceMatrix(n: number[]): M4 {
  const [x, y, z, a, b, c, d, e, f, g, h, i] = n;
  return [a, d, g, 0, b, e, h, 0, c, f, i, 0, x, y, z, 1];
}

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

const normalise = (ref: string): string => ref.replace(/\\/g, '/').toLowerCase().trim();

/**
 * Candidate library paths for a reference, in LDraw's search order: `parts/`, then `p/`,
 * then `models/`. A reference that already names a library directory is taken as written.
 * Backslashes are LDraw's separator (`s\3001s01.dat`) and normalise to `/`.
 */
export function referenceCandidates(ref: string): string[] {
  const n = normalise(ref);
  if (n.length === 0) return [];
  if (/^(parts|p|models)\//.test(n)) return [n];
  return [`parts/${n}`, `p/${n}`, `models/${n}`];
}

// ---------------------------------------------------------------------------
// Walk
// ---------------------------------------------------------------------------

/** A point before it is given its stable id and compatibility key. */
interface RawPoint {
  kind: SnapKind;
  gender: Gender;
  sections: Section[];
  position: Vec3;
  orientation: Mat3;
  slide: boolean;
  group?: string;
  source: string;
  /** The meta's `id` attribute, used only to match SNAP_CLEAR. Not the point's id. */
  snapId?: string;
}

interface Context {
  read: ReadFile;
  files: Map<string, Promise<string | null>>;
  maxDepth: number;
}

function readFile(ctx: Context, path: string): Promise<string | null> {
  let pending = ctx.files.get(path);
  if (!pending) {
    pending = ctx.read(path).catch(() => null);
    ctx.files.set(path, pending);
  }
  return pending;
}

/** First candidate that exists, or null. */
async function resolveReference(ctx: Context, ref: string, ns: string): Promise<string | null> {
  for (const candidate of referenceCandidates(ref)) {
    if ((await readFile(ctx, ns + candidate)) !== null) return candidate;
  }
  return null;
}

interface ShadowResult {
  points: RawPoint[];
  /** One entry per SNAP_CLEAR; undefined id means "clear everything inherited". */
  clears: (string | undefined)[];
}

async function collectShadow(
  ctx: Context,
  shadowRel: string,
  world: M4,
  depth: number,
  chain: ReadonlySet<string>,
): Promise<ShadowResult> {
  const result: ShadowResult = { points: [], clears: [] };
  if (depth > ctx.maxDepth || chain.has(shadowRel)) return result;

  const text = await readFile(ctx, `shadow/${shadowRel}`);
  if (text === null) return result;

  const nested = new Set(chain).add(shadowRel);

  for (const line of text.split(/\r?\n/)) {
    const meta = parseSnapLine(line);
    if (!meta) continue;
    const { command, attrs } = meta;

    if (command === 'SNAP_CLEAR') {
      result.clears.push(attrs.id === undefined || attrs.id === '' ? undefined : attrs.id);
      continue;
    }

    const local = compose(parseOrientation(attrs.ori), parseVec3(attrs.pos));
    const scale = attrs.scale ? parseNumbers(attrs.scale) : [];
    const scaled =
      command === 'SNAP_INCL' && scale.length >= 3
        ? multiply(local, compose([1, 0, 0, 0, 1, 0, 0, 0, 1], [0, 0, 0], [scale[0], scale[1], scale[2]]))
        : local;

    for (const offset of gridOffsets(parseGrid(attrs.grid))) {
      // The lattice steps along the snap's own X and Z, so the offset goes inside `ori`.
      const placed = multiply(scaled, compose([1, 0, 0, 0, 1, 0, 0, 0, 1], offset));
      const m = multiply(world, placed);

      if (command === 'SNAP_INCL') {
        const ref = attrs.ref;
        if (!ref) continue;
        const target = await resolveReference(ctx, ref, 'shadow/');
        if (!target) continue;
        const included = await collectShadow(ctx, target, m, depth + 1, nested);
        result.points.push(...included.points);
        result.clears.push(...included.clears);
        continue;
      }

      const point = buildPoint(command, attrs, m, shadowRel);
      if (point) result.points.push(point);
    }
  }

  return result;
}

function buildPoint(
  command: SnapCommand,
  attrs: SnapAttributes,
  m: M4,
  source: string,
): RawPoint | null {
  const kind: SnapKind | undefined = KIND_BY_COMMAND[command];
  if (!kind) return null;

  let gender: Gender;
  let sections: Section[];
  let slide = parseBoolean(attrs.slide);
  let group: string | undefined;

  switch (kind) {
    case 'cyl':
      gender = parseGender(attrs.gender);
      sections = parseSections(attrs.secs);
      break;
    case 'clip':
      // A clip grips a male cylinder, so it is female by nature; LDCad does not spell it out.
      gender = 'F';
      sections = [
        {
          variant: 'R',
          radius: Number(attrs.radius ?? '4') || 4,
          length: Number(attrs.length ?? '8') || 8,
        },
      ];
      break;
    case 'finger': {
      // `seq` is the run of finger widths along the axis; one section per finger keeps
      // the interlocking pattern rather than collapsing it to a total length.
      gender = parseGender(attrs.genderofs);
      const radius = Number(attrs.radius ?? '') || 0;
      const widths = parseNumbers(attrs.seq).filter((w) => Number.isFinite(w));
      sections = (widths.length ? widths : [0]).map((length) => ({
        variant: 'R' as const,
        radius,
        length,
      }));
      // Hinge fingers rotate about their axis but never slide along it.
      slide = false;
      break;
    }
    default:
      gender = parseGender(attrs.gender);
      sections = parseBounding(attrs.bounding);
      group = attrs.group;
      break;
  }

  return {
    kind,
    gender,
    sections,
    position: translationOf(m),
    orientation: basisOf(m),
    slide,
    ...(group ? { group } : {}),
    source,
    ...(attrs.id ? { snapId: attrs.id } : {}),
  };
}

function applyClears(points: RawPoint[], clears: (string | undefined)[]): RawPoint[] {
  if (clears.length === 0) return points;
  if (clears.some((id) => id === undefined)) return [];
  const ids = new Set(clears.filter((id): id is string => id !== undefined).map((id) => id.toLowerCase()));
  return points.filter((p) => !(p.snapId && ids.has(p.snapId.toLowerCase())));
}

async function walk(
  ctx: Context,
  ldrawRel: string,
  world: M4,
  depth: number,
): Promise<RawPoint[]> {
  if (depth > ctx.maxDepth) return [];
  const text = await readFile(ctx, `ldraw/${ldrawRel}`);
  if (text === null) return [];

  const shadow = await collectShadow(ctx, ldrawRel, world, 0, new Set());

  const inherited: RawPoint[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith('1 ')) continue;
    const tok = line.split(/\s+/);
    if (tok.length < 15) continue;
    const numbers = tok.slice(2, 14).map(Number);
    if (numbers.some(Number.isNaN)) continue;
    const child = await resolveReference(ctx, tok.slice(14).join(' '), 'ldraw/');
    if (!child) continue;
    inherited.push(
      ...(await walk(ctx, child, multiply(world, referenceMatrix(numbers)), depth + 1)),
    );
  }

  // SNAP_CLEAR lets a part override what its primitives contributed, so it applies to the
  // subtree, never to the annotations the file makes itself.
  return [...shadow.points, ...applyClears(inherited, shadow.clears)];
}

function finalise(raw: readonly RawPoint[]): ConnectionPoint[] {
  const ordinals = new Map<string, number>();
  return raw.map((p) => {
    const n = ordinals.get(p.source) ?? 0;
    ordinals.set(p.source, n + 1);
    return {
      id: `${p.source}#${n}`,
      kind: p.kind,
      gender: p.gender,
      sections: p.sections,
      position: p.position,
      orientation: p.orientation,
      slide: p.slide,
      ...(p.group ? { group: p.group } : {}),
      key: packKey(p.kind, p.gender, p.sections, p.slide),
      source: p.source,
    };
  });
}

/**
 * Every connection point of a part, in part-local LDU with +Y down.
 *
 * A part with no shadow coverage anywhere in its tree, and a part id that does not exist,
 * both resolve to an empty array rather than throwing: uncovered parts still have to load.
 */
export async function resolvePart(
  partId: string,
  read: ReadFile,
  options: ResolveOptions = {},
): Promise<ConnectionPoint[]> {
  const ctx: Context = {
    read,
    files: new Map(),
    maxDepth: options.maxDepth ?? DEFAULT_MAX_DEPTH,
  };
  const rel = /\.(dat|ldr)$/i.test(partId) ? normalise(partId) : `parts/${normalise(partId)}.dat`;
  const entry = (await resolveReference(ctx, rel, 'ldraw/')) ?? rel;
  return finalise(await walk(ctx, entry, IDENTITY, 0));
}
