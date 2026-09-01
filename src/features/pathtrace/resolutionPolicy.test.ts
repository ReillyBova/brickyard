import { describe, expect, it } from 'vitest';

import {
  DEFAULT_RESOLUTION_POLICY,
  initialResolutionState,
  nextResolutionState,
  renderScaleFor,
  sppFor,
} from './resolutionPolicy.ts';
import type { ResolutionState } from './resolutionPolicy.ts';

const CHEAP_FRAME_MS = 5; // well under the 33.3ms/30fps target
const EXPENSIVE_FRAME_MS = 80; // well over

function runFrames(
  state: ResolutionState,
  count: number,
  frameMs: number,
  cameraMoved = false,
): ResolutionState {
  let next = state;
  for (let i = 0; i < count; i++) {
    next = nextResolutionState(next, { frameMs, cameraMoved });
  }
  return next;
}

describe('resolutionPolicy', () => {
  it('starts at the cheapest rung and 1 spp', () => {
    const state = initialResolutionState();
    expect(state.level).toBe(0);
    expect(renderScaleFor(state)).toBe(DEFAULT_RESOLUTION_POLICY.scales[0]);
    expect(sppFor(state)).toBe(1);
  });

  it('camera movement resets to the cheapest rung and 1 spp, regardless of prior state', () => {
    const settled = runFrames(initialResolutionState(), 30, CHEAP_FRAME_MS);
    expect(settled.level).toBeGreaterThan(0);

    const reset = nextResolutionState(settled, { frameMs: CHEAP_FRAME_MS, cameraMoved: true });
    expect(reset.level).toBe(0);
    expect(reset.spp).toBe(1);
    expect(reset.settled).toBe(0);
  });

  it('steps up the resolution ladder as frames settle, all the way to full resolution', () => {
    let state = initialResolutionState();
    expect(state.level).toBe(0);

    state = runFrames(state, DEFAULT_RESOLUTION_POLICY.stepAt[0], CHEAP_FRAME_MS);
    expect(state.level).toBe(1);

    state = runFrames(
      state,
      DEFAULT_RESOLUTION_POLICY.stepAt[1] - DEFAULT_RESOLUTION_POLICY.stepAt[0],
      CHEAP_FRAME_MS,
    );
    expect(state.level).toBe(2);
    expect(renderScaleFor(state)).toBe(1);
  });

  it('never advances past the top rung', () => {
    const state = runFrames(initialResolutionState(), 200, CHEAP_FRAME_MS);
    expect(state.level).toBe(DEFAULT_RESOLUTION_POLICY.scales.length - 1);
  });

  it('raises spp toward the cap when comfortably under budget', () => {
    const state = runFrames(initialResolutionState(), 60, CHEAP_FRAME_MS);
    expect(sppFor(state)).toBe(DEFAULT_RESOLUTION_POLICY.sppCap);
  });

  it('lowers spp toward 1 when frames are expensive', () => {
    // Get spp up first, then hammer it with expensive frames.
    let state = runFrames(initialResolutionState(), 60, CHEAP_FRAME_MS);
    expect(state.spp).toBeGreaterThan(1);
    state = runFrames(state, 20, EXPENSIVE_FRAME_MS);
    expect(sppFor(state)).toBe(1);
  });

  it('flags justStepped exactly on the frame a rung changes', () => {
    let state = initialResolutionState();
    let steppedCount = 0;
    for (let i = 0; i < DEFAULT_RESOLUTION_POLICY.stepAt[0]; i++) {
      state = nextResolutionState(state, { frameMs: CHEAP_FRAME_MS, cameraMoved: false });
      if (state.justStepped) steppedCount++;
    }
    expect(steppedCount).toBe(1);
    expect(state.level).toBe(1);
  });

  it('keeps scale and spp within policy bounds under sustained expensive frames', () => {
    const state = runFrames(initialResolutionState(), 100, EXPENSIVE_FRAME_MS);
    const scale = renderScaleFor(state);
    expect(scale).toBeGreaterThanOrEqual(DEFAULT_RESOLUTION_POLICY.scales[0]);
    expect(scale).toBeLessThanOrEqual(1);
    expect(sppFor(state)).toBeGreaterThanOrEqual(1);
    expect(sppFor(state)).toBeLessThanOrEqual(DEFAULT_RESOLUTION_POLICY.sppCap);
  });
});
