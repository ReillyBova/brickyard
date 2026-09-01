/**
 * Owns the GL resources and the per-frame loop: camera-motion detection, the resolution/spp
 * controller (`resolutionPolicy.ts`), reprojection uniforms, and the two draw passes (TRACE,
 * PRESENT). Shares the caller's `WebGLRenderer` and canvas — no second GL context.
 *
 * The accumulation buffers are allocated once at full canvas resolution and never resized on a
 * resolution-ladder change; TRACE instead draws into a shrinking top-left viewport of them and
 * PRESENT samples only that sub-rect (`uRegion` of `uFull`), so a camera coming to rest doesn't
 * throw away the low-res frames that got it there — it just keeps filling in more of the buffer
 * it already has. Full reallocation only happens on an actual canvas resize.
 */

import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

import { fetchColorLibrary } from '../../scene/colorLibrary.ts';
import { DEFAULT_PARTS_BASE_URL } from '../../scene/partSource.ts';
import type { PathtraceSnapshot } from '../../scene/SceneRenderer.ts';

import { bakePathtraceScene, MAX_MATERIALS } from './sceneBake.ts';
import type { PathtraceMaterial } from './materials.ts';
import { FULLSCREEN_VERTEX_SHADER, PRESENT_FRAGMENT_SHADER, TRACE_FRAGMENT_SHADER } from './shaders.ts';
import { initialResolutionState, nextResolutionState, renderScaleFor, sppFor } from './resolutionPolicy.ts';
import type { ResolutionState } from './resolutionPolicy.ts';

/** Matches the live raster scene's key `DirectionalLight` — see `SceneRenderer.ts`. */
const SUN_DIRECTION = new THREE.Vector3(300, 500, 200).normalize();
const SUN_COLOR = new THREE.Color(0xfff3e0).multiplyScalar(2.6);
const DEFAULT_AMBIENT = new THREE.Color(0x1b1915);

const NEUTRAL_MATERIAL: PathtraceMaterial = {
  color: [0.6, 0.6, 0.6],
  roughness: 0.4,
  metalness: 0,
  clearcoat: 0,
  clearcoatRoughness: 0.2,
  transmission: 0,
  ior: 1.49,
  attenuationColor: [1, 1, 1],
  attenuationDistance: 1000,
  opacity: 1,
  sheen: 0,
  sheenColor: [1, 1, 1],
};

export interface PathtraceStats {
  readonly status: 'building' | 'rendering';
  readonly samples: number;
  readonly renderScale: number;
  readonly spp: number;
  readonly frameMs: number;
  readonly triangleCount: number;
}

function packMaterials(materials: readonly PathtraceMaterial[]): {
  matA: THREE.Vector4[];
  matB: THREE.Vector4[];
  matC: THREE.Vector4[];
  matD: THREE.Vector4[];
  matE: THREE.Vector4[];
} {
  const matA: THREE.Vector4[] = [];
  const matB: THREE.Vector4[] = [];
  const matC: THREE.Vector4[] = [];
  const matD: THREE.Vector4[] = [];
  const matE: THREE.Vector4[] = [];
  for (let i = 0; i < MAX_MATERIALS; i++) {
    const m = materials[i] ?? NEUTRAL_MATERIAL;
    matA.push(new THREE.Vector4(m.color[0], m.color[1], m.color[2], m.roughness));
    matB.push(new THREE.Vector4(m.metalness, m.clearcoat, m.clearcoatRoughness, m.transmission));
    matC.push(new THREE.Vector4(m.attenuationColor[0], m.attenuationColor[1], m.attenuationColor[2], m.ior));
    matD.push(new THREE.Vector4(m.sheenColor[0], m.sheenColor[1], m.sheenColor[2], m.sheen));
    matE.push(new THREE.Vector4(m.attenuationDistance, m.opacity, 0, 0));
  }
  return { matA, matB, matC, matD, matE };
}

function createAccumulationTarget(width: number, height: number): THREE.WebGLRenderTarget {
  const target = new THREE.WebGLRenderTarget(Math.max(2, width), Math.max(2, height), {
    type: THREE.HalfFloatType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    depthBuffer: false,
    stencilBuffer: false,
  });
  target.texture.generateMipmaps = false;
  return target;
}

/** Max-abs-difference matrix comparison — exact `.equals()` almost never fires under damping. */
function cameraMoved(a: THREE.Matrix4, b: THREE.Matrix4, eps = 1e-4): boolean {
  const ae = a.elements;
  const be = b.elements;
  for (let i = 0; i < 16; i++) {
    if (Math.abs(ae[i] - be[i]) > eps) return true;
  }
  return false;
}

export class PathTracerController {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;

  private traceQuad: FullScreenQuad | null = null;
  private traceMaterial: THREE.ShaderMaterial | null = null;
  private presentQuad: FullScreenQuad | null = null;
  private presentMaterial: THREE.ShaderMaterial | null = null;
  private targets: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget] | null = null;
  private bakedScene: ReturnType<typeof bakePathtraceScene> | null = null;

  private readonly fullSize = new THREE.Vector2();
  private prevRegion = new THREE.Vector2(2, 2);
  private readonly prevViewProj = new THREE.Matrix4();
  private readonly prevCameraMatrix = new THREE.Matrix4();
  private resolution: ResolutionState = initialResolutionState();
  private frameIndex = 0;
  private rafHandle: number | null = null;
  private lastFrameMs = 0;
  private triangleCount = 0;

  private onStats: ((stats: PathtraceStats) => void) | null = null;

  constructor(handles: { renderer: THREE.WebGLRenderer; camera: THREE.PerspectiveCamera; controls: OrbitControls }) {
    this.renderer = handles.renderer;
    this.camera = handles.camera;
    this.controls = handles.controls;
  }

  /** Fetches the LDraw palette, flattens+bakes the live scene into a BVH, and compiles shaders. */
  async build(snapshot: PathtraceSnapshot): Promise<void> {
    const colorLibrary = await fetchColorLibrary(DEFAULT_PARTS_BASE_URL);
    const baked = bakePathtraceScene(snapshot.instances, colorLibrary);
    this.bakedScene = baked;
    this.triangleCount = baked.triangleCount;

    const { matA, matB, matC, matD, matE } = packMaterials(baked.materials);

    this.renderer.getDrawingBufferSize(this.fullSize);
    this.targets = [
      createAccumulationTarget(this.fullSize.x, this.fullSize.y),
      createAccumulationTarget(this.fullSize.x, this.fullSize.y),
    ];

    this.traceMaterial = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERTEX_SHADER,
      fragmentShader: TRACE_FRAGMENT_SHADER,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        bvh: { value: baked.bvhUniform },
        uNormalAttr: { value: baked.normalTexture },
        uMaterialIndexAttr: { value: baked.materialIndexTexture },
        uInvProjection: { value: new THREE.Matrix4() },
        uCameraWorld: { value: new THREE.Matrix4() },
        uPrevViewProj: { value: new THREE.Matrix4() },
        uPrevColor: { value: null },
        uRegion: { value: new THREE.Vector2() },
        uPrevRegion: { value: new THREE.Vector2() },
        uFull: { value: this.fullSize.clone() },
        uFrame: { value: 0 },
        uSpp: { value: 1 },
        uMoving: { value: false },
        uHistScale: { value: 1 },
        uSunDirection: { value: SUN_DIRECTION.clone() },
        uSunColor: { value: SUN_COLOR.clone() },
        uAmbientColor: { value: (snapshot.backgroundColor ?? DEFAULT_AMBIENT).clone() },
        uMatA: { value: matA },
        uMatB: { value: matB },
        uMatC: { value: matC },
        uMatD: { value: matD },
        uMatE: { value: matE },
      },
    });
    this.traceQuad = new FullScreenQuad(this.traceMaterial);

    this.presentMaterial = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERTEX_SHADER,
      fragmentShader: PRESENT_FRAGMENT_SHADER,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uTex: { value: null },
        uRegion: { value: new THREE.Vector2() },
        uFull: { value: this.fullSize.clone() },
        uExposure: { value: 1.1 },
      },
    });
    this.presentQuad = new FullScreenQuad(this.presentMaterial);

    this.prevCameraMatrix.copy(this.camera.matrixWorld);
    this.prevViewProj.copy(this.camera.projectionMatrix).multiply(this.camera.matrixWorldInverse);
  }

  start(onStats: (stats: PathtraceStats) => void): void {
    this.onStats = onStats;
    const tick = (now: number): void => {
      this.renderFrame(now);
      this.rafHandle = requestAnimationFrame(tick);
    };
    this.rafHandle = requestAnimationFrame(tick);
  }

  stop(): void {
    if (this.rafHandle !== null) cancelAnimationFrame(this.rafHandle);
    this.rafHandle = null;
  }

  private renderFrame(_now: number): void {
    if (this.traceMaterial === null || this.presentMaterial === null || this.targets === null) return;
    const frameStart = performance.now();

    this.controls.update();
    this.camera.updateMatrixWorld();
    const moved = cameraMoved(this.camera.matrixWorld, this.prevCameraMatrix);
    this.prevCameraMatrix.copy(this.camera.matrixWorld);

    // Reallocate at full canvas resolution only on an actual resize — never on a resolution-
    // ladder step, which would otherwise wipe the accumulation buffer for no reason.
    const prevFull = this.fullSize.clone();
    this.renderer.getDrawingBufferSize(this.fullSize);
    if (!this.fullSize.equals(prevFull)) {
      this.targets[0].dispose();
      this.targets[1].dispose();
      this.targets = [
        createAccumulationTarget(this.fullSize.x, this.fullSize.y),
        createAccumulationTarget(this.fullSize.x, this.fullSize.y),
      ];
    }

    this.resolution = nextResolutionState(this.resolution, { frameMs: this.lastFrameMs, cameraMoved: moved });
    const scale = renderScaleFor(this.resolution);
    const spp = sppFor(this.resolution);
    const rw = Math.max(2, Math.round(this.fullSize.x * scale));
    const rh = Math.max(2, Math.round(this.fullSize.y * scale));

    const src = this.frameIndex % 2;
    const dst = 1 - src;
    const srcTarget = this.targets[src];
    const dstTarget = this.targets[dst];

    const u = this.traceMaterial.uniforms;
    u.uPrevColor.value = srcTarget.texture;
    u.uRegion.value.set(rw, rh);
    u.uPrevRegion.value.copy(this.prevRegion);
    u.uFull.value.copy(this.fullSize);
    u.uCameraWorld.value.copy(this.camera.matrixWorld);
    u.uInvProjection.value.copy(this.camera.projectionMatrixInverse);
    u.uPrevViewProj.value.copy(this.prevViewProj);
    u.uFrame.value = this.frameIndex;
    u.uSpp.value = spp;
    u.uMoving.value = moved;
    u.uHistScale.value = this.resolution.justStepped ? 0.35 : 1;

    // `setViewport` multiplies whatever it's given by the renderer's pixelRatio, but
    // `fullSize`/`rw`/`rh` are already physical (drawing-buffer) pixels — the render
    // targets are deliberately allocated at that resolution for quality. Divide back out
    // so the viewport rect lands on the intended texels rather than pixelRatio² of them.
    const pixelRatio = this.renderer.getPixelRatio();

    const previousAutoClear = this.renderer.autoClear;
    this.renderer.autoClear = false;
    this.renderer.setRenderTarget(dstTarget);
    this.renderer.setViewport(0, 0, rw / pixelRatio, rh / pixelRatio);
    this.traceQuad?.render(this.renderer);
    this.renderer.autoClear = previousAutoClear;

    if (this.presentMaterial !== null) {
      const pu = this.presentMaterial.uniforms;
      pu.uTex.value = dstTarget.texture;
      pu.uRegion.value.set(rw, rh);
      pu.uFull.value.copy(this.fullSize);
      this.renderer.setRenderTarget(null);
      this.renderer.setViewport(0, 0, this.fullSize.x / pixelRatio, this.fullSize.y / pixelRatio);
      this.presentQuad?.render(this.renderer);
    }

    this.prevRegion.set(rw, rh);
    this.prevViewProj.copy(this.camera.projectionMatrix).multiply(this.camera.matrixWorldInverse);
    this.frameIndex += 1;

    this.lastFrameMs = performance.now() - frameStart;
    this.onStats?.({
      status: 'rendering',
      samples: this.resolution.settled,
      renderScale: scale,
      spp,
      frameMs: this.lastFrameMs,
      triangleCount: this.triangleCount,
    });
  }

  dispose(): void {
    this.stop();
    this.traceQuad?.dispose();
    this.presentQuad?.dispose();
    this.traceMaterial?.dispose();
    this.presentMaterial?.dispose();
    this.targets?.[0].dispose();
    this.targets?.[1].dispose();
    this.bakedScene?.dispose();
    this.targets = null;
    this.bakedScene = null;
  }
}
