/**
 * Selection overlay: an outline around every selected brick, per docs/DESIGN.md — "no
 * per-brick handles". Mechanism only, like `ghost.ts`: what's selected is the
 * interaction layer's business, this just draws it.
 *
 * A padded axis-aligned box built from the part's own `bounds` rather than a clone of
 * its geometry: it needs no per-part mesh, no material variant per part, and reads
 * clearly as an outline without competing with the brick's own color (DESIGN.md rule
 * 3 — the bricks stay the brightest thing on screen).
 */

import * as THREE from 'three';

import type { Bounds, Mat4 } from '../types';

import { readColorToken, watchTheme } from './theme.ts';

export interface SelectionEntry {
  id: string;
  transform: Mat4;
  bounds: Bounds;
}

/** LDU. Enough that the outline clears the surface rather than z-fighting it. */
const PAD = 1;

export class SelectionOverlay {
  readonly group = new THREE.Group();
  private readonly material: THREE.LineBasicMaterial;
  private readonly meshes = new Map<string, THREE.LineSegments>();
  private readonly unwatchTheme: () => void;

  constructor() {
    this.material = new THREE.LineBasicMaterial({ color: 0xffffff });
    this.applyTheme();
    this.unwatchTheme = watchTheme(() => this.applyTheme());
  }

  private applyTheme(): void {
    this.material.color.copy(readColorToken('--by-3d-select', '#c96442'));
  }

  /** Replaces the whole outlined set. Diffs against what's already drawn. */
  set(entries: readonly SelectionEntry[]): void {
    const keep = new Set(entries.map((e) => e.id));
    for (const [id, mesh] of this.meshes) {
      if (keep.has(id)) continue;
      this.group.remove(mesh);
      mesh.geometry.dispose();
      this.meshes.delete(id);
    }

    for (const entry of entries) {
      let mesh = this.meshes.get(entry.id);
      if (!mesh) {
        mesh = new THREE.LineSegments(new THREE.BufferGeometry(), this.material);
        // Never a pick target — an outline standing in front of its own brick would
        // shadow it from the raycast that selection itself depends on.
        mesh.raycast = () => {};
        mesh.matrixAutoUpdate = false;
        this.meshes.set(entry.id, mesh);
        this.group.add(mesh);
      }

      const { min, max } = entry.bounds;
      const box = new THREE.BoxGeometry(
        max[0] - min[0] + PAD * 2,
        max[1] - min[1] + PAD * 2,
        max[2] - min[2] + PAD * 2,
      );
      box.translate((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
      const edges = new THREE.EdgesGeometry(box);
      box.dispose();
      mesh.geometry.dispose();
      mesh.geometry = edges;
      mesh.matrix.fromArray(entry.transform as unknown as number[]);
    }
  }

  dispose(): void {
    this.unwatchTheme();
    for (const mesh of this.meshes.values()) mesh.geometry.dispose();
    this.meshes.clear();
    this.material.dispose();
  }
}
