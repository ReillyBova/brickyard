import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { bakePathtraceScene, buildFloorMesh } from './sceneBake.ts';
import type { FloorSpec } from './sceneBake.ts';
import type { PathtraceBrickInstance } from '../../scene/SceneRenderer.ts';
import { BUNDLED_COLOR_LIBRARY } from '../../ldraw/bundledLibrary.ts';

const TEST_FLOOR: FloorSpec = {
  color: [0.5, 0.5, 0.5],
  roughness: 0.5,
  clearcoat: 0.2,
  clearcoatRoughness: 0.25,
  sizeMargin: 2.5,
};

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
    const baked = bakePathtraceScene(instances, BUNDLED_COLOR_LIBRARY, TEST_FLOOR);

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
    const baked = bakePathtraceScene([], BUNDLED_COLOR_LIBRARY, TEST_FLOOR);
    expect(findMesh(baked.group, 'pathtrace-floor')).not.toBeUndefined();
    expect(baked.materialCount).toBe(1);
    expect(baked.triangleCount).toBe(2);
    baked.dispose();
  });

  it('reports the model footprint and ground level for later floor-only rebuilds', () => {
    const baked = bakePathtraceScene([brickAt(0), brickAt(-100)], BUNDLED_COLOR_LIBRARY, TEST_FLOOR);
    // brickAt makes 20x24x20 boxes at LDraw (Y-down) y=0 and y=-100 — footprint is the 20-wide
    // box in X/Z. The scene root's Y-flip (docs/ARCHITECTURE.md: LDraw is Y-down) means the
    // y=0 brick — not the y=-100 one — ends up lowest in world (Y-up) space, at world Y=-12,
    // less the epsilon nudge.
    expect(baked.bounds.footprint).toBeCloseTo(20);
    expect(baked.bounds.groundLevel).toBeLessThan(-12);
    expect(baked.bounds.groundLevel).toBeGreaterThan(-12.1);
    baked.dispose();
  });
});

describe('buildFloorMesh', () => {
  it('sizes the plane to the footprint times the spec\'s margin, never below the minimum', () => {
    const wide = buildFloorMesh(0, 0, 0, 1000, TEST_FLOOR);
    const geometry = wide.geometry as THREE.PlaneGeometry;
    expect(geometry.parameters.width).toBeCloseTo(1000 * TEST_FLOOR.sizeMargin * 2);

    const tiny = buildFloorMesh(0, 0, 0, 1, TEST_FLOOR);
    const tinyGeometry = tiny.geometry as THREE.PlaneGeometry;
    // A near-zero footprint still gets a floor of at least the built-in minimum half-size.
    expect(tinyGeometry.parameters.width).toBeGreaterThan(700);

    wide.geometry.dispose();
    tiny.geometry.dispose();
  });

  it('positions the plane at the given center and level, named for later lookup', () => {
    const floor = buildFloorMesh(12, -34, -56, 500, TEST_FLOOR);
    expect(floor.name).toBe('pathtrace-floor');
    expect(floor.position.x).toBeCloseTo(12);
    expect(floor.position.y).toBeCloseTo(-56);
    expect(floor.position.z).toBeCloseTo(-34);
    floor.geometry.dispose();
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
