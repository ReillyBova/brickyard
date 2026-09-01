/**
 * Line-exact text patches for specific upstream LDraw part files whose content, as served
 * by the mirror this app fetches from (`DEFAULT_PARTS_BASE_URL` in `src/scene/partSource.ts`,
 * a snapshot of the LDraw Parts Library), has not caught up with a fix already published in
 * the canonical library (library.ldraw.org).
 *
 * `973p1u.dat` (Minifig Torso with Zipper Jacket and 3 Pockets Pattern) is the motivating
 * case: its three back-panel quads were authored wound inward — CCW as seen from *inside*
 * the torso rather than from outside — so `LDrawLoader`'s BFC back-face culling correctly
 * drops them, and the shell's interior (arm-socket recesses, ribbing) shows through from
 * behind. This is not a bug in this app's BFC handling: the same three quads, loaded
 * standalone and probed with a raycaster from every direction, cull correctly everywhere
 * except this exact panel, and the file's *front* panel (also loaded through the same code
 * path) has no such fault. The canonical library fixed exactly this on 2023-01-15
 * (`0 !HISTORY 2023-01-15 [cuddlyogre] Fix winding for back side.`), reversing each quad's
 * vertex order. Our mirror's most recent sync of this file is dated 2023-01-30 — after the
 * official fix — but still carries the pre-fix vertex order, so the fix never made it
 * through. This patch reproduces the corrected lines verbatim from the canonical library.
 *
 * Matching is by exact whole-line text (trimmed), so a line that no longer matches — because
 * the mirror has since synced past this point on its own — is left untouched rather than
 * silently corrupting content this patch no longer recognises.
 */
const KNOWN_CORRECTIONS: ReadonlyMap<string, ReadonlyMap<string, string>> = new Map([
  [
    '973p1u',
    new Map([
      ['4 16 14.345 2 10 12 0 10 -12 0 10 -14.345 2 10', '4 16 -14.345 2 10 -12 0 10 12 0 10 14.345 2 10'],
      ['4 16 19 29 10 14.345 2 10 -14.345 2 10 -19 29 10', '4 16 -19 29 10 -14.345 2 10 14.345 2 10 19 29 10'],
      ['4 16 19 32 10 19 29 10 -19 29 10 -19 32 10', '4 16 -19 32 10 -19 29 10 19 29 10 19 32 10'],
    ]),
  ],
]);

/** Strips a path prefix and extension so `parts/973P1U.DAT` and `973p1u` key the same entry. */
function normalisePartId(partId: string): string {
  const base = partId.split(/[\\/]/).pop() ?? partId;
  return base.replace(/\.dat$/i, '').toLowerCase();
}

/**
 * Applies any known correction to one part's raw `.dat` text. `partId` may be a bare id
 * (`973p1u`) or a path/filename in any case (`parts/973P1U.DAT`) — both resolve to the same
 * entry. Text with no matching entry, or whose lines no longer match verbatim, passes
 * through unchanged.
 */
export function applyKnownCorrections(partId: string, text: string): string {
  const patch = KNOWN_CORRECTIONS.get(normalisePartId(partId));
  if (patch === undefined) return text;
  return text
    .split(/\r\n|\r|\n/)
    .map((line) => patch.get(line.trim()) ?? line)
    .join('\n');
}
