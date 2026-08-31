/**
 * Local to the UI slice. Deliberately not the `CatalogEntry` contract from
 * `src/ldraw/types.ts` — the chest is built and tested against mock data only, so it
 * must not carry a compile-time dependency on the parallel ldraw/scene work. The shapes
 * are compatible by design; wiring in the real catalog later is a mapping, not a rewrite.
 */
export interface ChestPart {
  /** LDraw part number, e.g. '3001'. */
  id: string;
  /** LDraw part title, e.g. 'Brick  2 x  4'. */
  title: string;
  category: string;
}
