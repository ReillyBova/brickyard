import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { flattenPathtraceInstances } from './SceneRenderer.ts';
import { InstancedBatchManager, batchKey } from './instancedBatches.ts';
import { mintBrickId } from '../model/ids.ts';

/**
 * Regression coverage for the colour bug: `flattenPathtraceInstances` (the guts of
 * `SceneRenderer.getPathtraceSnapshot()`) must recover each batch's real colour code from
 * structured mesh data, not by re-parsing `batchKey`'s `"partId colorCode"` string — see the
 * note on `InstancedBatch.createMesh` and `getPathtraceSnapshot`.
 */
describe('flattenPathtraceInstances', () => {
  it('returns one instance per tracked brick, with the correct colour code per batch', () => {
    const manager = new InstancedBatchManager();
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshBasicMaterial();

    const redBatch = manager.getOrCreate('3001', 4, geometry, material);
    const blueBatch = manager.getOrCreate('3003', 1, geometry, material);

    const redIds = [mintBrickId(), mintBrickId(), mintBrickId()];
    for (const id of redIds) {
      manager.trackBrick(id, batchKey('3001', 4));
      redBatch.add(id, new THREE.Matrix4());
    }

    const blueIds = [mintBrickId(), mintBrickId()];
    for (const id of blueIds) {
      manager.trackBrick(id, batchKey('3003', 1));
      blueBatch.add(id, new THREE.Matrix4());
    }

    const instances = flattenPathtraceInstances(manager.meshes);

    expect(instances).toHaveLength(redIds.length + blueIds.length);

    const byColor = new Map<number, number>();
    for (const instance of instances) {
      byColor.set(instance.colorCode, (byColor.get(instance.colorCode) ?? 0) + 1);
    }

    expect(byColor.get(4)).toBe(redIds.length);
    expect(byColor.get(1)).toBe(blueIds.length);
    expect(byColor.size).toBe(2);
  });

  it('skips meshes with no colour data rather than defaulting to an arbitrary colour', () => {
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial(), 1);
    mesh.count = 1;
    // No userData.colorCode set — simulates a mesh outside the InstancedBatch machinery.
    const instances = flattenPathtraceInstances([mesh]);
    expect(instances).toHaveLength(0);
  });

  it('skips a batch caught mid-construction instead of throwing, with several models loaded', () => {
    const manager = new InstancedBatchManager();
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshBasicMaterial();

    const readyBatch = manager.getOrCreate('3001', 4, geometry, material);
    const id = mintBrickId();
    manager.trackBrick(id, batchKey('3001', 4));
    readyBatch.add(id, new THREE.Matrix4());

    // A second model's batch whose geometry hasn't resolved a `position` attribute yet —
    // e.g. still mid-load — plus an entry that is missing outright (disposed batch whose
    // mesh reference never got cleaned up). Neither should crash the flatten.
    const unreadyGeometry = new THREE.BufferGeometry();
    const unreadyMesh = new THREE.InstancedMesh(unreadyGeometry, material, 1);
    unreadyMesh.count = 1;
    unreadyMesh.userData.colorCode = 1;

    const instances = flattenPathtraceInstances([
      ...manager.meshes,
      unreadyMesh,
      undefined as unknown as THREE.InstancedMesh,
    ]);

    expect(instances).toHaveLength(1);
    expect(instances[0].colorCode).toBe(4);
  });
});
