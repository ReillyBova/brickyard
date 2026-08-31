import * as THREE from 'three';
import { beforeEach, describe, expect, it } from 'vitest';

import type { BrickId } from '../types';

import { InstancedBatch, InstancedBatchManager, batchKey } from './instancedBatches.ts';

const id = (s: string): BrickId => s as BrickId;

function testGeometry(): THREE.BufferGeometry {
  return new THREE.BoxGeometry(1, 1, 1);
}

function testMaterial(): THREE.Material {
  return new THREE.MeshBasicMaterial();
}

function matrixAt(x: number): THREE.Matrix4 {
  return new THREE.Matrix4().makeTranslation(x, 0, 0);
}

describe('batchKey', () => {
  it('combines partId and colorCode uniquely enough to differ per colour', () => {
    expect(batchKey('3001', 4)).not.toBe(batchKey('3001', 1));
    expect(batchKey('3001', 4)).not.toBe(batchKey('3002', 4));
  });
});

describe('InstancedBatch', () => {
  let batch: InstancedBatch;

  beforeEach(() => {
    batch = new InstancedBatch('3001', 4, testGeometry(), testMaterial(), 2);
  });

  it('starts empty', () => {
    expect(batch.size).toBe(0);
    expect(batch.mesh.count).toBe(0);
  });

  it('adds instances and tracks brick ids by instance index', () => {
    batch.add(id('a'), matrixAt(0));
    batch.add(id('b'), matrixAt(1));

    expect(batch.size).toBe(2);
    expect(batch.mesh.count).toBe(2);
    expect(batch.brickIdAt(0)).toBe('a');
    expect(batch.brickIdAt(1)).toBe('b');
  });

  it('grows capacity by doubling instead of erroring past the initial size', () => {
    batch.add(id('a'), matrixAt(0));
    batch.add(id('b'), matrixAt(1));
    batch.add(id('c'), matrixAt(2)); // exceeds initial capacity of 2

    expect(batch.size).toBe(3);
    expect(batch.mesh.count).toBe(3);
    // The matrix for the first two instances must survive the grow.
    const m = new THREE.Matrix4();
    batch.mesh.getMatrixAt(0, m);
    expect(m.elements[12]).toBe(0);
    batch.mesh.getMatrixAt(2, m);
    expect(m.elements[12]).toBe(2);
  });

  it('updates a transform in place without touching other instances', () => {
    batch.add(id('a'), matrixAt(0));
    batch.add(id('b'), matrixAt(1));
    batch.setTransform(id('a'), matrixAt(50));

    const m = new THREE.Matrix4();
    batch.mesh.getMatrixAt(0, m);
    expect(m.elements[12]).toBe(50);
    batch.mesh.getMatrixAt(1, m);
    expect(m.elements[12]).toBe(1);
  });

  it('removes by swap, keeping the dense range free of holes', () => {
    batch.add(id('a'), matrixAt(0));
    batch.add(id('b'), matrixAt(1));
    batch.add(id('c'), matrixAt(2));

    batch.remove(id('a'));

    expect(batch.size).toBe(2);
    expect(batch.has(id('a'))).toBe(false);
    // 'c' was the last instance, so it should have been swapped into slot 0.
    expect(batch.brickIdAt(0)).toBe('c');
    expect(batch.brickIdAt(1)).toBe('b');
  });

  it('removing an unknown id is a no-op', () => {
    batch.add(id('a'), matrixAt(0));
    batch.remove(id('nope'));
    expect(batch.size).toBe(1);
  });
});

describe('InstancedBatchManager', () => {
  it('creates one batch per (partId, colorCode) pair and reuses it', () => {
    const manager = new InstancedBatchManager();
    const geometry = testGeometry();
    const material = testMaterial();

    const a = manager.getOrCreate('3001', 4, geometry, material);
    const b = manager.getOrCreate('3001', 4, geometry, material);
    const c = manager.getOrCreate('3001', 1, geometry, material);

    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(manager.batchCount).toBe(2);
    expect(manager.root.children).toContain(a.mesh);
    expect(manager.root.children).toContain(c.mesh);
  });

  it('tracks which batch a brick lives in and removes it from there', () => {
    const manager = new InstancedBatchManager();
    const batch = manager.getOrCreate('3001', 4, testGeometry(), testMaterial());
    batch.add(id('a'), matrixAt(0));
    manager.trackBrick(id('a'), batchKey('3001', 4));

    expect(manager.batchForBrick(id('a'))).toBe(batch);
    expect(manager.instanceCount).toBe(1);

    manager.removeBrick(id('a'));

    expect(batch.has(id('a'))).toBe(false);
    expect(manager.batchForBrick(id('a'))).toBeUndefined();
    expect(manager.instanceCount).toBe(0);
  });
});
