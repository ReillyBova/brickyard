/**
 * Renders a `SceneDocument` as an explodable graph: real brick geometry, plus every
 * `ConnectionEdge` drawn as a line between the two bricks it joins. `out`/`in` (support)
 * edges get a solid line and a small arrow pointing from supporter to supported;
 * ungendered `peer` edges get a translucent line and no arrow — see `docs/DESIGN.md`'s
 * sage "structure" color and `docs/ARCHITECTURE.md`'s edge-direction contract.
 *
 * Not `SceneRenderer` (`src/scene/`, another slice's file): this class only *imports*
 * from `scene/`, reusing its geometry loader, material cache, camera and instancing —
 * exactly the "features -> scene" arrow in `docs/ARCHITECTURE.md`'s module diagram —
 * because animating exploded per-brick transforms and drawing a graph overlay is not
 * something `SceneRenderer`'s API exposes, and this slice does not edit `src/scene/`.
 *
 * Impure by necessity (three.js, `requestAnimationFrame`, `getComputedStyle`). The
 * layout and edge-classification math it animates toward lives in `layout.ts` and
 * `edges.ts`, both pure and independently tested.
 */
import * as THREE from 'three';

import type { BrickId } from '../../types';
import type { SceneDocument } from '../../model/types';

import { DEFAULT_PARTS_BASE_URL, LDrawPartSource } from '../../scene/partSource.ts';
import { MaterialCache, fetchColorLibrary } from '../../scene/colorLibrary.ts';
import { InstancedBatchManager, batchKey, type InstancedBatch } from '../../scene/instancedBatches.ts';
import { SceneCamera } from '../../scene/camera.ts';
import { ROOT_ROTATION_X } from '../../scene/coords.ts';
import { readColorToken, watchTheme } from '../../scene/theme.ts';

import { computeExplodeLayout, type BrickLayout } from './layout';
import { classifyEdges } from './edges';
import { cubicBezier, readDurationMs, readEasing } from './motion';

export type ExplodeState = 'assembled' | 'exploding' | 'exploded' | 'assembling';

export interface GraphExplodeSceneOptions {
  partsBaseUrl?: string;
}

export interface GraphExplodeSceneStats {
  drawCalls: number;
  triangles: number;
  frameTimeMs: number;
  brickCount: number;
  directedEdgeCount: number;
  peerEdgeCount: number;
}

export interface SetDocumentResult {
  renderedBrickCount: number;
  skippedPartIds: readonly string[];
}

/** Arrowhead cone: small relative to a stud (radius 6, pitch 20 LDU). */
const ARROW_RADIUS = 3;
const ARROW_HEIGHT = 8;
/** Fraction along a directed edge, from supporter to supported, the arrow sits at. */
const ARROW_POSITION_T = 0.62;
/** A `peer` edge (no gendered side) reads as the softer of the two edge kinds. */
const PEER_EDGE_OPACITY = 0.4;
/** However deep the graph, the stagger across the whole model never exceeds this many
 * move-durations — a 1,800-brick model should bloom in about a second, not a minute. */
const SPREAD_CAP_MULTIPLIER = 4;

interface EdgeRuntime {
  from: BrickId;
  to: BrickId;
}

interface BrickRuntime {
  id: BrickId;
  /** Authored LDU transform. Translation is overwritten per frame; rotation/scale are not. */
  baseMatrix: THREE.Matrix4;
  batch: InstancedBatch;
  layout: BrickLayout;
  currentPos: [number, number, number];
  animFromPos: [number, number, number];
  animToPos: [number, number, number];
  animStart: number;
  animDelay: number;
  animDuration: number;
}

export class GraphExplodeScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly root = new THREE.Group();
  private readonly sceneCamera: SceneCamera;

  private readonly partSource: LDrawPartSource;
  private materials: MaterialCache | null = null;
  private readonly materialsReady: Promise<MaterialCache>;
  private readonly geometryCache = new Map<string, Promise<THREE.BufferGeometry>>();
  private stopThemeWatch: (() => void) | null = null;

  private batches = new InstancedBatchManager();
  private readonly bricks = new Map<BrickId, BrickRuntime>();
  private directedEdges: EdgeRuntime[] = [];
  private peerEdges: EdgeRuntime[] = [];
  private directedLine: THREE.LineSegments | null = null;
  private peerLine: THREE.LineSegments | null = null;
  private arrowMesh: THREE.InstancedMesh | null = null;

  private maxHop = 0;
  private explodeTarget: 0 | 1 = 0;
  private state: ExplodeState = 'assembled';
  private animating = false;

  private animationHandle: number | null = null;
  private lastFrameTime = 0;
  private stats: GraphExplodeSceneStats = {
    drawCalls: 0,
    triangles: 0,
    frameTimeMs: 0,
    brickCount: 0,
    directedEdgeCount: 0,
    peerEdgeCount: 0,
  };

  // Reused per-frame scratch objects, so animating a large model doesn't allocate.
  private readonly scratchMatrix = new THREE.Matrix4();
  private readonly scratchFrom = new THREE.Vector3();
  private readonly scratchTo = new THREE.Vector3();
  private readonly scratchDir = new THREE.Vector3();
  private readonly scratchQuat = new THREE.Quaternion();
  private readonly upVector = new THREE.Vector3(0, 1, 0);
  private readonly unitScale = new THREE.Vector3(1, 1, 1);
  private readonly zeroScale = new THREE.Vector3(0, 0, 0);

  constructor(canvas: HTMLCanvasElement, options: GraphExplodeSceneOptions = {}) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    const paintGround = (): void => {
      this.scene.background = readColorToken('--by-canvas', '#1b1915');
    };
    paintGround();
    this.stopThemeWatch = watchTheme(() => {
      paintGround();
      this.refreshEdgeColors();
    });

    this.root.rotation.x = ROOT_ROTATION_X;
    this.root.add(this.batches.root);
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
    this.partSource = new LDrawPartSource(baseUrl);
    this.materialsReady = fetchColorLibrary(baseUrl).then((library) => {
      const cache = new MaterialCache(library);
      this.materials = cache;
      return cache;
    });
  }

  // ---- geometry -------------------------------------------------------------------

  private loadGeometry(partId: string): Promise<THREE.BufferGeometry> {
    const cached = this.geometryCache.get(partId);
    if (cached !== undefined) return cached;
    const promise = this.partSource.load(partId).then((loaded) => loaded.geometry);
    this.geometryCache.set(partId, promise);
    return promise;
  }

  // ---- document ---------------------------------------------------------------------

  private teardownDocument(): void {
    this.stop();
    this.root.remove(this.batches.root);
    this.batches.dispose();
    this.batches = new InstancedBatchManager();
    this.root.add(this.batches.root);

    for (const line of [this.directedLine, this.peerLine]) {
      if (line === null) continue;
      this.root.remove(line);
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
    }
    this.directedLine = null;
    this.peerLine = null;

    if (this.arrowMesh !== null) {
      this.root.remove(this.arrowMesh);
      this.arrowMesh.geometry.dispose();
      (this.arrowMesh.material as THREE.Material).dispose();
      this.arrowMesh = null;
    }

    this.bricks.clear();
    this.directedEdges = [];
    this.peerEdges = [];
    this.maxHop = 0;
    this.explodeTarget = 0;
    this.state = 'assembled';
    this.animating = false;
  }

  /** Loads geometry for every unique part, places every brick, and builds the edge overlay. */
  async setDocument(doc: SceneDocument): Promise<SetDocumentResult> {
    this.teardownDocument();

    const materials = await this.materialsReady;
    const uniquePartIds = [...new Set([...doc.bricks.values()].map((b) => b.partId))];
    const geometries = new Map<string, THREE.BufferGeometry>();
    const skippedPartIds: string[] = [];
    await Promise.all(
      uniquePartIds.map(async (partId) => {
        try {
          geometries.set(partId, await this.loadGeometry(partId));
        } catch {
          skippedPartIds.push(partId); // degrades per docs/ARCHITECTURE.md's fallback rule
        }
      }),
    );

    const layout = computeExplodeLayout(doc);
    let maxHop = 0;
    let rendered = 0;

    for (const [id, instance] of doc.bricks) {
      const geometry = geometries.get(instance.partId);
      if (geometry === undefined) continue;

      const material = materials.get(instance.colorCode);
      const batch = this.batches.getOrCreate(instance.partId, instance.colorCode, geometry, material);
      const baseMatrix = new THREE.Matrix4().fromArray(instance.transform as unknown as number[]);
      batch.add(id, baseMatrix);
      this.batches.trackBrick(id, batchKey(instance.partId, instance.colorCode));
      rendered++;

      const brickLayout = layout.get(id) ?? {
        origin: [baseMatrix.elements[12], baseMatrix.elements[13], baseMatrix.elements[14]] as const,
        target: [baseMatrix.elements[12], baseMatrix.elements[13], baseMatrix.elements[14]] as const,
        hop: 0,
      };
      if (brickLayout.hop > maxHop) maxHop = brickLayout.hop;

      this.bricks.set(id, {
        id,
        baseMatrix,
        batch,
        layout: brickLayout,
        currentPos: [...brickLayout.origin],
        animFromPos: [...brickLayout.origin],
        animToPos: [...brickLayout.origin],
        animStart: 0,
        animDelay: 0,
        animDuration: 0,
      });
    }

    this.maxHop = maxHop;
    this.buildEdges(doc);
    this.frameAll();

    return { renderedBrickCount: rendered, skippedPartIds };
  }

  // ---- edges --------------------------------------------------------------------------

  private buildEdges(doc: SceneDocument): void {
    const classified = classifyEdges(doc);
    this.directedEdges = [];
    this.peerEdges = [];
    for (const e of classified) {
      if (e.kind === 'directed') this.directedEdges.push({ from: e.from, to: e.to });
      else this.peerEdges.push({ from: e.a, to: e.b });
    }

    const structureColor = readColorToken('--by-structure', '#728157');

    const makeLine = (count: number, opacity: number): THREE.LineSegments => {
      const positions = new Float32Array(count * 6);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const material = new THREE.LineBasicMaterial({
        color: structureColor,
        transparent: opacity < 1,
        opacity,
      });
      const line = new THREE.LineSegments(geometry, material);
      line.frustumCulled = false;
      this.root.add(line);
      return line;
    };

    this.directedLine = makeLine(this.directedEdges.length, 1);
    this.peerLine = makeLine(this.peerEdges.length, PEER_EDGE_OPACITY);

    if (this.directedEdges.length > 0) {
      const coneGeometry = new THREE.ConeGeometry(ARROW_RADIUS, ARROW_HEIGHT, 8);
      const material = new THREE.MeshBasicMaterial({ color: structureColor });
      this.arrowMesh = new THREE.InstancedMesh(coneGeometry, material, this.directedEdges.length);
      this.arrowMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.arrowMesh.frustumCulled = false;
      this.root.add(this.arrowMesh);
    }

    this.updateEdgeGeometry();
  }

  private refreshEdgeColors(): void {
    const structureColor = readColorToken('--by-structure', '#728157');
    if (this.directedLine) (this.directedLine.material as THREE.LineBasicMaterial).color.copy(structureColor);
    if (this.peerLine) (this.peerLine.material as THREE.LineBasicMaterial).color.copy(structureColor);
    if (this.arrowMesh) (this.arrowMesh.material as THREE.MeshBasicMaterial).color.copy(structureColor);
  }

  private writeLine(line: THREE.LineSegments | null, edges: readonly EdgeRuntime[]): void {
    if (line === null) return;
    const attr = line.geometry.getAttribute('position') as THREE.BufferAttribute;
    const positions = attr.array as Float32Array;
    for (let i = 0; i < edges.length; i++) {
      const from = this.bricks.get(edges[i].from)?.currentPos;
      const to = this.bricks.get(edges[i].to)?.currentPos;
      if (from === undefined || to === undefined) continue;
      const o = i * 6;
      positions[o] = from[0];
      positions[o + 1] = from[1];
      positions[o + 2] = from[2];
      positions[o + 3] = to[0];
      positions[o + 4] = to[1];
      positions[o + 5] = to[2];
    }
    attr.needsUpdate = true;
    line.geometry.computeBoundingSphere();
  }

  private updateEdgeGeometry(): void {
    this.writeLine(this.directedLine, this.directedEdges);
    this.writeLine(this.peerLine, this.peerEdges);

    if (this.arrowMesh !== null) {
      for (let i = 0; i < this.directedEdges.length; i++) {
        const from = this.bricks.get(this.directedEdges[i].from)?.currentPos;
        const to = this.bricks.get(this.directedEdges[i].to)?.currentPos;
        if (from === undefined || to === undefined) continue;

        this.scratchFrom.set(from[0], from[1], from[2]);
        this.scratchTo.set(to[0], to[1], to[2]);
        this.scratchDir.copy(this.scratchTo).sub(this.scratchFrom);
        const len = this.scratchDir.length();

        if (len < 1e-6) {
          this.scratchMatrix.compose(this.scratchFrom, this.scratchQuat.identity(), this.zeroScale);
        } else {
          this.scratchDir.multiplyScalar(1 / len);
          this.scratchQuat.setFromUnitVectors(this.upVector, this.scratchDir);
          const point = this.scratchFrom.clone().addScaledVector(this.scratchDir, len * ARROW_POSITION_T);
          this.scratchMatrix.compose(point, this.scratchQuat, this.unitScale);
        }
        this.arrowMesh.setMatrixAt(i, this.scratchMatrix);
      }
      this.arrowMesh.instanceMatrix.needsUpdate = true;
    }
  }

  // ---- explode animation --------------------------------------------------------------

  getState(): ExplodeState {
    return this.state;
  }

  /** Flips assembled <-> exploded. Safe to call mid-animation: it interrupts smoothly
   * from wherever each brick currently sits rather than jumping. */
  toggleExplode(): void {
    const now = performance.now();
    const newTarget: 0 | 1 = this.explodeTarget === 1 ? 0 : 1;
    this.explodeTarget = newTarget;
    this.state = newTarget === 1 ? 'exploding' : 'assembling';

    const moveDurationMs = readDurationMs('--by-dur-base', 220);
    const staggerStepMs = readDurationMs('--by-dur-instant', 80);
    const [x1, y1, x2, y2] = readEasing('--by-ease-snap', [0.2, 1.1, 0.3, 1.18]);
    const ease = cubicBezier(x1, y1, x2, y2);
    this.currentEase = ease;

    const totalSpreadCapMs = moveDurationMs * SPREAD_CAP_MULTIPLIER;
    const staggerStep = this.maxHop > 0 ? Math.min(staggerStepMs, totalSpreadCapMs / this.maxHop) : 0;

    for (const b of this.bricks.values()) {
      b.animFromPos = b.currentPos;
      b.animToPos = newTarget === 1 ? [...b.layout.target] : [...b.layout.origin];
      b.animStart = now;
      b.animDelay = newTarget === 1 ? b.layout.hop * staggerStep : (this.maxHop - b.layout.hop) * staggerStep;
      b.animDuration = moveDurationMs;
    }
    this.animating = true;
  }

  private currentEase: (t: number) => number = (t) => t;

  private tick(now: number): void {
    if (!this.animating) return;
    let stillAnimating = false;

    for (const b of this.bricks.values()) {
      const elapsed = now - b.animStart - b.animDelay;
      const t = b.animDuration <= 0 ? 1 : Math.min(Math.max(elapsed / b.animDuration, 0), 1);
      if (t < 1) stillAnimating = true;

      const eased = t <= 0 ? 0 : t >= 1 ? 1 : this.currentEase(t);
      const pos: [number, number, number] = [
        b.animFromPos[0] + (b.animToPos[0] - b.animFromPos[0]) * eased,
        b.animFromPos[1] + (b.animToPos[1] - b.animFromPos[1]) * eased,
        b.animFromPos[2] + (b.animToPos[2] - b.animFromPos[2]) * eased,
      ];
      b.currentPos = pos;

      this.scratchMatrix.copy(b.baseMatrix);
      this.scratchMatrix.elements[12] = pos[0];
      this.scratchMatrix.elements[13] = pos[1];
      this.scratchMatrix.elements[14] = pos[2];
      b.batch.setTransform(b.id, this.scratchMatrix);
    }

    this.updateEdgeGeometry();

    if (!stillAnimating) {
      this.animating = false;
      this.state = this.explodeTarget === 1 ? 'exploded' : 'assembled';
    }
  }

  // ---- camera ---------------------------------------------------------------------------

  /** Frames the union of every brick's assembled and fully-exploded position, once, so
   * toggling the explode never has to move the camera mid-animation. */
  frameAll(): void {
    for (const mesh of this.batches.meshes) mesh.computeBoundingSphere();
    const box = new THREE.Box3();
    if (this.batches.meshes.length === 0) {
      box.set(new THREE.Vector3(-100, -100, -100), new THREE.Vector3(100, 100, 100));
    } else {
      this.scene.updateMatrixWorld(true);
      box.setFromObject(this.batches.root);
      for (const b of this.bricks.values()) {
        box.expandByPoint(new THREE.Vector3(...b.layout.target));
      }
      box.expandByScalar(20);
    }
    this.sceneCamera.frame(box);
  }

  // ---- lifecycle ---------------------------------------------------------------------

  resize(width: number, height: number): void {
    this.renderer.setSize(width, height, false);
    this.sceneCamera.setAspect(width / height);
  }

  start(): void {
    if (this.animationHandle !== null) return;
    this.lastFrameTime = performance.now();
    const loop = (): void => {
      const now = performance.now();
      const frameTimeMs = now - this.lastFrameTime;
      this.lastFrameTime = now;

      this.sceneCamera.update();
      if (this.animating) this.tick(now);
      this.renderer.render(this.scene, this.sceneCamera.camera);

      const info = this.renderer.info.render;
      this.stats = {
        drawCalls: info.calls,
        triangles: info.triangles,
        frameTimeMs,
        brickCount: this.bricks.size,
        directedEdgeCount: this.directedEdges.length,
        peerEdgeCount: this.peerEdges.length,
      };

      this.animationHandle = requestAnimationFrame(loop);
    };
    this.animationHandle = requestAnimationFrame(loop);
  }

  stop(): void {
    if (this.animationHandle !== null) cancelAnimationFrame(this.animationHandle);
    this.animationHandle = null;
  }

  getStats(): GraphExplodeSceneStats {
    return this.stats;
  }

  dispose(): void {
    this.stop();
    this.stopThemeWatch?.();
    this.teardownDocument();
    this.materials?.dispose();
    this.sceneCamera.dispose();
    this.renderer.dispose();
  }
}
