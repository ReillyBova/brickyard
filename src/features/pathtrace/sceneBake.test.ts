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

function findMesh(group: THREE.Group, name: string): THREE.Mesh | undefined {
  return group.children.find((child): child is THREE.Mesh => child instanceof THREE.Mesh && child.name === name);
}

describe('bakePathtraceScene floor', () => {
  it('adds no floor mesh when no floor spec is given', () => {
    const baked = bakePathtraceScene([brickAt(0)], BUNDLED_COLOR_LIBRARY);
    expect(findMesh(baked.group, 'pathtrace-floor')).toBeUndefined();
    baked.dispose();
  });

  it('grounds the floor at the model\'s lowest point and adds one material', () => {
    const instances = [brickAt(0), brickAt(-100)];
    const withoutFloor = bakePathtraceScene(instances, BUNDLED_COLOR_LIBRARY);
    const baked = bakePathtraceScene(instances, BUNDLED_COLOR_LIBRARY, {
      color: [0.5, 0.5, 0.5],
      roughness: 0.5,
    });

    const floorMesh = findMesh(baked.group, 'pathtrace-floor');
    expect(floorMesh).not.toBeUndefined();
    // Two extra triangles (a quad) over the brick-only bake, and one extra material.
    expect(baked.triangleCount).toBe(withoutFloor.triangleCount + 2);
    expect(baked.materialCount).toBe(withoutFloor.materialCount + 1);
    expect((floorMesh!.material as THREE.MeshPhysicalMaterial).roughness).toBeCloseTo(0.5);

    withoutFloor.dispose();
    baked.dispose();
  });

  it('grounds an empty scene with a default-sized floor rather than crashing', () => {
    const baked = bakePathtraceScene([], BUNDLED_COLOR_LIBRARY, { color: [0.5, 0.5, 0.5], roughness: 0.5 });
    expect(findMesh(baked.group, 'pathtrace-floor')).not.toBeUndefined();
    expect(baked.materialCount).toBe(1);
    expect(baked.triangleCount).toBe(2);
    baked.dispose();
  });
});

describe('bakePathtraceScene materials', () => {
  it('merges instances of the same colour into one mesh', () => {
    const baked = bakePathtraceScene([brickAt(0), brickAt(-24), brickAt(-48)], BUNDLED_COLOR_LIBRARY);
    const brickMeshes = baked.group.children.filter((c): c is THREE.Mesh => c instanceof THREE.Mesh);
    expect(brickMeshes).toHaveLength(1);
    expect(baked.materialCount).toBe(1);
    baked.dispose();
  });
});
