/**
 * Part sourcing, colours, and baked catalog. Contract file — see docs/ARCHITECTURE.md.
 */

import type { Bounds } from '../types';

/** Material classes carried by LDConfig.ldr beyond plain solid colour. */
export type MaterialClass =
  | 'solid'
  | 'transparent'
  | 'chrome'
  | 'pearlescent'
  | 'metallic'
  | 'rubber'
  | 'glitter'
  | 'speckle';

export interface LDrawColor {
  /** LDraw colour code. 16 inherits from the parent reference; 24 is its edge colour. */
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
  /** Per-index colour codes, for parts whose subfiles hardcode colours. */
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
  /** Shadow library commit the connection data was produced from. */
  shadowCommit: string;
  /** Content hash per output file, so a stale or partial bake is detectable. */
  outputs: Readonly<Record<string, string>>;
}

/** Unique parts a bundled model needs, so loading is one parallel prefetch. */
export interface ModelManifest {
  name: string;
  partIds: readonly string[];
  brickCount: number;
}
