/**
 * Ghost preview: a translucent render of a part at a candidate transform, with a
 * valid/invalid visual state. This is mechanism only — imperative show/hide — not
 * behaviour. When it appears, where it moves, and how the part and transform are
 * chosen are the interaction layer's business.
 */

import * as THREE from 'three';

import type { Mat4 } from '../types';

import { readColorToken, readNumberToken, watchTheme } from './theme.ts';

export class GhostPreview {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.MeshStandardMaterial;
  private currentGeometry: THREE.BufferGeometry | null = null;
  private valid = true;
  private readonly unwatchTheme: () => void;

  constructor() {
    this.material = new THREE.MeshStandardMaterial({
      transparent: true,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
    this.mesh.visible = false;
    // Never a pick target.
    this.mesh.raycast = () => {};

    this.applyTheme();
    this.unwatchTheme = watchTheme(() => this.applyTheme());
  }

  private applyTheme(): void {
    this.material.opacity = readNumberToken('--by-3d-ghost-alpha', 0.45);
    const color = this.valid
      ? readColorToken('--by-3d-ghost', '#4caf50')
      : readColorToken('--by-3d-invalid', '#e53935');
    this.material.color.copy(color);
  }

  show(geometry: THREE.BufferGeometry, transform: Mat4, valid: boolean): void {
    if (this.currentGeometry !== geometry) {
      this.mesh.geometry = geometry;
      this.currentGeometry = geometry;
    }
    this.mesh.matrixAutoUpdate = false;
    this.mesh.matrix.fromArray(transform as unknown as number[]);
    if (valid !== this.valid) {
      this.valid = valid;
      this.applyTheme();
    }
    this.mesh.visible = true;
  }

  hide(): void {
    this.mesh.visible = false;
  }

  dispose(): void {
    this.unwatchTheme();
    this.material.dispose();
  }
}
