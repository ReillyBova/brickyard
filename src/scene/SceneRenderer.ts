/**
 * Top-level render system: owns the three.js scene, the instanced batches, the camera,
 * the ghost preview, and the frame loop. Everything below the scene root is plain LDU —
 * see `coords.ts` for the one flip that makes that work.
 *
 * This is the render half of the app described in `docs/ARCHITECTURE.md`; it renders a
 * `SceneDocument`'s bricks and exposes the picking primitives the interaction layer
 * (held back, not part of this slice) consumes.
 */

import * as THREE from 'three';

import { readColorToken, watchTheme } from './theme.ts';

import type { BrickId, Mat4, Vec3 } from '../types';
import type { BrickInstance } from '../model/types';
import type { RaycastHit } from '../snap/types';

import { ROOT_ROTATION_X, flipYZ } from './coords.ts';
import { MaterialCache, fetchColorLibrary } from './colorLibrary.ts';
import { DEFAULT_PARTS_BASE_URL, LDrawPartSource } from './partSource.ts';
import type { PartGeometrySource } from './partSource.ts';
import { InstancedBatchManager, batchKey } from './instancedBatches.ts';
import { GhostPreview } from './ghost.ts';
import { createBaseplateGrid } from './grid.ts';
import { SceneCamera } from './camera.ts';

export interface SceneStats {
  drawCalls: number;
  triangles: number;
  frameTimeMs: number;
  batchCount: number;
  instanceCount: number;
}

interface BrickMeta {
  partId: string;
  colorCode: number;
}

export interface SceneRendererOptions {
  partsBaseUrl?: string;
  partSource?: PartGeometrySource;
}

export class SceneRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private stopThemeWatch: (() => void) | null = null;
  /** Everything LDU-space lives under here. The single coordinate flip. */
  private readonly root = new THREE.Group();
  private readonly sceneCamera: SceneCamera;
  private readonly batches = new InstancedBatchManager();
  private readonly ghost = new GhostPreview();
  private readonly grid: THREE.GridHelper;
  private readonly raycaster = new THREE.Raycaster();

  private readonly partSource: PartGeometrySource;
  private materials: MaterialCache | null = null;
  private readonly materialsReady: Promise<MaterialCache>;
  private readonly geometryCache = new Map<string, Promise<THREE.BufferGeometry>>();
  private readonly brickMeta = new Map<BrickId, BrickMeta>();

  private animationHandle: number | null = null;
  private lastFrameTime = 0;
  private stats: SceneStats = {
    drawCalls: 0,
    triangles: 0,
    frameTimeMs: 0,
    batchCount: 0,
    instanceCount: 0,
  };

  constructor(canvas: HTMLCanvasElement, options: SceneRendererOptions = {}) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    // The canvas is opaque, so it hides whatever the CSS paints behind it. Take the
    // ground colour from the same token the chrome uses and follow the theme, or the
    // viewport stays dark while everything around it turns light.
    const paintGround = (): void => {
      this.scene.background = readColorToken('--by-canvas', '#1b1915');
    };
    paintGround();
    this.stopThemeWatch = watchTheme(paintGround);

    this.root.rotation.x = ROOT_ROTATION_X;
    this.root.add(this.batches.root);
    this.root.add(this.ghost.mesh);
    this.grid = createBaseplateGrid();
    this.root.add(this.grid);
    this.scene.add(this.root);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x404040, 2.2));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(300, 500, 200);
    this.scene.add(key);

    const width = canvas.clientWidth || 1;
    const height = canvas.clientHeight || 1;
    this.renderer.setSize(width, height, false);
    this.sceneCamera = new SceneCamera(canvas, width / height);

    const baseUrl = options.partsBaseUrl ?? DEFAULT_PARTS_BASE_URL;
    this.partSource = options.partSource ?? new LDrawPartSource(baseUrl);
    this.materialsReady = fetchColorLibrary(baseUrl).then((library) => {
      const cache = new MaterialCache(library);
      this.materials = cache;
      return cache;
    });
  }

  // ---- geometry / material resolution -------------------------------------------

  private loadGeometry(partId: string): Promise<THREE.BufferGeometry> {
    const cached = this.geometryCache.get(partId);
    if (cached !== undefined) return cached;
    const promise = this.partSource.load(partId).then((loaded) => loaded.geometry);
    this.geometryCache.set(partId, promise);
    return promise;
  }

  // ---- document sync --------------------------------------------------------------

  /** Loads geometry/material if needed and adds (or updates) one brick's instance. */
  async addBrick(brick: BrickInstance): Promise<void> {
    const [geometry, materials] = await Promise.all([
      this.loadGeometry(brick.partId),
      this.materialsReady,
    ]);
    const material = materials.get(brick.colorCode);
    const batch = this.batches.getOrCreate(brick.partId, brick.colorCode, geometry, material);

    const matrix = new THREE.Matrix4().fromArray(brick.transform as unknown as number[]);
    batch.add(brick.id, matrix);
    this.batches.trackBrick(brick.id, batchKey(brick.partId, brick.colorCode));
    this.brickMeta.set(brick.id, { partId: brick.partId, colorCode: brick.colorCode });
  }

  removeBrick(id: BrickId): void {
    this.batches.removeBrick(id);
    this.brickMeta.delete(id);
  }

  setBrickTransform(id: BrickId, transform: Mat4): void {
    const batch = this.batches.batchForBrick(id);
    if (batch === undefined) return;
    const matrix = new THREE.Matrix4().fromArray(transform as unknown as number[]);
    batch.setTransform(id, matrix);
  }

  async loadDocument(bricks: Iterable<BrickInstance>): Promise<void> {
    await Promise.all([...bricks].map((b) => this.addBrick(b)));
  }

  // ---- ghost ------------------------------------------------------------------------

  async showGhost(partId: string, _colorCode: number, transform: Mat4, valid: boolean): Promise<void> {
    const geometry = await this.loadGeometry(partId);
    this.ghost.show(geometry, transform, valid);
  }

  hideGhost(): void {
    this.ghost.hide();
  }

  // ---- picking ------------------------------------------------------------------------

  /** Converts an NDC pointer position into a world-space ray, in LDU. */
  pickRay(ndcX: number, ndcY: number): { origin: Vec3; direction: Vec3 } {
    this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.sceneCamera.camera);
    const { origin, direction } = this.raycaster.ray;
    return {
      origin: flipYZ(origin.x, origin.y, origin.z),
      direction: flipYZ(direction.x, direction.y, direction.z),
    };
  }

  /** Returns null when the ray hits nothing. */
  pick(ndcX: number, ndcY: number): RaycastHit | null {
    this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.sceneCamera.camera);
    const hits = this.raycaster.intersectObjects(this.batches.meshes, false);
    if (hits.length === 0) return null;

    const hit = hits[0];
    const mesh = hit.object as THREE.InstancedMesh;
    const instanceId = hit.instanceId;
    const key = mesh.userData.batchKey as string | undefined;
    if (instanceId === undefined || key === undefined) return null;

    const batch = this.batches.batchForKey(key);
    const brickId = batch?.brickIdAt(instanceId);
    if (brickId === undefined || hit.face === null || hit.face === undefined) return null;

    const instanceLocal = new THREE.Matrix4();
    mesh.getMatrixAt(instanceId, instanceLocal);
    const instanceWorld = new THREE.Matrix4().multiplyMatrices(mesh.matrixWorld, instanceLocal);
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(instanceWorld);
    const worldNormal = hit.face.normal.clone().applyMatrix3(normalMatrix).normalize();

    const point = flipYZ(hit.point.x, hit.point.y, hit.point.z);
    const normal = flipYZ(worldNormal.x, worldNormal.y, worldNormal.z);

    return { brick: brickId, point, normal };
  }

  // ---- camera -------------------------------------------------------------------------

  /** Fits every currently rendered brick in view. */
  frameAll(): void {
    for (const mesh of this.batches.meshes) mesh.computeBoundingSphere();
    const box = new THREE.Box3();
    if (this.batches.meshes.length === 0) {
      box.set(new THREE.Vector3(-100, -100, -100), new THREE.Vector3(100, 100, 100));
    } else {
      this.scene.updateMatrixWorld(true);
      box.setFromObject(this.batches.root);
    }
    this.sceneCamera.frame(box);
  }

  // ---- lifecycle ----------------------------------------------------------------------

  resize(width: number, height: number): void {
    this.renderer.setSize(width, height, false);
    this.sceneCamera.setAspect(width / height);
  }

  start(): void {
    if (this.animationHandle !== null) return;
    this.lastFrameTime = performance.now();
    const loop = (): void => {
      const now = performance.now();
      this.stats = { ...this.stats, frameTimeMs: now - this.lastFrameTime };
      this.lastFrameTime = now;

      this.sceneCamera.update();
      this.renderer.render(this.scene, this.sceneCamera.camera);

      const info = this.renderer.info.render;
      this.stats = {
        ...this.stats,
        drawCalls: info.calls,
        triangles: info.triangles,
        batchCount: this.batches.batchCount,
        instanceCount: this.batches.instanceCount,
      };

      this.animationHandle = requestAnimationFrame(loop);
    };
    this.animationHandle = requestAnimationFrame(loop);
  }

  stop(): void {
    if (this.animationHandle !== null) cancelAnimationFrame(this.animationHandle);
    this.animationHandle = null;
  }

  getStats(): SceneStats {
    return this.stats;
  }

  dispose(): void {
    this.stopThemeWatch?.();
    this.stopThemeWatch = null;
    this.stop();
    this.batches.dispose();
    this.ghost.dispose();
    this.grid.dispose();
    this.sceneCamera.dispose();
    this.renderer.dispose();
    this.materials?.dispose();

    for (const pending of this.geometryCache.values()) {
      pending.then((geometry) => geometry.dispose()).catch(() => {});
    }
    this.geometryCache.clear();
  }
}
