/**
 * Reads scene overlay colours (`--by-3d-*`, `--by-canvas-grid`) from computed style
 * instead of restating them here, so ghost/grid/hover/select tints re-theme with the
 * chrome. See `docs/DESIGN.md`.
 */

import * as THREE from 'three';

import { cubicBezier, parseCubicBezier, type BezierPoints } from './easing.ts';

function computedToken(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Reads a colour custom property (e.g. `--by-3d-ghost`) as a `THREE.Color`. */
export function readColorToken(name: string, fallback: string): THREE.Color {
  const raw = computedToken(name);
  return new THREE.Color(raw || fallback);
}

/** Reads a plain-number custom property (e.g. `--by-3d-ghost-alpha`). */
export function readNumberToken(name: string, fallback: number): number {
  const raw = computedToken(name);
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : fallback;
}

const LINEAR: BezierPoints = { x1: 0, y1: 0, x2: 1, y2: 1 };

/**
 * Reads a `cubic-bezier()` custom property (e.g. `--by-ease-snap`) as an evaluable
 * easing function. Falls back to linear for anything that isn't a bezier — which is
 * exactly what `--by-ease-snap` itself becomes under `prefers-reduced-motion` (see
 * `tokens.css`), so this naturally degrades to no-overshoot without a separate check.
 */
export function readEasingToken(name: string, fallback: BezierPoints = LINEAR): (t: number) => number {
  const raw = computedToken(name);
  const parsed = parseCubicBezier(raw) ?? fallback;
  return cubicBezier(parsed);
}

/**
 * Invokes `onChange` whenever `data-theme` on `<html>` changes (per `docs/DESIGN.md`,
 * theming is always via that attribute, never a media query alone). Returns a disposer.
 */
export function watchTheme(onChange: () => void): () => void {
  const root = document.documentElement;
  const observer = new MutationObserver((mutations) => {
    if (mutations.some((m) => m.attributeName === 'data-theme')) onChange();
  });
  observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  return () => observer.disconnect();
}
