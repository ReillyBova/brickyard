/**
 * Frame-time controller and resolution ladder for the path tracer. Pure — no three.js, no DOM —
 * so it is unit-tested directly and reusable regardless of what drives it.
 *
 * Ported from a reference SVGF-style tracer the user supplied, with one change found necessary
 * against a real model (Galaxy Explorer, ~350k triangles): the reference lets resolution climb
 * on elapsed "settled" frames alone, trusting spp to absorb all of the cost. That works for an
 * analytic Cornell box; it does not for a real BVH, where resolution itself dominates cost and
 * spp was already pinned at its floor. Climbing to full resolution there measured under 1fps —
 * settled frames kept accumulating even while each one took the better part of a second. Both
 * ascent and regression are therefore gated on measured frame time here, not just elapsed frames:
 * a rung is only climbed while comfortably under budget, and is given up after a sustained streak
 * of badly-over-budget frames even once spp has nothing left to give.
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
  /** A rung only climbs while `ema < targetMs * ascendEmaFactor` — room to spend more. */
  readonly ascendEmaFactor: number;
  /** Sustained `ema > targetMs * regressEmaFactor` (with spp already at its floor) gives up a rung. */
  readonly regressEmaFactor: number;
  /** Consecutive badly-over-budget frames required before regressing, so one hitch doesn't flap it. */
  readonly regressStreak: number;
}

export const DEFAULT_RESOLUTION_POLICY: ResolutionPolicy = {
  scales: [0.4, 0.7, 1.0],
  stepAt: [8, 20],
  targetMs: 1000 / 30,
  sppCap: 4,
  emaAlpha: 0.1,
  ascendEmaFactor: 1.05,
  regressEmaFactor: 1.5,
  regressStreak: 5,
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

  const comfortablyUnderBudget = ema < policy.targetMs * policy.ascendEmaFactor;
  // spp is already at its floor when this is checked, so a still-slow frame means
  // resolution — not sampling — is the cost that has to give.
  const badlyOverBudget = ema > policy.targetMs * policy.regressEmaFactor && Math.round(spp) <= 1;

  if (badlyOverBudget) {
    overBudgetStreak += 1;
    if (overBudgetStreak > policy.regressStreak && level > 0) {
      level -= 1;
      justStepped = true;
      overBudgetStreak = 0;
    }
  } else {
    overBudgetStreak = 0;
    if (level < topLevel && settled >= policy.stepAt[level] && comfortablyUnderBudget) {
      level += 1;
      justStepped = true;
    }
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
