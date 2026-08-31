/**
 * Turning a parsed MPD model into an editable `SceneDocument`.
 *
 * Three phases, matching the "opening a model" flow in `docs/ARCHITECTURE.md`:
 *
 * 1. Resolve every unique part's connections, bounds, and occupancy — `resolvePart` for
 *    connectivity, `partTriangles`/`boundsFromTriangles`/`buildOccupancy` for the rest —
 *    in parallel, once per distinct part id rather than once per brick.
 * 2. Mint a `BrickInstance` per flattened reference and index it in a `SpatialIndex`.
 * 3. Solve the connection graph geometrically with `findMates` (via `matesForCommit`),
 *    the same code the placement interaction uses, so an imported model's connectivity
 *    is indistinguishable from one built by hand.
 *
 * Pure in the sense that matters here: no DOM, no three.js. It does perform I/O — the
 * injected `ReadFile` fetches part data over the network (see `network.ts`) — which is
 * why every step reports progress rather than blocking. `docs/ARCHITECTURE.md` calls
 * for this to run in a worker (the "graph solver" role); it is written to the same
 * `ReadFile` boundary `resolvePart` already uses, so moving it behind a worker message
 * is a transport change, not a rewrite. It runs on the main thread for now — this
 * feature slice doesn't own `src/workers/`, and wiring a new worker is more than this
 * task carries; see the report for the explicit call-out.
 */

import { HashSpatialIndex } from '../../snap/spatialIndex';
import { resolvePart, type ReadFile } from '../../snap/resolvePart';
import { matesForCommit } from '../../snap/resolve';
import type { PartDef } from '../../snap/types';
import { partTriangles, boundsFromTriangles } from '../../ldraw/bounds';
import { buildOccupancy } from '../../snap/collision';
import { mintBrickId } from '../../model/ids';
import { createDocument, connectBricks } from '../../model/document';
import type { MateLink } from '../../model/graph';
import type { BrickInstance, SceneDocument } from '../../model/types';

import { parseMpd, type ParsedModel } from './parseMpd';

export type { ReadFile };

/** Everything resolving one part id costs, reused across every brick that references it. */
async function resolveFullPart(partId: string, read: ReadFile): Promise<PartDef> {
  const [connections, triangles] = await Promise.all([
    resolvePart(partId, read),
    partTriangles(partId, read),
  ]);
  const bounds = boundsFromTriangles(triangles);
  const occupancy = buildOccupancy(triangles, bounds, connections);
  return { id: partId, title: partId, connections, bounds, occupancy };
}

export interface ImportOptions {
  read: ReadFile;
  /** 0..1, reported per `docs/ARCHITECTURE.md`'s worker protocol convention. */
  onProgress?: (progress: number) => void;
}

export interface ImportResult {
  document: SceneDocument;
  parsed: ParsedModel;
  /** Resolved part definitions, keyed by part id — the same shape the asset cache holds. */
  partDefs: ReadonlyMap<string, PartDef>;
  brickCount: number;
  edgeCount: number;
}

/** Part resolution is the bulk of the cost; the graph solve gets the rest of the bar. */
export const RESOLVE_SHARE = 0.9;

/**
 * Parses `text`, resolves every unique part it references, places a `BrickInstance` per
 * flattened reference, and solves the connection graph geometrically.
 */
export async function importModel(
  text: string,
  name: string,
  options: ImportOptions,
): Promise<ImportResult> {
  const { read, onProgress } = options;
  const parsed = parseMpd(text, name);

  const partDefs = new Map<string, PartDef>();
  const total = parsed.uniquePartIds.length;
  let resolved = 0;
  await Promise.all(
    parsed.uniquePartIds.map(async (partId) => {
      const def = await resolveFullPart(partId, read);
      partDefs.set(partId, def);
      resolved++;
      onProgress?.(total === 0 ? RESOLVE_SHARE : (resolved / total) * RESOLVE_SHARE);
    }),
  );

  const bricks: BrickInstance[] = parsed.refs.map((ref) => ({
    id: mintBrickId(),
    partId: ref.partId,
    colorCode: ref.colorCode,
    transform: ref.transform,
  }));

  const index = new HashSpatialIndex();
  for (const brick of bricks) {
    const part = partDefs.get(brick.partId);
    if (part) index.insert(brick.id, part, brick.transform);
  }

  let document = createDocument(bricks);

  const links: MateLink[] = [];
  for (const brick of bricks) {
    const part = partDefs.get(brick.partId);
    if (!part) continue; // uncovered part: loads and renders, placed freely, no snapping
    const groups = matesForCommit(part, brick.transform, index, new Set([brick.id]));
    for (const group of groups) {
      links.push({ a: brick.id, b: group.brick, mates: group.mates });
    }
  }
  document = connectBricks(document, links);
  onProgress?.(1);

  return {
    document,
    parsed,
    partDefs,
    brickCount: bricks.length,
    edgeCount: document.graph.edges.size,
  };
}
