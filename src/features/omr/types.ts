/**
 * Shapes shared between the build-time manifest generator (`tools/build-model-manifests.ts`)
 * and the runtime picker. Not a frozen contract — this feature slice owns both sides — but
 * kept in one place so the tool and the UI can't drift apart on the shape of `index.json`.
 */

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
}
