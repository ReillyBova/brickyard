/**
 * Camera and orbit controls. The camera and controls live in three's ordinary world
 * space (post scene-root rotation) — they never see LDU coordinates directly.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

const DEFAULT_DISTANCE = 400;

export class SceneCamera {
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;

  constructor(domElement: HTMLCanvasElement, aspect: number) {
    this.camera = new THREE.PerspectiveCamera(50, aspect, 1, 100_000);
    this.camera.position.set(DEFAULT_DISTANCE, DEFAULT_DISTANCE * 0.8, DEFAULT_DISTANCE);
    this.camera.up.set(0, 1, 0);

    this.controls = new OrbitControls(this.camera, domElement);
    this.controls.target.set(0, 0, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.1;
    this.controls.update();
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  update(): void {
    this.controls.update();
  }

  /** Fits `box` (world space, post-rotation) in view, keeping the current view direction. */
  frame(box: THREE.Box3): void {
    if (box.isEmpty()) return;

    const size = new THREE.Vector3();
    box.getSize(size);
    const center = new THREE.Vector3();
    box.getCenter(center);

    const radius = Math.max(size.length() / 2, 1);
    const fovRadians = (this.camera.fov * Math.PI) / 180;
    const distance = radius / Math.sin(fovRadians / 2);

    const direction = this.camera.position.clone().sub(this.controls.target);
    if (direction.lengthSq() < 1e-6) direction.set(1, 0.8, 1);
    direction.normalize();

    this.controls.target.copy(center);
    this.camera.position.copy(center).addScaledVector(direction, distance * 1.2);
    this.camera.near = Math.max(distance / 100, 0.1);
    this.camera.far = distance * 100;
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  dispose(): void {
    this.controls.dispose();
  }
}
