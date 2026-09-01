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
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import { readColorToken, readEasingToken, readNumberToken, watchTheme } from './theme.ts';

import type { BrickId, Mat4, Vec3 } from '../types';
import type { BrickInstance } from '../model/types';
import type { RaycastHit } from '../snap/types';

import { ROOT_ROTATION_X, flipYZ } from './coords.ts';
import { MaterialCache } from './colorLibrary.ts';
import { BakedPartSource, DEFAULT_PARTS_BASE_URL, LDrawPartSource } from './partSource.ts';
import type { PartGeometrySource } from './partSource.ts';
import { InstancedBatchManager, batchKey } from './instancedBatches.ts';
import { GhostPreview } from './ghost.ts';
import { SelectionOverlay } from './selectionOverlay.ts';
import type { SelectionEntry } from './selectionOverlay.ts';
import { createBaseplateGrid } from './grid.ts';
import type { BaseplateGrid } from './grid.ts';
import { SceneCamera } from './camera.ts';
// A leaf utility, not an interaction-specific one — see `addBrick`'s arrival-sound note.
import { SnapSound } from './interaction/click.ts';

export interface SceneStats {
  drawCalls: number;
  triangles: number;
  frameTimeMs: number;
  batchCount: number;
  instanceCount: number;
  /** Bricks that failed to load geometry after retry — see `addBrick`. Was previously
   *  always 0 and unreported: a brick just silently never appeared. */
  missingGeometry: number;
  /** Distinct part ids behind `missingGeometry`, for naming what's missing rather than
   *  just counting it. */
  missingGeometryParts: readonly string[];
}

/**
 * How many bricks may be mid-flight (animating in) at once. Independent of model size on
 * purpose: a burst of a few thousand bricks sharing one newly-resolved part all become
 * ready in the same tick, and animating all of them at once is both unreadable (nobody
 * can track that many moving pieces) and a frame-budget cliff on a 20k-brick model.
 * Anything over the cap lands instantly instead of flying in — the natural degrade the
 * roadmap asks for, without needing to know the model's total brick count up front.
 */
const MAX_CONCURRENT_ARRIVALS = 48;

/** However many arrivals land in a burst, the click reads as one seat, not a machine gun —
 *  see the arrival-sound note in `addBrick`. */
const ARRIVAL_CLICK_MIN_INTERVAL_MS = 220;

/** One in-flight "fly in and settle" animation. Position-only: rotation is set to its
 *  final value immediately, which is enough to read as a piece arriving without the
 *  complexity of slerping an arbitrary starting orientation. */
interface Arrival {
  batchKey: string;
  from: THREE.Vector3;
  to: THREE.Matrix4;
  toPosition: THREE.Vector3;
  startTime: number;
  duration: number;
}

interface BrickMeta {
  partId: string;
  colorCode: number;
}

export interface SceneRendererOptions {
  partsBaseUrl?: string;
  partSource?: PartGeometrySource;
}

/** One flattened brick instance, for `getPathtraceSnapshot()` below. */
export interface PathtraceBrickInstance {
  readonly geometry: THREE.BufferGeometry;
  readonly colorCode: number;
  readonly matrix: THREE.Matrix4;
}

/** Read-only handles `src/features/pathtrace/` renders the live scene through. */
export interface PathtraceSnapshot {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly instances: readonly PathtraceBrickInstance[];
  readonly backgroundColor: THREE.Color | null;
}

/**
 * Flattens live `InstancedMesh` batches into per-brick instances for the path tracer.
 * A free function (not a method) so it's unit-testable against `InstancedBatchManager`
 * output directly, without spinning up a whole `SceneRenderer` (which needs a real
 * `WebGLRenderer`/canvas and can't run under the node test environment).
 *
 * Colour comes from `mesh.userData.colorCode`, set once per batch in
 * `InstancedBatch.createMesh` — structured data, not a `"partId colorCode"` string decoded
 * back out of `batchKey` on every read.
 */
export function flattenPathtraceInstances(meshes: readonly THREE.InstancedMesh[]): PathtraceBrickInstance[] {
  const instances: PathtraceBrickInstance[] = [];
  for (const mesh of meshes) {
    const colorCode = mesh.userData.colorCode as number | undefined;
    if (colorCode === undefined) continue;
    for (let i = 0; i < mesh.count; i++) {
      const matrix = new THREE.Matrix4();
      mesh.getMatrixAt(i, matrix);
      instances.push({ geometry: mesh.geometry, colorCode, matrix });
    }
  }
  return instances;
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
  private readonly selection = new SelectionOverlay();
  private readonly grid: BaseplateGrid;
  private readonly raycaster = new THREE.Raycaster();

  private readonly partSource: PartGeometrySource;
  /** Resolved from the bundled LDraw palette — see `colorLibrary.ts`. Synchronous
   * (no fetch, no promise), unlike part geometry below. */
  private readonly materials = new MaterialCache();
  private readonly geometryCache = new Map<string, Promise<THREE.BufferGeometry>>();
  private readonly brickMeta = new Map<BrickId, BrickMeta>();

  // ---- arrival animation (progressive load: fly in, settle) ---------------------------
  private readonly arrivals = new Map<BrickId, Arrival>();
  private readonly arrivalSound = new SnapSound();
  private lastArrivalClickTime = -Infinity;
  private missingGeometryCount = 0;
  private readonly missingGeometryParts = new Set<string>();

  private animationHandle: number | null = null;
  private lastFrameTime = 0;
  private stats: SceneStats = {
    drawCalls: 0,
    triangles: 0,
    frameTimeMs: 0,
    batchCount: 0,
    instanceCount: 0,
    missingGeometry: 0,
    missingGeometryParts: [],
  };

  /** `--by-dur-arrival` / `--by-ease-snap`, read once and cached rather than on every
   *  `addBrick` — a bulk import can call this thousands of times in a burst, and
   *  `getComputedStyle` forces a style recalculation each time. Refreshed on a
   *  `prefers-reduced-motion` change; the duration token itself doesn't otherwise change
   *  at runtime (unlike `--by-canvas`, which follows the light/dark toggle). */
  private arrivalDurationMs = 0;
  private arrivalEase: (t: number) => number = (t) => t;
  private stopReducedMotionWatch: (() => void) | null = null;

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

    const refreshArrivalMotion = (): void => {
      this.arrivalDurationMs = readNumberToken('--by-dur-arrival', 480);
      this.arrivalEase = readEasingToken('--by-ease-snap');
    };
    refreshArrivalMotion();
    const reducedMotionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    reducedMotionQuery?.addEventListener('change', refreshArrivalMotion);
    this.stopReducedMotionWatch = () =>
      reducedMotionQuery?.removeEventListener('change', refreshArrivalMotion);

    this.root.rotation.x = ROOT_ROTATION_X;
    this.root.add(this.batches.root);
    this.root.add(this.ghost.mesh);
    this.root.add(this.selection.group);
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
    this.partSource = options.partSource ?? new BakedPartSource(new LDrawPartSource(baseUrl));
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

  /**
   * Loads geometry if needed and adds (or updates) one brick's instance.
   *
   * Called once per brick, in the document's build order (`EditorSession.reconcile`
   * iterates `SceneDocument.bricks`, a `Map` populated in `parseMpd`'s flattened
   * traversal/step order — see `docs/ROADMAP.md`'s "Progressive loading" section). Since
   * `LDrawPartSource` now resolves distinct parts through a small FIFO pool
   * (`concurrencyPool.ts`), the *first* brick to need a given part is also the first to
   * queue that part's load — so parts tend to resolve, and bricks tend to appear, in
   * roughly the order the model was meant to be built, without this method or its
   * caller needing to coordinate that explicitly.
   *
   * A brick that resolves as part of a model load (`options.animate === true`, set only
   * by `EditorSession.loadDocument` — see `AddBrickOptions` in `editor.ts`) becomes
   * visible by flying in from off-screen and settling with `--by-ease-snap`'s overshoot
   * (see `updateArrivals`, driven from the frame loop in `start()`) rather than popping
   * in — that flight *is* the load's progress indicator, per the roadmap: "make the wait
   * the product" rather than a numeric bar. It degrades automatically past
   * `MAX_CONCURRENT_ARRIVALS` and skips entirely when `--by-dur-arrival` reads 0
   * (`prefers-reduced-motion`).
   *
   * Every other caller — hand placement, undo/redo, restyle's recolor-as-remove-plus-
   * re-add — omits `animate` (or passes `false`), and lands instantly. Placement already
   * has its own motion language (the snap overshoot on commit); undo/redo restore state,
   * they don't re-enact its arrival; and a restyle across a loaded model would otherwise
   * launch every recoloured brick off-screen and back.
   */
  async addBrick(brick: BrickInstance, options?: { animate?: boolean }): Promise<void> {
    let geometry: THREE.BufferGeometry;
    try {
      geometry = await this.loadGeometry(brick.partId);
    } catch (err) {
      // Part of the Colosseum finding: this used to be a silently-dropped rejection
      // (`EditorSession.reconcile` calls `void this.scene.addBrick(brick)`) — the brick
      // just never appeared, with nothing to say why. `LDrawPartSource` already retries
      // transient failures; anything that reaches here survived those retries and is
      // worth knowing about, even without a UI surface for it yet.
      this.missingGeometryCount++;
      this.missingGeometryParts.add(brick.partId);
      this.stats = {
        ...this.stats,
        missingGeometry: this.missingGeometryCount,
        missingGeometryParts: [...this.missingGeometryParts],
      };
      // eslint-disable-next-line no-console
      console.warn(
        `SceneRenderer: geometry failed to load for part "${brick.partId}" (brick ${brick.id}); it will not appear.`,
        err,
      );
      return;
    }

    const material = this.materials.get(brick.colorCode);
    const batch = this.batches.getOrCreate(brick.partId, brick.colorCode, geometry, material);
    const key = batchKey(brick.partId, brick.colorCode);
    this.batches.trackBrick(brick.id, key);
    this.brickMeta.set(brick.id, { partId: brick.partId, colorCode: brick.colorCode });

    const finalMatrix = new THREE.Matrix4().fromArray(brick.transform as unknown as number[]);

    const wantsAnimation = options?.animate === true;
    if (!wantsAnimation || this.arrivalDurationMs <= 0 || this.arrivals.size >= MAX_CONCURRENT_ARRIVALS) {
      batch.add(brick.id, finalMatrix);
      return;
    }

    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    finalMatrix.decompose(position, quaternion, scale);

    const from = this.computeArrivalStart(position);
    const startMatrix = new THREE.Matrix4().compose(from, quaternion, scale);
    batch.add(brick.id, startMatrix);
    this.arrivals.set(brick.id, {
      batchKey: key,
      from,
      to: finalMatrix,
      toPosition: position,
      startTime: performance.now(),
      duration: this.arrivalDurationMs,
    });
  }

  /**
   * A point off-screen, roughly matching the target's distance from the camera, so the
   * flight reads as coming from the edge of the viewport rather than from an arbitrary
   * direction. Picks a random point just outside the camera frustum (NDC radius > 1),
   * casts a ray through it, and finds where that ray crosses the target's own
   * camera-relative depth.
   */
  private computeArrivalStart(targetLocal: THREE.Vector3): THREE.Vector3 {
    const camera = this.sceneCamera.camera;
    const targetWorld = this.root.localToWorld(targetLocal.clone());

    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    const depth = targetWorld.clone().sub(camera.position).dot(forward);

    const angle = Math.random() * Math.PI * 2;
    const edgeRadius = 1.35 + Math.random() * 0.35; // safely outside the -1..1 NDC frustum
    this.raycaster.setFromCamera(
      new THREE.Vector2(Math.cos(angle) * edgeRadius, Math.sin(angle) * edgeRadius),
      camera,
    );
    const rayDir = this.raycaster.ray.direction;
    const denom = rayDir.dot(forward);
    const t = Math.abs(denom) > 1e-6 ? depth / denom : depth;

    const worldStart = camera.position.clone().addScaledVector(rayDir, t);
    return this.root.worldToLocal(worldStart);
  }

  /** Advances every in-flight arrival by one frame; called from the render loop. Settled
   *  arrivals snap exactly to their target transform and play a rate-limited click. */
  private updateArrivals(now: number): void {
    if (this.arrivals.size === 0) return;
    for (const [id, arrival] of this.arrivals) {
      const batch = this.batches.batchForKey(arrival.batchKey);
      if (batch === undefined) {
        this.arrivals.delete(id); // batch (and brick) removed mid-flight
        continue;
      }

      const elapsed = now - arrival.startTime;
      if (elapsed >= arrival.duration) {
        batch.setTransform(id, arrival.to);
        this.arrivals.delete(id);
        this.playArrivalClick();
        continue;
      }

      const t = this.arrivalEase(elapsed / arrival.duration);
      const position = arrival.from.clone().lerp(arrival.toPosition, t);
      const rotation = new THREE.Quaternion();
      const scale = new THREE.Vector3();
      arrival.to.decompose(new THREE.Vector3(), rotation, scale);
      const frame = new THREE.Matrix4().compose(position, rotation, scale);
      batch.setTransform(id, frame);
    }
  }

  /** At most one click per `ARRIVAL_CLICK_MIN_INTERVAL_MS`, regardless of how many
   *  arrivals settle in that window — see the module doc: 1,845 individual clicks would
   *  be unbearable, and step-boundary data isn't threaded through `BrickInstance`. */
  private playArrivalClick(): void {
    const now = performance.now();
    if (now - this.lastArrivalClickTime < ARRIVAL_CLICK_MIN_INTERVAL_MS) return;
    this.lastArrivalClickTime = now;
    this.arrivalSound.play(1);
  }

  removeBrick(id: BrickId): void {
    // Cancels any in-flight arrival for this id — part of what makes loading a large
    // model interruptible: replacing the document mid-flight (a fresh `loadDocument`,
    // returning to an empty sandbox) removes bricks that never get to finish arriving.
    this.arrivals.delete(id);
    this.batches.removeBrick(id);
    this.brickMeta.delete(id);
  }

  setBrickTransform(id: BrickId, transform: Mat4): void {
    const batch = this.batches.batchForBrick(id);
    if (batch === undefined) return;
    const matrix = new THREE.Matrix4().fromArray(transform as unknown as number[]);
    batch.setTransform(id, matrix);
  }

  /** The demo/dev-route path (`SceneCanvas.tsx`) — a whole-document load, so it
   *  animates like `EditorSession.loadDocument` does for the real app. */
  async loadDocument(bricks: Iterable<BrickInstance>): Promise<void> {
    await Promise.all([...bricks].map((b) => this.addBrick(b, { animate: true })));
  }

  // ---- ghost ------------------------------------------------------------------------

  async showGhost(
    partId: string,
    _colorCode: number,
    transform: Mat4,
    valid: boolean,
    wireframe = false,
  ): Promise<void> {
    const geometry = await this.loadGeometry(partId);
    this.ghost.show(geometry, transform, valid, wireframe);
  }

  hideGhost(): void {
    this.ghost.hide();
  }

  // ---- selection ----------------------------------------------------------------------

  /** Outline every entry in `entries`; anything not in the list stops being outlined. */
  setSelection(entries: readonly SelectionEntry[]): void {
    this.selection.set(entries);
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

  /**
   * The camera's current ground-plane orientation, in LDU: `forward` is the direction
   * away from the camera along the horizontal plane (what "further away" reads as on
   * screen), `right` is the camera's screen-right, also flattened to the ground. Both
   * are unit length.
   *
   * This is what makes a keyboard nudge move a selected piece the way the arrow points
   * *on screen* rather than along fixed world axes — orbit the camera behind the model
   * and world-space arrows read as reversed, because "left" on screen has become
   * world +X instead of -X. Read fresh on every keypress rather than cached, since the
   * camera can orbit between nudges.
   */
  groundBasis(): { forward: Vec3; right: Vec3 } {
    const camera = this.sceneCamera.camera;
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    forward.y = 0;
    // Looking straight down or up flattens to zero; fall back to the camera's default
    // starting orientation rather than producing a degenerate (NaN) direction.
    if (forward.lengthSq() < 1e-8) forward.set(0, 0, -1);
    forward.normalize();
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
    return {
      forward: flipYZ(forward.x, forward.y, forward.z),
      right: flipYZ(right.x, right.y, right.z),
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
      this.updateArrivals(now);
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
    this.stopReducedMotionWatch?.();
    this.stopReducedMotionWatch = null;
    this.arrivals.clear();
    this.arrivalSound.dispose();
    this.stop();
    this.batches.dispose();
    this.ghost.dispose();
    this.selection.dispose();
    this.grid.dispose();
    this.sceneCamera.dispose();
    this.renderer.dispose();
    this.materials.dispose();

    for (const pending of this.geometryCache.values()) {
      pending.then((geometry) => geometry.dispose()).catch(() => {});
    }
    this.geometryCache.clear();
  }

  // ---- pathtrace mount point -----------------------------------------------------------
  // Read-only integration seam for src/features/pathtrace/. It shares this WebGLRenderer,
  // camera and OrbitControls rather than opening a second GL context, and flattens every
  // InstancedMesh batch into per-brick instances because three-mesh-bvh has no notion of
  // instancing. Nothing here is written by pathtrace.

  /** A snapshot of what's on the baseplate right now, for building a path-traced scene. */
  getPathtraceSnapshot(): PathtraceSnapshot {
    return {
      renderer: this.renderer,
      camera: this.sceneCamera.camera,
      controls: this.sceneCamera.controls,
      instances: flattenPathtraceInstances(this.batches.meshes),
      backgroundColor: this.scene.background instanceof THREE.Color ? this.scene.background.clone() : null,
    };
  }
}
