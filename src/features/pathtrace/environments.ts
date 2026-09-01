/**
 * Background environments for render mode: a sky gradient the trace shader reads on a ray
 * miss, plus a grounding floor the model sits on. Procedural, not fetched — GitHub Pages
 * can't set COOP/COEP headers and a real HDRI would be a real download cost on every visit,
 * so "environment" here means a horizon/zenith gradient and a floor material rather than an
 * image-based light. Selecting one never re-bakes the model's BVH; only the floor's own
 * small quad and material entry, plus the sky uniforms, need to change.
 */

export interface PathtraceEnvironment {
  readonly id: string;
  readonly label: string;
  /** Sky colour straight up, linear RGB. */
  readonly skyZenith: readonly [number, number, number];
  /** Sky colour at the horizon, linear RGB — where a ray grazing outward tends to land. */
  readonly skyHorizon: readonly [number, number, number];
  readonly floorColor: readonly [number, number, number];
  readonly floorRoughness: number;
}

export const ENVIRONMENTS: readonly PathtraceEnvironment[] = [
  {
    id: 'studio',
    label: 'Studio grey',
    skyZenith: [0.09, 0.09, 0.1],
    skyHorizon: [0.24, 0.24, 0.26],
    floorColor: [0.5, 0.5, 0.52],
    floorRoughness: 0.55,
  },
  {
    id: 'warm-oak',
    label: 'Warm oak',
    skyZenith: [0.1, 0.08, 0.06],
    skyHorizon: [0.32, 0.22, 0.14],
    floorColor: [0.42, 0.28, 0.17],
    floorRoughness: 0.5,
  },
  {
    id: 'cool-slate',
    label: 'Cool slate',
    skyZenith: [0.05, 0.07, 0.11],
    skyHorizon: [0.16, 0.2, 0.28],
    floorColor: [0.22, 0.26, 0.31],
    floorRoughness: 0.4,
  },
];

export const DEFAULT_ENVIRONMENT: PathtraceEnvironment = ENVIRONMENTS[0];

export function findEnvironment(id: string): PathtraceEnvironment {
  return ENVIRONMENTS.find((e) => e.id === id) ?? DEFAULT_ENVIRONMENT;
}
