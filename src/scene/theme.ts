/**
 * Reads scene overlay colours (`--by-3d-*`, `--by-canvas-grid`) from computed style
 * instead of restating them here, so ghost/grid/hover/select tints re-theme with the
 * chrome. See `docs/DESIGN.md`.
 */

import * as THREE from 'three';

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
