/**
 * The grounding floor's own controls: how big a plane it is, what colour it is, and how the
 * surface itself behaves under light — independent of which environment map is lighting the
 * scene. Pure — no three.js, no DOM — `sceneBake.ts` and `PathTracerController` turn these into
 * real geometry and `MeshPhysicalMaterial` parameters.
 *
 * `size` and `visible` change the floor's *geometry*, which three-gpu-pathtracer has no
 * incremental update for — changing it costs a real `setScene()` BVH rebuild (see
 * `PathTracerController.updateGroundGeometry`). `color` and `material` only touch the floor
 * mesh's own `MeshPhysicalMaterial`, the same cheap path environment swaps already use for the
 * floor (`PathTracerController.updateGroundMaterial`) — no rebuild, safe to drag live.
 */

export type GroundSize = 'tight' | 'medium' | 'broad' | 'infinite';
export type GroundFinish = 'matte' | 'satin' | 'glossy' | 'mirror';

export interface GroundSettings {
  /** Hidden entirely — no floor mesh, no shadow-catcher, the model floats on the environment
   *  alone. The cheapest possible ground, and the other useful endpoint from `infinite`. */
  readonly visible: boolean;
  readonly size: GroundSize;
  readonly finish: GroundFinish;
  readonly color: readonly [number, number, number];
}

export const DEFAULT_GROUND: GroundSettings = {
  visible: true,
  size: 'medium',
  finish: 'satin',
  color: [0.5, 0.5, 0.52],
};

/** How far the floor's edge extends past the model's own footprint, as a multiple of it — the
 *  same role `FLOOR_MARGIN_FACTOR` played before this was a user control. `infinite` isn't
 *  actually unbounded (a real plane still is), just large enough that its edge never appears in
 *  frame for any reasonable camera distance. */
export const GROUND_SIZE_MARGIN: Record<GroundSize, number> = {
  tight: 1.15,
  medium: 2.5,
  broad: 6,
  infinite: 60,
};

export const GROUND_SIZE_LABEL: Record<GroundSize, string> = {
  tight: 'Tight',
  medium: 'Medium',
  broad: 'Broad',
  infinite: 'Infinite',
};

export const GROUND_SIZE_TOOLTIP: Record<GroundSize, string> = {
  tight: 'A plane barely bigger than the model — just enough to catch a shadow',
  medium: 'A plane a few model-widths across — the default',
  broad: 'A wide plane, most of the visible horizon',
  infinite: 'A plane so large its edge never appears in frame',
};

/** Roughness/clearcoat pairing for each finish, from a chalky matte plastic through a
 *  near-perfect mirror. Clearcoat rather than metalness carries the reflective end — a shiny
 *  floor under a brick model should read as polished stone or lacquer, not sheet metal. */
export interface GroundFinishParams {
  readonly roughness: number;
  readonly clearcoat: number;
  readonly clearcoatRoughness: number;
}

export const GROUND_FINISH_PARAMS: Record<GroundFinish, GroundFinishParams> = {
  matte: { roughness: 0.95, clearcoat: 0, clearcoatRoughness: 0.4 },
  satin: { roughness: 0.5, clearcoat: 0.2, clearcoatRoughness: 0.25 },
  glossy: { roughness: 0.18, clearcoat: 0.6, clearcoatRoughness: 0.1 },
  mirror: { roughness: 0.03, clearcoat: 0.9, clearcoatRoughness: 0.03 },
};

export const GROUND_FINISH_LABEL: Record<GroundFinish, string> = {
  matte: 'Matte',
  satin: 'Satin',
  glossy: 'Glossy',
  mirror: 'Mirror',
};

export const GROUND_FINISH_TOOLTIP: Record<GroundFinish, string> = {
  matte: 'A chalky, non-reflective surface — no highlights, no reflections',
  satin: 'A soft sheen — a faint, blurred reflection',
  glossy: 'A polished surface with a clear but soft reflection',
  mirror: 'A near-mirror finish — sharp reflections of the model and environment',
};

export interface GroundSwatch {
  readonly id: string;
  readonly label: string;
  readonly color: readonly [number, number, number];
}

/** A small curated set rather than an open colour wheel — the palette that actually flatters a
 *  product shot: neutral greys anchoring most of the range, plus a couple of warm/cool options
 *  for environments that want to match or contrast their floor. */
export const GROUND_SWATCHES: readonly GroundSwatch[] = [
  { id: 'white', label: 'White', color: [0.88, 0.88, 0.88] },
  { id: 'pale', label: 'Pale grey', color: [0.7, 0.7, 0.7] },
  { id: 'neutral', label: 'Neutral grey', color: [0.5, 0.5, 0.52] },
  { id: 'charcoal', label: 'Charcoal', color: [0.22, 0.22, 0.23] },
  { id: 'black', label: 'Black', color: [0.05, 0.05, 0.06] },
  { id: 'sand', label: 'Sand', color: [0.58, 0.5, 0.38] },
  { id: 'walnut', label: 'Walnut', color: [0.3, 0.2, 0.14] },
  { id: 'slate', label: 'Slate blue', color: [0.32, 0.37, 0.42] },
  { id: 'sage', label: 'Sage', color: [0.42, 0.47, 0.38] },
];
