/**
 * Runtime isometric thumbnails for the parts chest.
 *
 * Renders each part once per (partId, colorHex) pair to an offscreen `WebGLRenderer`, in
 * the same three-quarter view as `public/icon.svg`, so a tile previews the actual piece
 * in the color about to be placed rather than a generic pictogram. Cached in memory for
 * the session — nothing is written to disk, and nothing is re-rendered once cached.
 * Geometry comes from `PartGeometrySource` (`./partSource.ts`) — `BakedPartSource` by
 * default, so every chest part's thumbnail renders from the bundled geometry with no
 * network request, falling through to `LDrawPartSource` for anything outside the chest.
 * Either way it's the same geometry the main scene uses, so a part looks identical here
 * and on the baseplate.
 *
 * This runs at runtime rather than being baked to PNG at build time because it can render
 * in the color the user actually has active, which a build-time bake — fixed at bake
 * time — could not.
 */

import * as THREE from 'three';

import { ROOT_ROTATION_X, flipYZ } from './coords.ts';
import { BakedPartSource, DEFAULT_PARTS_BASE_URL, LDrawPartSource } from './partSource.ts';
import type { PartGeometrySource } from './partSource.ts';

export interface ThumbnailSource {
  /**
   * A data URL (`image/png`) for `partId` rendered in `colorHex` (`'#rrggbb'`). Cached —
   * the same pair resolves to the same promise on every call, and rejects only if the
   * part itself fails to load.
   */
  get(partId: string, colorHex: string): Promise<string>;
}

/**
 * Rendered pixel size. Tiles show it scaled down (`.by-tile__thumb` is ~64px, see
 * `components.css`), never up, so this stays sharp at high device pixel ratios without
 * re-rendering per ratio.
 */
const RENDER_SIZE = 160;

/**
 * Matches `SceneCamera`'s default view direction in `camera.ts` (`(1, 0.8, 1)`, the same
 * one `SceneCamera.frame()` falls back to) — itself the angle `public/icon.svg` was drawn
 * from. Reusing it means a chest thumbnail and the app mark read as the same view.
 */
const VIEW_DIRECTION = new THREE.Vector3(1, 0.8, 1).normalize();

/** Headroom around the part's silhouette so it doesn't touch the tile edge. */
const FRAME_PADDING = 1.18;

function hexToColorNumber(hex: string): number {
  return Number.parseInt(hex.replace('#', ''), 16);
}

/**
 * One offscreen renderer, reused for every thumbnail. A render is a handful of
 * milliseconds against a tiny 160×160 target, and there is exactly one GL context here —
 * so renders are sequenced through one scene with a single mesh swapped in and out,
 * rather than paying for N contexts.
 */
export class RuntimeThumbnailRenderer implements ThumbnailSource {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly root = new THREE.Group();
  private readonly camera: THREE.OrthographicCamera;
  private readonly partSource: PartGeometrySource;

  private readonly geometryCache = new Map<string, Promise<THREE.BufferGeometry>>();
  private readonly materialCache = new Map<string, THREE.MeshStandardMaterial>();
  private readonly resultCache = new Map<string, Promise<string>>();
  private currentMesh: THREE.Mesh | null = null;

  /** Renders completed and their cumulative wall time, for perf reporting. */
  renderCount = 0;
  renderTimeMs = 0;

  constructor(
    partSource: PartGeometrySource = new BakedPartSource(new LDrawPartSource(DEFAULT_PARTS_BASE_URL)),
  ) {
    this.partSource = partSource;

    const canvas = document.createElement('canvas');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(RENDER_SIZE, RENDER_SIZE, false);
    this.renderer.setClearColor(0x000000, 0);

    // Same single coordinate flip as the main scene (see coords.ts) — geometry stays raw
    // LDU, the group carries the rotation that puts +Y up on screen.
    this.root.rotation.x = ROOT_ROTATION_X;
    this.scene.add(this.root);

    // Matches SceneRenderer's lighting rig, so a part is shaded the same way here as it
    // will be once placed.
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x404040, 2.2));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(300, 500, 200);
    this.scene.add(key);

    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10_000);
    this.camera.up.set(0, 1, 0);
  }

  get(partId: string, colorHex: string): Promise<string> {
    const key = `${partId}::${colorHex}`;
    const cached = this.resultCache.get(key);
    if (cached !== undefined) return cached;

    const promise = this.render(partId, colorHex);
    this.resultCache.set(key, promise);
    // A failed render must not poison the cache for a retry (e.g. a transient fetch
    // error) — only a successful render stays cached.
    promise.catch(() => this.resultCache.delete(key));
    return promise;
  }

  private loadGeometry(partId: string): Promise<THREE.BufferGeometry> {
    const cached = this.geometryCache.get(partId);
    if (cached !== undefined) return cached;
    const promise = this.partSource.load(partId).then((loaded) => loaded.geometry);
    this.geometryCache.set(partId, promise);
    promise.catch(() => this.geometryCache.delete(partId));
    return promise;
  }

  private materialFor(colorHex: string): THREE.MeshStandardMaterial {
    const cached = this.materialCache.get(colorHex);
    if (cached !== undefined) return cached;
    // Same roughness/metalness as colorLibrary.ts's MaterialCache, so a thumbnail and
    // the placed brick catch light the same way.
    const material = new THREE.MeshStandardMaterial({
      color: hexToColorNumber(colorHex),
      roughness: 0.45,
      metalness: 0.05,
    });
    this.materialCache.set(colorHex, material);
    return material;
  }

  private async render(partId: string, colorHex: string): Promise<string> {
    const started = performance.now();
    const geometry = await this.loadGeometry(partId);

    // No `await` below this line until the pixels are read back — see the class comment
    // on why that keeps concurrent get() calls from tearing each other's frame.
    if (this.currentMesh !== null) this.root.remove(this.currentMesh);
    const mesh = new THREE.Mesh(geometry, this.materialFor(colorHex));
    this.root.add(mesh);
    this.currentMesh = mesh;

    this.frame(geometry);
    this.renderer.render(this.scene, this.camera);
    const url = this.renderer.domElement.toDataURL('image/png');

    this.renderCount++;
    this.renderTimeMs += performance.now() - started;
    return url;
  }

  /**
   * Fits `geometry`'s bounds into the orthographic frustum from `VIEW_DIRECTION`. The
   * bounding sphere is computed in the part's local LDU space (pre-rotation); its center
   * is flipped the same way the mesh is so the camera frames post-rotation world space —
   * mirrors `SceneCamera.frame()`'s perspective-camera fit in `camera.ts`.
   */
  private frame(geometry: THREE.BufferGeometry): void {
    geometry.computeBoundingSphere();
    const sphere = geometry.boundingSphere ?? new THREE.Sphere(new THREE.Vector3(), 1);
    const radius = Math.max(sphere.radius, 1);
    const [cx, cy, cz] = flipYZ(sphere.center.x, sphere.center.y, sphere.center.z);
    const center = new THREE.Vector3(cx, cy, cz);

    const half = radius * FRAME_PADDING;
    this.camera.left = -half;
    this.camera.right = half;
    this.camera.top = half;
    this.camera.bottom = -half;
    this.camera.near = 0.1;
    this.camera.far = radius * 20;
    this.camera.position.copy(center).addScaledVector(VIEW_DIRECTION, radius * 10);
    this.camera.lookAt(center);
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    for (const material of this.materialCache.values()) material.dispose();
    this.materialCache.clear();
    this.geometryCache.clear();
    this.resultCache.clear();
    this.renderer.dispose();
  }
}
