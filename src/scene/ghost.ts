/**
 * Ghost preview: a translucent render of a part at a candidate transform, with a
 * valid/invalid visual state. This is mechanism only — imperative show/hide — not
 * behaviour. When it appears, where it moves, and how the part and transform are
 * chosen are the interaction layer's business.
 */

import * as THREE from 'three';

import type { Mat4 } from '../types';

const VALID_COLOR = 0x4caf50;
const INVALID_COLOR = 0xe53935;

export class GhostPreview {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.MeshStandardMaterial;
  private currentGeometry: THREE.BufferGeometry | null = null;

  constructor() {
    this.material = new THREE.MeshStandardMaterial({
      color: VALID_COLOR,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
    this.mesh.visible = false;
    // Never a pick target.
    this.mesh.raycast = () => {};
  }

  show(geometry: THREE.BufferGeometry, transform: Mat4, valid: boolean): void {
    if (this.currentGeometry !== geometry) {
      this.mesh.geometry = geometry;
      this.currentGeometry = geometry;
    }
    this.mesh.matrixAutoUpdate = false;
    this.mesh.matrix.fromArray(transform as unknown as number[]);
    this.material.color.set(valid ? VALID_COLOR : INVALID_COLOR);
    this.mesh.visible = true;
  }

  hide(): void {
    this.mesh.visible = false;
  }

  dispose(): void {
    this.material.dispose();
  }
}
