/**
 * Flattens the live `InstancedMesh` batches into real three.js `Mesh`es — one merged geometry
 * per LDraw colour, each carrying a `MeshPhysicalMaterial` built from `physicalParamsFor` — for
 * `WebGLPathTracer.setScene()` to consume.
 *
 * three-gpu-pathtracer has no notion of instancing, so every brick instance's matrix (and the
 * scene root's `rotation.x = π` LDU flip) is baked directly into merged vertex positions/normals
 * here, once, rather than fought per frame. Merging by colour rather than emitting one mesh per
 * instance keeps the draw/BVH-build count down to the number of distinct colours actually on the
 * baseplate, almost always a handful, instead of thousands of tiny meshes.
 *
 * A grounding floor plane, sized to the model and positioned at its lowest point, is added
 * alongside the bricks so it casts and receives real ray-traced shadows from the same scene.
 */

import * as THREE from 'three';

import type { ColorLibrary, LDrawColor } from '../../ldraw/types.ts';
import { ROOT_ROTATION_X } from '../../scene/coords.ts';
import type { PathtraceBrickInstance } from '../../scene/SceneRenderer.ts';

import { physicalParamsFor } from './materials.ts';
import type { PathtraceMaterial } from './materials.ts';

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

/** The model's world-space (Y-up) footprint, for sizing the floor and placing the key light
 *  at a distance proportional to the model rather than a fixed LDU constant. */
export interface SceneBounds {
  readonly center: readonly [number, number, number];
  readonly radius: number;
}

export interface BakedPathtraceScene {
  /** Everything baked: one merged mesh per colour, plus the floor if requested. Add this
   *  directly into the `THREE.Scene` handed to `WebGLPathTracer.setScene()`. */
  readonly group: THREE.Group;
  readonly bounds: SceneBounds;
  readonly triangleCount: number;
  readonly vertexCount: number;
  readonly materialCount: number;
  dispose(): void;
}

function materialFrom(params: PathtraceMaterial): THREE.MeshPhysicalMaterial {
  const material = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(params.color[0], params.color[1], params.color[2]),
    roughness: params.roughness,
    metalness: params.metalness,
    clearcoat: params.clearcoat,
    clearcoatRoughness: params.clearcoatRoughness,
    transmission: params.transmission,
    ior: params.ior,
    attenuationColor: new THREE.Color(
      params.attenuationColor[0],
      params.attenuationColor[1],
      params.attenuationColor[2],
    ),
    attenuationDistance: params.attenuationDistance,
    opacity: params.opacity,
    transparent: params.opacity < 1,
    sheen: params.sheen,
    sheenColor: new THREE.Color(params.sheenColor[0], params.sheenColor[1], params.sheenColor[2]),
    side: THREE.DoubleSide,
  });
  // Special properties three-gpu-pathtracer reads off every material (see its `index.d.ts`
  // module augmentation) — not part of stock `MeshPhysicalMaterial`, so they default to
  // `undefined` rather than the tracer's intended defaults unless set explicitly here.
  (material as THREE.MeshPhysicalMaterial & { castShadow: boolean; matte: boolean }).castShadow = true;
  (material as THREE.MeshPhysicalMaterial & { castShadow: boolean; matte: boolean }).matte = false;
  return material;
}

interface ColorBucket {
  positions: number[];
  normals: number[];
  indices: number[];
  vertexCount: number;
  colorCode: number;
}

/**
 * Merges every brick instance into one `Mesh` per distinct LDraw colour, builds a grounding
 * floor sized to the model, and returns them ready to add to a scene. Synchronous — the merge
 * is plain array copying, and a typical scene's vertex count keeps it well under a frame
 * budget's worth of blocking, but callers still run it inside an async "building scene…" step
 * so a slow one is never mistaken for a hang.
 */
export function bakePathtraceScene(
  instances: readonly PathtraceBrickInstance[],
  colorLibrary: ColorLibrary,
  floor?: FloorSpec,
): BakedPathtraceScene {
  const group = new THREE.Group();
  group.name = 'pathtrace-bricks';

  const buckets = new Map<number, ColorBucket>();
  const rootRotation = new THREE.Matrix4().makeRotationX(ROOT_ROTATION_X);
  const combined = new THREE.Matrix4();
  const normalMatrix = new THREE.Matrix3();
  const vertex = new THREE.Vector3();

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let totalVertices = 0;

  for (const instance of instances) {
    const geometry = instance.geometry;
    const position = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal');

    let bucket = buckets.get(instance.colorCode);
    if (bucket === undefined) {
      bucket = { positions: [], normals: [], indices: [], vertexCount: 0, colorCode: instance.colorCode };
      buckets.set(instance.colorCode, bucket);
    }

    combined.multiplyMatrices(rootRotation, instance.matrix);
    normalMatrix.getNormalMatrix(combined);

    const vertexBase = bucket.vertexCount;
    for (let i = 0; i < position.count; i++) {
      vertex.fromBufferAttribute(position, i).applyMatrix4(combined);
      bucket.positions.push(vertex.x, vertex.y, vertex.z);
      if (vertex.x < minX) minX = vertex.x;
      if (vertex.x > maxX) maxX = vertex.x;
      if (vertex.y < minY) minY = vertex.y;
      if (vertex.y > maxY) maxY = vertex.y;
      if (vertex.z < minZ) minZ = vertex.z;
      if (vertex.z > maxZ) maxZ = vertex.z;

      vertex.fromBufferAttribute(normal, i).applyMatrix3(normalMatrix).normalize();
      bucket.normals.push(vertex.x, vertex.y, vertex.z);
    }

    if (geometry.index !== null) {
      const sourceIndex = geometry.index;
      for (let i = 0; i < sourceIndex.count; i++) bucket.indices.push(vertexBase + sourceIndex.getX(i));
    } else {
      for (let i = 0; i < position.count; i++) bucket.indices.push(vertexBase + i);
    }
    bucket.vertexCount += position.count;
    totalVertices += position.count;
  }

  const materials: THREE.Material[] = [];
  let totalTriangles = 0;
  for (const bucket of buckets.values()) {
    const entry = colorLibrary.get(bucket.colorCode) ?? FALLBACK_COLOR;
    const material = materialFrom(physicalParamsFor(entry));
    materials.push(material);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(bucket.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(bucket.normals, 3));
    geometry.setIndex(bucket.indices);

    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    group.add(mesh);
    totalTriangles += bucket.indices.length / 3;
  }

  const hasGeometry = totalVertices > 0;
  const centerX = hasGeometry ? (minX + maxX) / 2 : 0;
  const centerY = hasGeometry ? (minY + maxY) / 2 : 0;
  const centerZ = hasGeometry ? (minZ + maxZ) / 2 : 0;
  const radius = hasGeometry
    ? Math.max(
        MIN_FLOOR_HALF_SIZE,
        Math.hypot(maxX - centerX, maxY - centerY, maxZ - centerZ),
      )
    : MIN_FLOOR_HALF_SIZE;

  if (floor !== undefined) {
    const footprint = hasGeometry ? Math.max(maxX - minX, maxZ - minZ) : 0;
    const halfSize = Math.max(MIN_FLOOR_HALF_SIZE, footprint * FLOOR_MARGIN_FACTOR);
    const level = (hasGeometry ? minY : 0) - FLOOR_EPSILON;

    const floorGeometry = new THREE.PlaneGeometry(halfSize * 2, halfSize * 2);
    floorGeometry.rotateX(-Math.PI / 2);
    const floorMaterial = materialFrom({
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
    materials.push(floorMaterial);

    const floorMesh = new THREE.Mesh(floorGeometry, floorMaterial);
    floorMesh.position.set(centerX, level, centerZ);
    floorMesh.receiveShadow = true;
    floorMesh.name = 'pathtrace-floor';
    group.add(floorMesh);
    totalTriangles += 2;
  }

  return {
    group,
    bounds: { center: [centerX, centerY, centerZ], radius },
    triangleCount: totalTriangles,
    vertexCount: totalVertices,
    materialCount: materials.length,
    dispose(): void {
      for (const child of group.children) {
        if (child instanceof THREE.Mesh) child.geometry.dispose();
      }
      for (const material of materials) material.dispose();
    },
  };
}
