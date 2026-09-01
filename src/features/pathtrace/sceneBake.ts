/**
 * Flattens the live `InstancedMesh` batches into one merged, BVH-indexed triangle soup the trace
 * shader can walk. Four concerns, in order:
 *
 * 1. No path tracer built on `three-mesh-bvh` — including this one — understands instancing, so
 *    every brick instance's matrix (and the scene root's `rotation.x = π` LDU flip) gets baked
 *    directly into merged vertex positions/normals here, once, rather than at trace time.
 * 2. Each vertex carries a `materialIndex` into a small per-scene material bank (`materials.ts`),
 *    built from the distinct LDraw color codes actually present — almost always well under the
 *    `MAX_MATERIALS` cap a typical baseplate uses.
 * 3. `three-mesh-bvh`'s `MeshBVHUniformStruct` does the actual BVH-to-texture packing; this module
 *    only has to hand it a normal geometry and add the two textures the shader needs beyond
 *    position and BVH topology (smooth normal, material index) via the same
 *    `VertexAttributeTexture` machinery it already uses internally.
 * 4. A grounding floor quad, sized to the model and positioned at its lowest point, is merged
 *    in alongside the bricks so it participates in the same BVH — real cast shadows, from the
 *    same next-event shadow ray, at no extra tracing cost.
 */

import * as THREE from 'three';
import { MeshBVH, MeshBVHUniformStruct, FloatVertexAttributeTexture, UIntVertexAttributeTexture } from 'three-mesh-bvh';

import type { ColorLibrary, LDrawColor } from '../../ldraw/types.ts';
import { ROOT_ROTATION_X } from '../../scene/coords.ts';
import type { PathtraceBrickInstance } from '../../scene/SceneRenderer.ts';

import { physicalParamsFor } from './materials.ts';
import type { PathtraceMaterial } from './materials.ts';

/** Uniform array size in the trace shader — see `MAX_MATERIALS` in `shaders.ts`. */
export const MAX_MATERIALS = 32;

const FALLBACK_COLOR: LDrawColor = {
  code: 16,
  name: 'Fallback',
  value: 0xa0a0a0,
  edge: 0x333333,
  material: 'solid',
};

/** Minimum floor half-extent (world units, same scale as LDU) for an empty or tiny model. */
const MIN_FLOOR_HALF_SIZE = 400;
/** How far the floor's edge extends past the model's own footprint. */
const FLOOR_MARGIN_FACTOR = 2.5;
/** Nudges the floor a hair below the model's lowest vertex, so coplanar faces don't z-fight. */
const FLOOR_EPSILON = 0.05;

export interface FloorSpec {
  readonly color: readonly [number, number, number];
  readonly roughness: number;
}

export interface BakedPathtraceScene {
  readonly bvhUniform: InstanceType<typeof MeshBVHUniformStruct>;
  readonly normalTexture: InstanceType<typeof FloatVertexAttributeTexture>;
  readonly materialIndexTexture: InstanceType<typeof UIntVertexAttributeTexture>;
  /** Indexed by the `materialIndex` each vertex carries. Never longer than `MAX_MATERIALS`. */
  readonly materials: readonly PathtraceMaterial[];
  /** `materials` index the floor quad's triangles carry, or null when no floor was baked. */
  readonly floorMaterialIndex: number | null;
  readonly triangleCount: number;
  readonly vertexCount: number;
  dispose(): void;
}

/**
 * Merges every brick instance into one geometry, builds its BVH, and packs everything the trace
 * shader reads. Synchronous — the merge is plain array copying, and this typical scene's vertex
 * count keeps it well under a frame budget's worth of blocking, but callers still run it inside an
 * async "building scene…" step so a slow one is never mistaken for a hang.
 */
export function bakePathtraceScene(
  instances: readonly PathtraceBrickInstance[],
  colorLibrary: ColorLibrary,
  floor?: FloorSpec,
): BakedPathtraceScene {
  const materialIndexOf = new Map<number, number>();
  const materials: PathtraceMaterial[] = [];
  // Reserve one bank slot for the floor so it never displaces a real brick colour.
  const materialCapacity = floor !== undefined ? MAX_MATERIALS - 1 : MAX_MATERIALS;

  const materialIndexFor = (colorCode: number): number => {
    const existing = materialIndexOf.get(colorCode);
    if (existing !== undefined) return existing;
    if (materials.length >= materialCapacity) return materials.length - 1;
    const entry = colorLibrary.get(colorCode) ?? FALLBACK_COLOR;
    const index = materials.length;
    materials.push(physicalParamsFor(entry));
    materialIndexOf.set(colorCode, index);
    return index;
  };

  let totalVertices = 0;
  let totalIndices = 0;
  for (const instance of instances) {
    const position = instance.geometry.getAttribute('position');
    totalVertices += position.count;
    totalIndices += instance.geometry.index !== null ? instance.geometry.index.count : position.count;
  }

  const floorVertexCount = floor !== undefined ? 4 : 0;
  const floorIndexCount = floor !== undefined ? 6 : 0;

  const positions = new Float32Array((totalVertices + floorVertexCount) * 3);
  const normals = new Float32Array((totalVertices + floorVertexCount) * 3);
  const materialIndices = new Uint32Array(totalVertices + floorVertexCount);
  const indices = new Uint32Array(totalIndices + floorIndexCount);

  const rootRotation = new THREE.Matrix4().makeRotationX(ROOT_ROTATION_X);
  const combined = new THREE.Matrix4();
  const normalMatrix = new THREE.Matrix3();
  const vertex = new THREE.Vector3();

  let vertexCursor = 0;
  let indexCursor = 0;

  // Tracks the model's world-space (Y-up) footprint as vertices are baked, so the floor
  // (below) can be sized and positioned to it without a second pass over the geometry.
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  for (const instance of instances) {
    const geometry = instance.geometry;
    const position = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal');
    const vertexBase = vertexCursor;
    const materialIndex = materialIndexFor(instance.colorCode);

    combined.multiplyMatrices(rootRotation, instance.matrix);
    normalMatrix.getNormalMatrix(combined);

    for (let i = 0; i < position.count; i++) {
      vertex.fromBufferAttribute(position, i).applyMatrix4(combined);
      positions[vertexCursor * 3] = vertex.x;
      positions[vertexCursor * 3 + 1] = vertex.y;
      positions[vertexCursor * 3 + 2] = vertex.z;
      if (vertex.x < minX) minX = vertex.x;
      if (vertex.x > maxX) maxX = vertex.x;
      if (vertex.y < minY) minY = vertex.y;
      if (vertex.z < minZ) minZ = vertex.z;
      if (vertex.z > maxZ) maxZ = vertex.z;

      vertex.fromBufferAttribute(normal, i).applyMatrix3(normalMatrix).normalize();
      normals[vertexCursor * 3] = vertex.x;
      normals[vertexCursor * 3 + 1] = vertex.y;
      normals[vertexCursor * 3 + 2] = vertex.z;

      materialIndices[vertexCursor] = materialIndex;
      vertexCursor += 1;
    }

    if (geometry.index !== null) {
      const sourceIndex = geometry.index;
      for (let i = 0; i < sourceIndex.count; i++) {
        indices[indexCursor] = vertexBase + sourceIndex.getX(i);
        indexCursor += 1;
      }
    } else {
      for (let i = 0; i < position.count; i++) {
        indices[indexCursor] = vertexBase + i;
        indexCursor += 1;
      }
    }
  }

  let floorMaterialIndex: number | null = null;
  if (floor !== undefined) {
    const hasGeometry = totalVertices > 0;
    const centerX = hasGeometry ? (minX + maxX) / 2 : 0;
    const centerZ = hasGeometry ? (minZ + maxZ) / 2 : 0;
    const footprint = hasGeometry ? Math.max(maxX - minX, maxZ - minZ) : 0;
    const halfSize = Math.max(MIN_FLOOR_HALF_SIZE, footprint * FLOOR_MARGIN_FACTOR);
    const level = (hasGeometry ? minY : 0) - FLOOR_EPSILON;

    floorMaterialIndex = materials.length;
    materials.push({
      color: floor.color,
      roughness: floor.roughness,
      metalness: 0,
      clearcoat: 0,
      clearcoatRoughness: 0.3,
      transmission: 0,
      ior: 1.5,
      attenuationColor: [1, 1, 1],
      attenuationDistance: 1000,
      opacity: 1,
      sheen: 0,
      sheenColor: [1, 1, 1],
    });

    const corners: readonly [number, number][] = [
      [centerX - halfSize, centerZ - halfSize],
      [centerX + halfSize, centerZ - halfSize],
      [centerX + halfSize, centerZ + halfSize],
      [centerX - halfSize, centerZ + halfSize],
    ];
    const floorVertexBase = vertexCursor;
    for (const [x, z] of corners) {
      positions[vertexCursor * 3] = x;
      positions[vertexCursor * 3 + 1] = level;
      positions[vertexCursor * 3 + 2] = z;
      normals[vertexCursor * 3] = 0;
      normals[vertexCursor * 3 + 1] = 1;
      normals[vertexCursor * 3 + 2] = 0;
      materialIndices[vertexCursor] = floorMaterialIndex;
      vertexCursor += 1;
    }
    const floorTriangles = [0, 1, 2, 0, 2, 3];
    for (const offset of floorTriangles) {
      indices[indexCursor] = floorVertexBase + offset;
      indexCursor += 1;
    }
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  merged.setIndex(new THREE.BufferAttribute(indices, 1));

  const bvh = new MeshBVH(merged, { targetLeafSize: 4 });

  const bvhUniform = new MeshBVHUniformStruct();
  bvhUniform.updateFrom(bvh);

  const normalTexture = new FloatVertexAttributeTexture();
  normalTexture.updateFrom(new THREE.BufferAttribute(normals, 3));

  const materialIndexTexture = new UIntVertexAttributeTexture();
  materialIndexTexture.updateFrom(new THREE.BufferAttribute(materialIndices, 1));

  return {
    bvhUniform,
    normalTexture,
    materialIndexTexture,
    materials,
    floorMaterialIndex,
    triangleCount: indexCursor / 3,
    vertexCount: vertexCursor,
    dispose(): void {
      merged.dispose();
      bvhUniform.dispose();
      normalTexture.dispose();
      materialIndexTexture.dispose();
    },
  };
}
