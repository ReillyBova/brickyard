/**
 * Part sourcing, colors, and baked catalog. Contract file — see docs/ARCHITECTURE.md.
 */

import type { Bounds } from '../types';

/** Material classes carried by LDConfig.ldr beyond plain solid color. */
export type MaterialClass =
  | 'solid'
  | 'transparent'
  | 'chrome'
  | 'pearlescent'
  | 'metallic'
  | 'rubber'
  | 'glitter'
  | 'speckle'
  /** LDConfig MATERIAL FABRIC — capes, sails, and similar. */
  | 'fabric';

export interface LDrawColor {
  /** LDraw color code. 16 inherits from the parent reference; 24 is its edge color. */
  code: number;
  name: string;
  /** 0xRRGGBB. */
  value: number;
  edge: number;
  /** 0–255; absent means opaque. */
  alpha?: number;
  luminance?: number;
  material: MaterialClass;
}

export type ColorLibrary = ReadonlyMap<number, LDrawColor>;

/** Flattened, deduplicated geometry for one part. Transferable across a worker boundary. */
export interface PartGeometry {
  partId: string;
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  /** Per-index color codes, for parts whose subfiles hardcode colors. */
  colorCodes?: Uint16Array;
  bounds: Bounds;
}

/** One entry in the baked chest catalog. */
export interface CatalogEntry {
  partId: string;
  title: string;
  category: string;
  /** Delivery tier, see docs/PREBAKE.md. */
  tier: 'bundled' | 'hosted' | 'fetched';
}

export interface BakedManifest {
  /** Upstream parts library release the bake was produced from. */
  libraryVersion: string;
  /**
   * Shadow library version the connection data was produced from. Any identifier that
   * changes when the contents change — the archive digest is sufficient, and avoids an
   * extra upstream request purely to learn a commit SHA.
   */
  shadowVersion: string;
  /** `BAKED_FORMAT_VERSION` (`src/snap/baked.ts`) — the byte layout of connections.bin and
   *  occupancy.bin at bake time. */
  bakedFormatVersion: number;
  /** `SEMANTICS_VERSION` (`src/snap/baked.ts`) — what the packed fields in connections.bin
   *  and occupancy.bin meant at bake time. */
  semanticsVersion: number;
  /** `GEOMETRY_FORMAT_VERSION` (`src/ldraw/geometryBaked.ts`) — the byte layout of
   *  geometry.bin at bake time. */
  geometryFormatVersion: number;
  /** `GEOMETRY_SEMANTICS_VERSION` (`src/ldraw/geometryBaked.ts`) — what geometry.bin's
   *  attributes meant at bake time. */
  geometrySemanticsVersion: number;
  /**
   * sha256 over the packed fixture corpus at bake time — see `src/snap/fixtureDigest.ts`.
   * `src/snap/manifestVersions.test.ts` recomputes it from the current code and fails if it
   * disagrees with this committed value, so a semantics bump that never got re-baked fails
   * the build instead of shipping.
   */
  fixtureDigest: string;
  /**
   * Parts written to the hosted tier — `baked/geometry/<partId>.bin`, one file each,
   * fetched on demand. Scoped to what the bundled models use; see `docs/PREBAKE.md`.
   */
  hostedGeometryParts: number;
  /**
   * One sha256 over every hosted file, in part-id order. A per-file entry in `outputs`
   * for each of hundreds of parts would bury the handful of entries a person reads, so
   * the set is covered by a single hash instead.
   */
  hostedGeometryDigest: string;
  /** Content hash per output file, so a stale or partial bake is detectable. */
  outputs: Readonly<Record<string, string>>;
}

/** Unique parts a bundled model needs, so loading is one parallel prefetch. */
export interface ModelManifest {
  name: string;
  partIds: readonly string[];
  brickCount: number;
}
