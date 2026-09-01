/**
 * Part-local geometry bounds, and a pure LDraw geometry walk to get them offline.
 *
 * Two ways in:
 *
 * - `boundsFromPositions` takes a flat xyz array — the shape both a three.js
 *   `BufferGeometry` position attribute and our own parsed triangles come in — so bounds
 *   computed at runtime (from loaded render geometry) and bounds computed in tests (from
 *   fixture `.dat` text, no three.js involved) share one implementation.
 * - `partTriangles` walks a part's reference tree the same way `resolvePart` walks the
 *   shadow tree, except over LDraw geometry lines (`1`, `3`, `4`) instead of `!LDCAD`
 *   metas. It exists so bounds and occupancy can be computed and tested without a
 *   browser or a network fetch.
 *
 * Pure: no three.js, no DOM. `src/scene/partSource.ts` also uses `boundsFromPositions`
 * against real loaded geometry; `partTriangles` is for offline/test use and for building
 * occupancy masks from captured fixtures.
 */

import type { Bounds, Mat4, Vec3 } from '../types.ts';
import { fromBasis, multiply, transformPoint, IDENTITY } from '../math.ts';

/** A face, already triangulated, in whatever space the caller walked to. */
export type Triangle = readonly [Vec3, Vec3, Vec3];

/**
 * Reads one library file, namespaced the same way `resolvePart`'s `ReadFile` is:
 * `ldraw/parts/3001.dat`. Declared locally rather than imported from `src/snap/` —
 * `ldraw/` does not depend on `snap/` (see `docs/ARCHITECTURE.md`'s module diagram) even
 * though the shapes are identical.
 */
export type ReadFile = (relativePath: string) => Promise<string | null>;

export interface PartTrianglesOptions {
  /** Guards against reference cycles in malformed data. */
  maxDepth?: number;
}

const DEFAULT_MAX_DEPTH = 24;

// ---------------------------------------------------------------------------
// AABB from a flat position array
// ---------------------------------------------------------------------------

/**
 * Axis-aligned bounds of a flat `[x0,y0,z0,x1,y1,z1,...]` array, in whatever space the
 * positions are already in. Empty input yields a degenerate zero box at the origin —
 * callers with real geometry never hit that branch, but it keeps the function total.
 */
export function boundsFromPositions(positions: ArrayLike<number>): Bounds {
  if (positions.length === 0) {
    return { min: [0, 0, 0], max: [0, 0, 0] };
  }
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i + 2 < positions.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      const v = positions[i + a];
      if (v < min[a]) min[a] = v;
      if (v > max[a]) max[a] = v;
    }
  }
  return { min, max };
}

export function boundsFromTriangles(triangles: readonly Triangle[]): Bounds {
  const flat: number[] = [];
  for (const [a, b, c] of triangles) flat.push(...a, ...b, ...c);
  return boundsFromPositions(flat);
}

// ---------------------------------------------------------------------------
// Path resolution — same search order as resolvePart, duplicated rather than shared
// across the ldraw/snap boundary.
// ---------------------------------------------------------------------------

const normalise = (ref: string): string => ref.replace(/\\/g, '/').toLowerCase().trim();

function referenceCandidates(ref: string): string[] {
  const n = normalise(ref);
  if (n.length === 0) return [];
  if (/^(parts|p|models)\//.test(n)) return [n];
  return [`parts/${n}`, `p/${n}`, `models/${n}`];
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

async function resolveReference(ctx: Context, ref: string): Promise<string | null> {
  for (const candidate of referenceCandidates(ref)) {
    if ((await readFile(ctx, `ldraw/${candidate}`)) !== null) return candidate;
  }
  return null;
}

/**
 * `1 <colour> x y z a b c d e f g h i <file>` — the 3x3 is row-major, `fromBasis` wants
 * column-major, so the transpose here is the format conversion. Same convention as
 * `resolvePart.ts`'s `referenceMatrix`.
 */
function referenceMatrix(n: readonly number[]): Mat4 {
  const [x, y, z, a, b, c, d, e, f, g, h, i] = n;
  return fromBasis([a, d, g, b, e, h, c, f, i], [x, y, z]);
}

function vec3At(tok: readonly string[], i: number): Vec3 {
  return [Number(tok[i]), Number(tok[i + 1]), Number(tok[i + 2])];
}

// ---------------------------------------------------------------------------
// Walk
// ---------------------------------------------------------------------------

async function walk(
  ctx: Context,
  ldrawRel: string,
  world: Mat4,
  depth: number,
  chain: ReadonlySet<string>,
  out: Triangle[],
): Promise<void> {
  if (depth > ctx.maxDepth || chain.has(ldrawRel)) return;
  const text = await readFile(ctx, `ldraw/${ldrawRel}`);
  if (text === null) return;

  const nested = new Set(chain).add(ldrawRel);

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length === 0) continue;
    const type = line[0];

    if (type === '1') {
      const tok = line.split(/\s+/);
      if (tok.length < 15) continue;
      const numbers = tok.slice(2, 14).map(Number);
      if (numbers.some(Number.isNaN)) continue;
      const child = await resolveReference(ctx, tok.slice(14).join(' '));
      if (!child) continue;
      await walk(ctx, child, multiply(world, referenceMatrix(numbers)), depth + 1, nested, out);
      continue;
    }

    if (type === '3') {
      const tok = line.split(/\s+/);
      if (tok.length < 11) continue;
      const nums = tok.slice(2, 11).map(Number);
      if (nums.some(Number.isNaN)) continue;
      const [a, b, c] = [vec3At(tok, 2), vec3At(tok, 5), vec3At(tok, 8)];
      out.push([transformPoint(world, a), transformPoint(world, b), transformPoint(world, c)]);
      continue;
    }

    if (type === '4') {
      const tok = line.split(/\s+/);
      if (tok.length < 14) continue;
      const nums = tok.slice(2, 14).map(Number);
      if (nums.some(Number.isNaN)) continue;
      const a = vec3At(tok, 2);
      const b = vec3At(tok, 5);
      const c = vec3At(tok, 8);
      const d = vec3At(tok, 11);
      const wa = transformPoint(world, a);
      const wb = transformPoint(world, b);
      const wc = transformPoint(world, c);
      const wd = transformPoint(world, d);
      out.push([wa, wb, wc], [wa, wc, wd]);
      continue;
    }

    // Types 0 (comment/meta), 2 (line) and 5 (optional line) carry no fillable surface.
  }
}

/**
 * Every triangle in a part's geometry tree, in part-local LDU with +Y down. Quads (type
 * `4`) are split in fan order `(0,1,2)`, `(0,2,3)`; lines (`2`) and optional lines (`5`)
 * are skipped, since neither bounds nor a fill voxelisation cares about them.
 *
 * A part with a missing file, or a reference that never resolves, yields an empty
 * geometry rather than throwing — mirrors `resolvePart`'s handling of uncovered parts.
 */
export async function partTriangles(
  partId: string,
  read: ReadFile,
  options: PartTrianglesOptions = {},
): Promise<Triangle[]> {
  const ctx: Context = {
    read,
    files: new Map(),
    maxDepth: options.maxDepth ?? DEFAULT_MAX_DEPTH,
  };
  const rel = /\.(dat|ldr)$/i.test(partId) ? normalise(partId) : `parts/${normalise(partId)}.dat`;
  const entry = (await resolveReference(ctx, rel)) ?? rel;
  const out: Triangle[] = [];
  await walk(ctx, entry, IDENTITY, 0, new Set(), out);
  return out;
}
