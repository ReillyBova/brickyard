import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { bakePathtraceScene } from './sceneBake.ts';
import type { PathtraceBrickInstance } from '../../scene/SceneRenderer.ts';
import { BUNDLED_COLOR_LIBRARY } from '../../ldraw/bundledLibrary.ts';

function brickAt(y: number): PathtraceBrickInstance {
  return {
    geometry: new THREE.BoxGeometry(20, 24, 20),
    colorCode: 4,
    matrix: new THREE.Matrix4().makeTranslation(0, y, 0),
  };
}

describe('bakePathtraceScene floor', () => {
  it('adds no floor geometry when no floor spec is given', () => {
    const baked = bakePathtraceScene([brickAt(0)], BUNDLED_COLOR_LIBRARY);
    expect(baked.floorMaterialIndex).toBeNull();
    baked.dispose();
  });

  it('grounds the floor at the model\'s lowest point and reserves a material slot for it', () => {
    const instances = [brickAt(0), brickAt(-100)];
    const withoutFloor = bakePathtraceScene(instances, BUNDLED_COLOR_LIBRARY);
    const baked = bakePathtraceScene(instances, BUNDLED_COLOR_LIBRARY, {
      color: [0.5, 0.5, 0.5],
      roughness: 0.5,
    });

    expect(baked.floorMaterialIndex).not.toBeNull();
    // Two extra triangles (a quad) over the brick-only bake, and one extra material entry.
    expect(baked.triangleCount).toBe(withoutFloor.triangleCount + 2);
    expect(baked.materials.length).toBe(withoutFloor.materials.length + 1);
    expect(baked.materials[baked.floorMaterialIndex as number].roughness).toBeCloseTo(0.5);

    withoutFloor.dispose();
    baked.dispose();
  });

  it('grounds an empty scene with a default-sized floor rather than crashing', () => {
    const baked = bakePathtraceScene([], BUNDLED_COLOR_LIBRARY, { color: [0.5, 0.5, 0.5], roughness: 0.5 });
    expect(baked.floorMaterialIndex).toBe(0);
    expect(baked.triangleCount).toBe(2);
    baked.dispose();
  });
});
