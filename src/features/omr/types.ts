/**
 * Shapes shared between the build-time manifest generator (`tools/build-model-manifests.ts`)
 * and the runtime picker. Not a frozen contract — this feature slice owns both sides — but
 * kept in one place so the tool and the UI can't drift apart on the shape of `index.json`.
 */

/**
 * Why a set is called out above the plain list, if at all. `popular` sets are curated
 * deliberately — recognisable, quick to load, visually interesting — never derived by
 * sorting on a field. `jumbo` sets are explicitly for finding where large-model import
 * and render performance breaks down; see `docs/PREBAKE.md` and the model picker's own
 * "stress test size" tag.
 */
export type ModelCuration = 'popular' | 'jumbo' | null;

/** One entry in `public/models/index.json`. */
export interface BundledModelEntry {
  slug: string;
  name: string;
  mpdFile: string;
  manifestFile: string;
  brickCount: number;
  uniquePartCount: number;
  sizeBytes: number;
  submodelCount: number;
  stepCount: number;
  /** LEGO set number, e.g. '10276'. Search matches this and `name`. */
  setNumber: string;
  /** OMR theme string, e.g. 'Creator Expert', 'Star Wars Ultimate Collector Series'. */
  theme: string;
  /** Release year of the physical set. */
  year: number;
  /** Official LEGO piece count for the set, distinct from `brickCount` (the count this
   *  MPD actually parses to — LDraw models sometimes omit stickers/decorated variants). */
  officialPieceCount: number;
  curated: ModelCuration;
}
