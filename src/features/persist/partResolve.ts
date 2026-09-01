/**
 * Resolves `PartDef`s for a `SceneDocument` loaded from a saved `.json` file.
 *
 * The saved format (`src/model/serialize.ts`) carries only `partId` per brick, never
 * geometry or connection data — the same reasoning that keeps `SceneDocument` itself
 * free of `PartDef`s (`docs/ARCHITECTURE.md`: "the document stores only part ids").
 * Reopening a save therefore needs the same resolution step a fresh import does, so this
 * reuses `resolveFullPart` from `src/features/omr/importModel.ts` — the exact logic that
 * turns a part id into connections, bounds and a real occupancy mask, baked-first — rather
 * than re-deriving it.
 */

import { createHttpReader } from '../../ldraw/httpReader';
import { resolveFullPart } from '../omr/importModel';
import type { PartDef } from '../../snap/types';
import type { SceneDocument } from '../../model/types';

export interface ResolvePartsOptions {
  /** 0..1, per docs/ARCHITECTURE.md's worker protocol convention. */
  onProgress?: (progress: number) => void;
}

/** Resolves every unique part id a document's bricks reference, in parallel. */
export async function resolveDocumentParts(
  doc: SceneDocument,
  options: ResolvePartsOptions = {},
): Promise<Map<string, PartDef>> {
  const read = createHttpReader();
  const uniqueIds = [...new Set([...doc.bricks.values()].map((b) => b.partId))];
  const defs = new Map<string, PartDef>();

  let resolved = 0;
  await Promise.all(
    uniqueIds.map(async (partId) => {
      const def = await resolveFullPart(partId, read);
      defs.set(partId, def);
      resolved++;
      options.onProgress?.(uniqueIds.length === 0 ? 1 : resolved / uniqueIds.length);
    }),
  );
  return defs;
}
