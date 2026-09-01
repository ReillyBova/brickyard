/**
 * MPD parsing: splits an LDraw multi-part document into its `0 FILE` sections, resolves
 * submodel references recursively, and flattens nested submodel transforms into world
 * matrices per brick.
 *
 * Submodels carry arbitrary rotations (`docs/LDRAW-PRIMER.md`) — the truck published
 * model places its `TRUCK.LDR` submodel at 30 degrees about Y, verified in
 * `parseMpd.test.ts` — so flattening composes matrices rather than assuming any axis
 * alignment or lattice.
 *
 * `0 STEP` metadata is kept on the parsed result as indices into the flattened brick
 * list, even though nothing downstream consumes it yet: build order is recoverable from
 * the file and instruction playback is a later feature (see `docs/ARCHITECTURE.md`,
 * "Connection graph").
 *
 * Pure: no three.js, no DOM, no I/O. Safe to run off the main thread.
 */

import { fromBasis, multiply, IDENTITY } from '../../math';
import type { Mat4 } from '../../types';
import { INHERIT_COLOR_CODE } from '../../ldraw/colors';

/** One flattened part placement — a leaf reference, never a submodel. */
export interface ParsedBrickRef {
  /** Lowercased LDraw filename without extension, e.g. `'3001'`, `'2412b'`. */
  partId: string;
  /** LDraw color code. Resolved through any `16` (inherit) links in the reference chain. */
  colorCode: number;
  /** World transform, LDU, +Y down — LDraw-native, no coordinate conversion applied. */
  transform: Mat4;
}

export interface ParsedModel {
  /** The name passed to `parseMpd`, usually the source filename. */
  name: string;
  /** Every part reference, in the order the file tree would draw them. */
  refs: readonly ParsedBrickRef[];
  /**
   * Indices into `refs`: a `0 STEP` occurred after this many refs had been emitted, in
   * flattened order (a submodel's own steps are interleaved at the point it is placed).
   * Retained for future instruction playback.
   */
  stepBreaks: readonly number[];
  /** Number of `0 FILE` sections in the document, including the root model itself. */
  submodelCount: number;
  /** Every distinct `partId` referenced by a leaf (never a submodel), in first-seen order. */
  uniquePartIds: readonly string[];
}

// ---------------------------------------------------------------------------
// Splitting into `0 FILE` sections
// ---------------------------------------------------------------------------

interface RefLine {
  kind: 'ref';
  colorCode: number;
  transform: Mat4;
  /** The raw file token as written, unresolved. */
  file: string;
}

interface StepLine {
  kind: 'step';
}

type Entry = RefLine | StepLine;

interface FileSection {
  name: string;
  entries: readonly Entry[];
}

const normaliseName = (name: string): string => name.trim().toLowerCase();

/**
 * `1 <colour> x y z  a b c  d e f  g h i  <file>` — the 3x3 is row-major in the file;
 * `fromBasis` wants column-major, so the transpose is the format conversion. Same
 * convention as `src/snap/resolvePart.ts`'s `referenceMatrix`.
 */
function parseRefLine(tokens: readonly string[]): RefLine | null {
  if (tokens.length < 15) return null;
  const colorCode = Number(tokens[1]);
  const nums = tokens.slice(2, 14).map(Number);
  if (Number.isNaN(colorCode) || nums.some(Number.isNaN)) return null;
  const [x, y, z, a, b, c, d, e, f, g, h, i] = nums;
  const transform = fromBasis([a, d, g, b, e, h, c, f, i], [x, y, z]);
  const file = tokens.slice(14).join(' ');
  return { kind: 'ref', colorCode, transform, file };
}

/** Strips a `.dat`/`.ldr` extension and lowercases, so a filename becomes a stable part id. */
const partIdOf = (file: string): string => file.trim().toLowerCase().replace(/\.(dat|ldr)$/i, '');

/** A bare LDraw part id: digits, then only further alphanumerics — never a hyphenated word. */
const BARE_PART_ID = /^[0-9][0-9a-z]*$/i;

/** `<set number> - <real part id>`, the OMR convention `realPartId` unwraps. */
const LOCAL_OVERRIDE_NAME = /^\d+\s*-\s*(.+)$/;

/**
 * Unwraps the LDraw Official Model Repository convention for a part that had not yet
 * reached the public library when a model was submitted: the model embeds its own copy,
 * named `<set number> - <real part id>.<ext>` (`docs/LDRAW-PRIMER.md` links the OMR spec).
 * `10281 - 65473.dat` in the bundled Bonsai Tree is one, referencing the branch elbow's
 * body only one level down, through `s\10281 - 65473s01.dat`'s own type-4 quads — geometry
 * `splitFiles` carries no structure for, since a `0 FILE` section is only ever parsed for
 * its `1` and `STEP` lines. Recursing into the embedded copy therefore reconstructs the
 * elbow from whatever loose primitives it references directly (an axle hole, a couple of
 * rings) and silently drops the curved surface those primitives sit inside — "renders, but
 * wrong," not missing. The part is official on the library now, so `flattenFile` prefers
 * resolving straight to the real id instead, through the ordinary external pipeline.
 *
 * Only called on a reference with no directory-style prefix — see `flattenFile` — so it
 * never fires on the embedded copy's own internal subpart/primitive references
 * (`s\10281 - 65473s01.dat`, `48\10281 - tm08q2639.dat`), which are not independently
 * resolvable ids.
 *
 * Returns null when the name doesn't fit the convention, or when what's left after
 * unwrapping it doesn't look like a real part id — LDCad's generated flexible-hose
 * fallback content is named `<set number> - flex-cable2.ldr`, a descriptive slug with no
 * external counterpart to resolve to, not an id. Recursing into a section this returns
 * null for is the right fallback: the id wouldn't exist externally either way, so
 * `PartGeometrySource` would report it as a plain load failure and every part it draws
 * directly would still be gone, but at least the references it makes to genuine external
 * parts (a flex hose's end caps, say) still resolve.
 */
function realPartId(fileName: string): string | null {
  const stripped = fileName.trim().replace(/\.(dat|ldr)$/i, '');
  const match = LOCAL_OVERRIDE_NAME.exec(stripped);
  if (!match) return null;
  const candidate = match[1].trim();
  return BARE_PART_ID.test(candidate) ? candidate.toLowerCase() : null;
}

/**
 * Splits raw MPD text into `0 FILE` sections. A document with no `FILE` header at all —
 * a plain single-model `.ldr` — is treated as one section named `fallbackName`.
 */
function splitFiles(text: string, fallbackName: string): FileSection[] {
  const lines = text.split(/\r?\n/);
  const sections: FileSection[] = [];
  let current: { name: string; entries: Entry[] } | null = null;

  const push = (): void => {
    if (current) sections.push(current);
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (line.length === 0) continue;

    const fileMatch = /^0\s+FILE\s+(.+)$/i.exec(line);
    if (fileMatch) {
      push();
      current = { name: fileMatch[1], entries: [] };
      continue;
    }

    if (current === null) {
      // No FILE header seen yet: treat the document itself as the (only) section.
      current = { name: fallbackName, entries: [] };
    }

    if (/^0\s+STEP\b/i.test(line)) {
      current.entries.push({ kind: 'step' });
      continue;
    }

    if (line.startsWith('1 ')) {
      const ref = parseRefLine(line.split(/\s+/));
      if (ref) current.entries.push(ref);
      continue;
    }

    // Every other line type (comments, other metas, geometry primitives) carries no
    // structure this parser needs.
  }
  push();

  return sections;
}

// ---------------------------------------------------------------------------
// Flatten
// ---------------------------------------------------------------------------

const DEFAULT_MAX_DEPTH = 24;

interface FlattenState {
  byName: Map<string, FileSection>;
  refs: ParsedBrickRef[];
  stepBreaks: number[];
  uniquePartIds: Set<string>;
  maxDepth: number;
}

function flattenFile(
  state: FlattenState,
  fileName: string,
  world: Mat4,
  colorContext: number,
  depth: number,
  chain: ReadonlySet<string>,
): void {
  const key = normaliseName(fileName);
  const section = state.byName.get(key);

  if (section === undefined) {
    // Not a declared submodel: a leaf part reference.
    const partId = partIdOf(fileName);
    const colorCode = colorContext;
    state.refs.push({ partId, colorCode, transform: world });
    state.uniquePartIds.add(partId);
    return;
  }

  if (!/[\\/]/.test(fileName.trim())) {
    // A top-level reference (never one of a part's own internal subpart/primitive
    // references, which always carry a directory-style `s\`/`48\` prefix — see
    // `realPartId`). When its name fits the OMR local-override convention, prefer the
    // real external id: it resolves through the ordinary part pipeline and gets the
    // part's actual geometry, rather than whatever `flattenFile` would reconstruct by
    // recursing through the embedded copy's own `1` lines alone.
    const real = realPartId(fileName);
    if (real !== null) {
      state.refs.push({ partId: real, colorCode: colorContext, transform: world });
      state.uniquePartIds.add(real);
      return;
    }
  }

  if (depth > state.maxDepth || chain.has(key)) return; // guards a malformed cycle
  const nested = new Set(chain).add(key);

  for (const entry of section.entries) {
    if (entry.kind === 'step') {
      state.stepBreaks.push(state.refs.length);
      continue;
    }
    const childWorld = multiply(world, entry.transform);
    const childColor = entry.colorCode === INHERIT_COLOR_CODE ? colorContext : entry.colorCode;
    flattenFile(state, entry.file, childWorld, childColor, depth + 1, nested);
  }
}

export interface ParseMpdOptions {
  /** Guards against reference cycles in malformed data. */
  maxDepth?: number;
  /**
   * Color context at the root of the document, used when the outermost reference
   * chain never resolves away from `16` (inherit). LDraw leaves this to the viewer;
   * we default to LDraw color 7 (light gray), a neutral, always-defined palette entry.
   */
  rootColorCode?: number;
}

const DEFAULT_ROOT_COLOR = 7;

/**
 * Parses and flattens an MPD (or plain `.ldr`) document.
 *
 * The first `0 FILE` section is taken as the root model, per the LDraw Official Model
 * Repository convention. Every leaf part reference is flattened into a single world
 * transform; submodels contribute no entries of their own to `refs`.
 */
export function parseMpd(text: string, name: string, options: ParseMpdOptions = {}): ParsedModel {
  const sections = splitFiles(text, name);
  const byName = new Map(sections.map((s) => [normaliseName(s.name), s]));

  const state: FlattenState = {
    byName,
    refs: [],
    stepBreaks: [],
    uniquePartIds: new Set(),
    maxDepth: options.maxDepth ?? DEFAULT_MAX_DEPTH,
  };

  const rootName = sections[0]?.name ?? name;
  flattenFile(state, rootName, IDENTITY, options.rootColorCode ?? DEFAULT_ROOT_COLOR, 0, new Set());

  return {
    name,
    refs: state.refs,
    stepBreaks: state.stepBreaks,
    submodelCount: sections.length,
    uniquePartIds: [...state.uniquePartIds],
  };
}
