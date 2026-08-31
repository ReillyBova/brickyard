/**
 * The real chest catalog: part ids, titles and categories read from actual LDraw part
 * files by `tools/build-chest-catalog.ts` and written to `catalog.generated.json`. That
 * script prefers the local mirror (`.cache/ldraw/`, populated by `npm run sync-mirror`)
 * and falls back to the committed fixtures in `__fixtures__/mirror/` otherwise — see its
 * header comment for the full precedence. The JSON here is the checked-in result of the
 * fixtures path, so the chest has real names and a working catalog with no mirror synced;
 * re-running the build script against a synced mirror widens it to the full curated set.
 *
 * Shaped as `ChestPart`, not the frozen `CatalogEntry` contract from `src/ldraw/types.ts`
 * — same reasoning as `types.ts`: this slice stays decoupled from the ldraw slice's
 * runtime machinery.
 */
import catalogJson from './catalog.generated.json';
import type { ChestPart } from './types';

export const PART_CATALOG: readonly ChestPart[] = catalogJson satisfies ChestPart[];
