/**
 * Frame-time controller and resolution ladder for the path tracer. Pure — no three.js, no DOM —
 * so it is unit-tested directly and reusable regardless of what drives it.
 *
 * Ported from a reference SVGF-style tracer the user supplied, with one change: instantaneous
 * per-frame cost is paid for with fractional samples-per-pixel first (the EMA/hysteresis below),
 * and *resolution* only steps up once the image has actually settled for a run of frames. That
 * decoupling is the point: a camera that's been still for a second always reaches full
 * resolution, no matter how expensive a single sample is, because cost is absorbed by spp instead.
 * A camera that's still moving never bothers paying for resolution it's about to throw away.
 */

export interface ResolutionState {
  /** Exponential moving average of frame time, ms. 0 means "no samples yet". */
  readonly ema: number;
  /** Fractional samples-per-pixel for this frame, before rounding for the shader. */
  readonly spp: number;
  /** Index into `scales` — the current resolution ladder rung. */
  readonly level: number;
  /** Frames rendered without a reset. Drives the ladder; never reset by a level change. */
  readonly settled: number;
  /** Consecutive over-budget frames observed below the top rung, for the regression guard. */
  readonly overBudgetStreak: number;
  /** True on the one frame a level change just happened — the caller's cue to reuse partial history rather than snapping (see `PathTracerController`'s `uHistScale`). */
  readonly justStepped: boolean;
}

export interface ResolutionPolicy {
  /** Resolution scale per ladder rung, ascending; the last entry is full resolution. */
  readonly scales: readonly number[];
  /** Settled-frame count needed to advance from rung `i` to `i + 1`. Length `scales.length - 1`. */
  readonly stepAt: readonly number[];
  /** Frame budget, ms. The brief's "30fps floor" — not an emergency threshold, the target itself. */
  readonly targetMs: number;
  /** Ceiling on samples-per-pixel once frame time is comfortably under budget. */
  readonly sppCap: number;
  /** EMA smoothing factor for frame time. */
  readonly emaAlpha: number;
}

export const DEFAULT_RESOLUTION_POLICY: ResolutionPolicy = {
  scales: [0.4, 0.7, 1.0],
  stepAt: [8, 20],
  targetMs: 1000 / 30,
  sppCap: 4,
  emaAlpha: 0.1,
};

export function initialResolutionState(): ResolutionState {
  return { ema: 0, spp: 1, level: 0, settled: 0, overBudgetStreak: 0, justStepped: false };
}

/**
 * One controller tick. Call once per rendered frame with the just-measured frame time.
 * `cameraMoved` is the camera-motion signal from `PathTracerController` — a full reset (dropping
 * straight back to the cheapest rung and 1 spp), the same as `invalidate()` in the reference.
 */
export function nextResolutionState(
  prev: ResolutionState,
  input: { frameMs: number; cameraMoved: boolean },
  policy: ResolutionPolicy = DEFAULT_RESOLUTION_POLICY,
): ResolutionState {
  if (input.cameraMoved) {
    return { ema: prev.ema, spp: 1, level: 0, settled: 0, overBudgetStreak: 0, justStepped: false };
  }

  const ema =
    prev.ema === 0 ? input.frameMs : prev.ema * (1 - policy.emaAlpha) + input.frameMs * policy.emaAlpha;

  let spp = prev.spp;
  if (ema > policy.targetMs * 1.08) spp = Math.max(1, spp - 0.35);
  else if (ema < policy.targetMs * 0.82) spp = Math.min(policy.sppCap, spp + 0.15);

  const topLevel = policy.scales.length - 1;
  let level = prev.level;
  const settled = prev.settled + 1;
  let overBudgetStreak = prev.overBudgetStreak;
  let justStepped = false;

  if (level < topLevel && settled >= policy.stepAt[level]) {
    level += 1;
    justStepped = true;
    overBudgetStreak = 0;
  } else if (
    level > 0 &&
    settled < policy.stepAt[level - 1] &&
    Math.round(spp) <= 1 &&
    ema > policy.targetMs * 1.15
  ) {
    overBudgetStreak += 1;
    if (overBudgetStreak > 20) {
      level -= 1;
      justStepped = true;
      overBudgetStreak = 0;
    }
  } else {
    overBudgetStreak = 0;
  }

  return { ema, spp, level, settled, overBudgetStreak, justStepped };
}

/** Resolution scale for the state's current rung, e.g. `0.4` at rung 0. */
export function renderScaleFor(
  state: ResolutionState,
  policy: ResolutionPolicy = DEFAULT_RESOLUTION_POLICY,
): number {
  return policy.scales[state.level];
}

/** Integer samples-per-pixel to submit this frame. */
export function sppFor(state: ResolutionState): number {
  return Math.max(1, Math.round(state.spp));
}
