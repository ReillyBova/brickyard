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
 * Absolute ceiling on how many bricks may be mid-flight at once — a safety backstop, not
 * the pacing mechanism. Pacing is `arrivalPacing()`'s job (below): admission is
 * cadence-gated one brick at a time, so this cap is only ever approached by a batch
 * large enough to push the cadence down near `ARRIVAL_MIN_CADENCE_MS` (tens of thousands
 * of bricks). It exists so a pathological cadence/duration pairing still can't animate
 * an unbounded number of instances at once and blow the frame budget.
 */
const MAX_CONCURRENT_ARRIVALS = 48;

/** Fastest a click is allowed to repeat, however fast the admission cadence — the floor
 *  that keeps an extremely large model's clicks from blurring into white noise (a
 *  20,000-brick load's ~1ms cadence, run through the multiplier below with nothing to
 *  stop it, would ask for a click every couple of milliseconds). */
const ARRIVAL_CLICK_MIN_INTERVAL_FLOOR_MS = 45;

/** How the click's own minimum repeat interval derives from the arrival cadence — the
 *  same relationship `arrivalPacing()` already uses for flight duration (see
 *  `ARRIVAL_TARGET_CONCURRENCY`). Ties the clicking's pace to the stream's pace so a
 *  load reads as the same "rush of bricks landing" at every model size, rather than
 *  sounding sparse for a small one and hitting a fixed ceiling for a large one. Carried
 *  on each `Arrival` rather than read from shared state, for the same reason cadence
 *  and flight duration already are — two overlapping loads keep the pacing they were
 *  each computed for. */
const ARRIVAL_CLICK_CADENCE_MULTIPLIER = 2.2;

/**
 * Target wall-clock time for an entire load's arrival stream, once the batch is big
 * enough that `arrivalPacing()` isn't clamping toward `ARRIVAL_MAX_CADENCE_MS` instead
 * (see there). This is what keeps a 1,845-brick model — or a 9,000-brick one — landing
 * in "tens of seconds," not minutes, without the code needing a brick-count-specific
 * special case: the cadence is just `ARRIVAL_STREAM_TOTAL_MS / batchSize`.
 */
const ARRIVAL_STREAM_TOTAL_MS = 1_800;
// Ten times faster than the original 18s target. Small and medium models keep the
// same character — four or five pieces airborne — while very large ones ask for more
// concurrency than MAX_CONCURRENT_ARRIVALS allows, so the backstop engages and they
// stretch past this target rather than becoming a single burst.

/**
 * Slowest allowed gap between one brick starting its flight and the next — the floor
 * that keeps a small model's stream from crawling (`ARRIVAL_STREAM_TOTAL_MS / batchSize`
 * would otherwise stretch a 5-brick load over 4 seconds *per brick*).
 */
const ARRIVAL_MAX_CADENCE_MS = 24;

/**
 * Fastest allowed gap between admissions — the floor on the other end, so an
 * extraordinarily large batch (tens of thousands of bricks) can't push the cadence to
 * zero chasing `ARRIVAL_STREAM_TOTAL_MS`. Below this the stream is simply over budget
 * rather than instantaneous; still bounded, just not exactly `ARRIVAL_STREAM_TOTAL_MS`.
 */
const ARRIVAL_MIN_CADENCE_MS = 1;

/**
 * How many bricks the stream aims to keep airborne at once, expressed as a multiple of
 * the cadence: flight duration is `cadence * ARRIVAL_TARGET_CONCURRENCY`, clamped to
 * `[ARRIVAL_MIN_FLIGHT_MS, --by-dur-arrival]`. Tie the flight duration to a fixed value
 * instead and a fast cadence (a big model) leaves dozens airborne simultaneously — a
 * swarm again, just delayed. Tie it to the cadence and the number in flight stays low
 * and roughly constant regardless of model size, until the duration floor below takes
 * over for very fast streams.
 */
const ARRIVAL_TARGET_CONCURRENCY = 4;

/** Shortest flight `arrivalPacing()` will produce, however fast the cadence — under this
 *  the fly-in-and-settle motion stops being readable as motion at all. A very large
 *  model trades a low, roughly-constant concurrency for a higher one once the cadence
 *  is fast enough to hit this floor; see `ARRIVAL_TARGET_CONCURRENCY`. */
const ARRIVAL_MIN_FLIGHT_MS = 90;

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(Math.max(value, lo), hi);
}

/**
 * The cadence (gap between one brick's flight starting and the next's) and flight
 * duration for a load of `batchSize` bricks, so the stream — whatever the model's size —
 * reads as individual pieces arriving in sequence rather than either a crawl or a burst.
 * `maxFlightMs` is `--by-dur-arrival` as authored (also how reduced-motion reaches this:
 * `addBrick` never calls in with it at 0, since that path skips animation entirely, but
 * the clamp handles it correctly regardless — `flightMs` comes out 0 too).
 */
function arrivalPacing(batchSize: number, maxFlightMs: number): { cadenceMs: number; flightMs: number } {
  const cadenceMs = clamp(ARRIVAL_STREAM_TOTAL_MS / Math.max(batchSize, 1), ARRIVAL_MIN_CADENCE_MS, ARRIVAL_MAX_CADENCE_MS);
  const flightMs = clamp(cadenceMs * ARRIVAL_TARGET_CONCURRENCY, ARRIVAL_MIN_FLIGHT_MS, maxFlightMs);
  return { cadenceMs, flightMs };
}

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
  /** This arrival's own admission cadence, carried through so its settle click can pace
   *  itself off it — see `ARRIVAL_CLICK_CADENCE_MULTIPLIER`. */
  cadenceMs: number;
}

/**
 * An arrival waiting to be admitted, one at a time, at the cadence `arrivalPacing()`
 * computed for it. Its brick is already placed in the batch — at its *final* rotation
 * and position, but zero-scaled — the instant `addBrick` resolves, so it exists for
 * picking/removal purposes without being visible: `updateArrivals` swaps in a real,
 * freshly-computed start transform only at the moment of admission (see
 * `computeArrivalStart`). Deferring that computation, rather than baking a start point
 * in at queue time, is what keeps a brick from flashing into view at a stale parking
 * position if the camera moves — reframes, or an orbit — while thousands of bricks
 * behind it are still waiting their turn. Carries its own `cadenceMs`/`flightMs` rather
 * than reading shared instance fields so two loads that happen to overlap (a merge
 * fired mid-load, say) each keep the pacing they were computed for.
 */
interface PendingArrival {
  id: BrickId;
  batchKey: string;
  to: THREE.Matrix4;
  toPosition: THREE.Vector3;
  toQuaternion: THREE.Quaternion;
  toScale: THREE.Vector3;
  cadenceMs: number;
  flightMs: number;
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
    if (!isReadyInstancedMesh(mesh)) continue;
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

/**
 * Guards against a batch caught mid-construction. With several models loaded there are many
 * more batches in flight and geometry resolves asynchronously (`PartGeometrySource`), so a
 * batch can genuinely be in the list with no usable mesh yet, or a mesh whose geometry hasn't
 * resolved its `position` attribute. Skipping those here — rather than assuming every entry is
 * ready — is what keeps `bakePathtraceScene` from reading `.count` off `undefined`.
 */
function isReadyInstancedMesh(mesh: THREE.InstancedMesh | null | undefined): mesh is THREE.InstancedMesh {
  if (mesh == null) return false;
  if (typeof mesh.count !== 'number') return false;
  const geometry = mesh.geometry;
  if (geometry == null) return false;
  const position = geometry.getAttribute?.('position');
  return position != null && typeof position.count === 'number';
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
  /** Every arrival waits its turn here, admitted one at a time by `updateArrivals` — see
   *  `PendingArrival`. `MAX_CONCURRENT_ARRIVALS` is a backstop, not why bricks queue. */
  private readonly pendingArrivals: PendingArrival[] = [];
  /** `performance.now()` timestamp of the next admission — real wall-clock time, not a
   *  frame count, so a throttled/backgrounded tab still paces at the same rate once it
   *  wakes up (catching up in one tick rather than drifting slower forever) instead of
   *  the stream's speed depending on the display's refresh rate. */
  private nextAdmitAt = 0;
  /** Running bounds (local/LDU space) of every animated brick's *target* position seen
   *  in the current stream — reset alongside `nextAdmitAt` when a fresh stream starts.
   *  `computeArrivalStart` uses its horizontal footprint to scale the fall height and
   *  the horizontal scatter to the model, so "the heavens" reads proportionally the
   *  same for a 29-brick model and a 21,000-brick one. Grows as the stream progresses
   *  rather than being known up front — `addBrick` only ever sees one brick's target at
   *  a time — so early admissions in a very large load work off a smaller estimate than
   *  later ones; `computeArrivalStart`'s own frustum check (not this estimate) is what
   *  actually guarantees the start point is off-screen. */
  private readonly arrivalBounds = new THREE.Box3();
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
   * by `EditorSession.loadDocument`/`mergeDocument` — see `AddBrickOptions` in
   * `editor.ts`) stays hidden until admitted, then becomes visible by falling in from
   * high above (see `computeArrivalStart`) and settling with
   * `--by-ease-snap`'s overshoot (see `updateArrivals`, driven from the frame loop in
   * `start()`) rather than popping in — that flight *is* the load's progress indicator,
   * per the roadmap: "make the wait the product" rather than a numeric bar. Every such
   * brick queues (`pendingArrivals`, `PendingArrival`) and is admitted one at a time, on
   * a cadence `arrivalPacing()` derives from `options.batchSize` — the whole point being
   * a *stream* of individually-arriving pieces, at whatever pace keeps a batch of any
   * size landing in roughly `ARRIVAL_STREAM_TOTAL_MS`, rather than a burst that animates
   * the first few dozen at once and snaps the rest into place. It skips entirely when
   * `--by-dur-arrival` reads 0 (`prefers-reduced-motion`).
   *
   * Every other caller — hand placement, undo/redo, restyle's recolor-as-remove-plus-
   * re-add — omits `animate` (or passes `false`), and lands instantly. Placement already
   * has its own motion language (the snap overshoot on commit); undo/redo restore state,
   * they don't re-enact its arrival; and a restyle across a loaded model would otherwise
   * launch every recoloured brick off-screen and back.
   */
  async addBrick(brick: BrickInstance, options?: { animate?: boolean; batchSize?: number }): Promise<void> {
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
    if (!wantsAnimation || this.arrivalDurationMs <= 0) {
      batch.add(brick.id, finalMatrix);
      return;
    }

    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    finalMatrix.decompose(position, quaternion, scale);

    // Not visible yet: parked at its own final position and rotation but zero-scaled, so
    // it exists in the batch for picking/removal the instant this resolves without being
    // on screen — an `InstancedMesh` has no per-instance visibility flag, so a squashed
    // matrix is what stands in for "hidden". `updateArrivals` swaps in a real, freshly
    // computed start transform only at the moment this brick is actually admitted.
    const hiddenMatrix = new THREE.Matrix4().compose(position, quaternion, new THREE.Vector3());
    batch.add(brick.id, hiddenMatrix);

    // Every animated brick queues, even the very first of a load — admission (not the
    // concurrency cap) is what paces the stream now, so the first brick gets exactly the
    // same one-at-a-time treatment as the four-thousandth. See `updateArrivals`.
    if (this.pendingArrivals.length === 0 && this.arrivals.size === 0) {
      // Starting a fresh stream: let the first brick fly on the very next tick rather
      // than waiting out a full cadence gap it never had a reason to wait for, and reset
      // the running footprint `computeArrivalStart` scales the descent to.
      this.nextAdmitAt = performance.now();
      this.arrivalBounds.makeEmpty();
    }
    this.arrivalBounds.expandByPoint(position);
    const { cadenceMs, flightMs } = arrivalPacing(options?.batchSize ?? 1, this.arrivalDurationMs);
    this.pendingArrivals.push({
      id: brick.id,
      batchKey: key,
      to: finalMatrix,
      toPosition: position,
      toQuaternion: quaternion,
      toScale: scale,
      cadenceMs,
      flightMs,
    });
  }

  /**
   * A point high above the target — bricks fall into place rather than slide in from the
   * frame edge, which reads as building (it matches the snap overshoot every piece lands
   * with) and stays off-screen regardless of the camera's azimuth: this app's orbit
   * camera sits above the baseplate looking down, so "up" is reliably outside its
   * frustum no matter which way it's been spun around the model, in a way an edge-of-
   * frame point isn't. A little horizontal scatter — scaled to `arrivalBounds`, the
   * running footprint of the current stream — keeps a big load from reading as one
   * vertical column of bricks landing in sequence, without diluting the fall.
   *
   * The scene root's `rotation.x = π` means LDraw's Y-down convention has "up" as
   * *negative* local Y — get that backwards and every brick fires up from beneath the
   * baseplate instead of down from the sky. World space doesn't have that twist (the
   * camera's `up` is a plain world +Y — see `SceneCamera`), so this works in world space
   * and converts back to local only at the end.
   *
   * The fall height is seeded from the model's own scale (via `arrivalBounds` and the
   * target's distance from the camera) rather than a fixed constant — "the heavens" for
   * a 29-brick model and for a 21,000-brick one are different heights — but the seed is
   * then verified, not trusted: it grows until the point's own projection is confirmed
   * off the top of the frustum, so correctness doesn't depend on the seed guessing
   * right.
   */
  private computeArrivalStart(targetLocal: THREE.Vector3): THREE.Vector3 {
    const camera = this.sceneCamera.camera;
    const targetWorld = this.root.localToWorld(targetLocal.clone());

    // Screen "up": always world +Y here (OrbitControls is constrained to camera.up,
    // which SceneCamera fixes at (0, 1, 0)), independent of azimuth or model rotation.
    const worldUp = new THREE.Vector3(0, 1, 0);

    const footprint = new THREE.Vector3();
    this.arrivalBounds.getSize(footprint);
    const footprintRadius = Math.max(footprint.x, footprint.z, 40) / 2;
    const depth = Math.max(targetWorld.distanceTo(camera.position), 1);

    // A little horizontal scatter, well inside the footprint, so bricks fall from a
    // loose cluster above the model rather than a single point directly overhead.
    const jitterAngle = Math.random() * Math.PI * 2;
    const jitterRadius = footprintRadius * (0.15 + Math.random() * 0.35);
    const horizontalJitter = new THREE.Vector3(Math.cos(jitterAngle), 0, Math.sin(jitterAngle)).multiplyScalar(
      jitterRadius,
    );

    let height = Math.max(footprintRadius * 1.5, depth * 0.6, 120);
    let worldStart = targetWorld.clone().addScaledVector(worldUp, height).add(horizontalJitter);

    // Grow the height until the point's own projection lands comfortably above the top
    // of the frustum (NDC y past a margin) and still in front of the camera — verified
    // against the real camera on every call, not assumed from the seed above.
    for (let i = 0; i < 14; i++) {
      const ndc = worldStart.clone().project(camera);
      if (ndc.y > 1.2 && ndc.z < 1) break;
      height *= 1.7;
      worldStart = targetWorld.clone().addScaledVector(worldUp, height).add(horizontalJitter);
    }

    return this.root.worldToLocal(worldStart);
  }

  /** Advances every in-flight arrival by one frame; called from the render loop. Settled
   *  arrivals snap exactly to their target transform and play a rate-limited click. Once
   *  it's done settling this tick's arrivals, admits queued ones one at a time from
   *  `pendingArrivals` at each one's own cadence — see the module doc and
   *  `PendingArrival`. Time-based, not frame-based: a throttled or backgrounded tab
   *  catches up to the correct cadence in one tick (the `while` below can run several
   *  times) rather than the stream simply running slower for as long as frames are
   *  scarce. */
  private updateArrivals(now: number): void {
    if (this.arrivals.size > 0) {
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
          this.playArrivalClick(arrival.cadenceMs);
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

    while (
      this.pendingArrivals.length > 0 &&
      this.arrivals.size < MAX_CONCURRENT_ARRIVALS &&
      now >= this.nextAdmitAt
    ) {
      const next = this.pendingArrivals.shift();
      if (next === undefined) break;
      const batch = this.batches.batchForKey(next.batchKey);
      if (batch === undefined) {
        // Batch (and brick) removed while still queued — nothing to reveal or animate.
        this.nextAdmitAt += next.cadenceMs;
        continue;
      }

      // Computed fresh, right now, against the live camera — not at queue time — so a
      // reframe or an orbit mid-load can't leave this brick's start point stale. This is
      // also the moment the brick stops being hidden: `setTransform` replaces the
      // zero-scaled matrix `addBrick` parked it at with its real start transform.
      const from = this.computeArrivalStart(next.toPosition);
      const startMatrix = new THREE.Matrix4().compose(from, next.toQuaternion, next.toScale);
      batch.setTransform(next.id, startMatrix);

      this.arrivals.set(next.id, {
        batchKey: next.batchKey,
        from,
        to: next.to,
        toPosition: next.toPosition,
        startTime: now,
        duration: next.flightMs,
        cadenceMs: next.cadenceMs,
      });
      this.nextAdmitAt += next.cadenceMs;
    }
  }

  /** A click per settling arrival, rate-limited to a floor derived from that arrival's
   *  own admission cadence (`ARRIVAL_CLICK_CADENCE_MULTIPLIER`) rather than a fixed gap —
   *  a rush of bricks landing in quick succession, paced with the stream instead of
   *  metered against it. `strength` gets a small random jitter each time so a fast run
   *  of clicks varies in tone rather than repeating identically, which reads as
   *  mechanical — see `SnapSound.play`'s own note on `strength`. */
  private playArrivalClick(cadenceMs: number): void {
    const now = performance.now();
    const minInterval = Math.max(cadenceMs * ARRIVAL_CLICK_CADENCE_MULTIPLIER, ARRIVAL_CLICK_MIN_INTERVAL_FLOOR_MS);
    if (now - this.lastArrivalClickTime < minInterval) return;
    this.lastArrivalClickTime = now;
    this.arrivalSound.play(0.6 + Math.random() * 0.8);
  }

  removeBrick(id: BrickId): void {
    // Cancels any in-flight (or still-queued) arrival for this id — part of what makes
    // loading a large model interruptible: replacing the document mid-flight (a fresh
    // `loadDocument`, returning to an empty sandbox) removes bricks that never get to
    // finish arriving. Pruning the queue also avoids `updateArrivals` later admitting an
    // entry for a brick `InstancedBatch` no longer tracks.
    this.arrivals.delete(id);
    if (this.pendingArrivals.length > 0) {
      const index = this.pendingArrivals.findIndex((p) => p.id === id);
      if (index !== -1) this.pendingArrivals.splice(index, 1);
    }
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

  /** One raster draw: camera update, arrival animation, render, stats. Shared by `start()`'s
   *  own loop and by `renderOnce()`, the on-demand entry point render mode uses while the
   *  camera is moving — see `renderOnce()` below. */
  private renderRasterFrame(now: number): void {
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
  }

  start(): void {
    if (this.animationHandle !== null) return;
    this.lastFrameTime = performance.now();
    const loop = (): void => {
      this.renderRasterFrame(performance.now());
      this.animationHandle = requestAnimationFrame(loop);
    };
    this.animationHandle = requestAnimationFrame(loop);
  }

  stop(): void {
    if (this.animationHandle !== null) cancelAnimationFrame(this.animationHandle);
    this.animationHandle = null;
  }

  // ---- pathtrace mount point (continued) -----------------------------------------------
  // See the larger comment below `dispose()`. This entry point specifically exists for
  // render mode's camera-moving state: rather than tracing at 1spp during a drag (noisy,
  // and wasted work the instant the drag ends), `PathTracerController` calls this to draw
  // one ordinary rasterized frame instead — the same renderer/scene/camera `start()`'s loop
  // would have drawn, on demand rather than on its own RAF. `start()`/`stop()` stay the
  // single owner of whether a loop is *running*; this only ever fires when render mode's own
  // loop calls it, one frame at a time, so there is never a second RAF loop racing this one
  // for the canvas.
  renderOnce(): void {
    this.renderer.setRenderTarget(null);
    const size = this.renderer.getSize(new THREE.Vector2());
    this.renderer.setViewport(0, 0, size.x, size.y);
    this.renderRasterFrame(performance.now());
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
