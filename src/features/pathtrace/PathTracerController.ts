/**
 * Owns the GL resources and the per-frame loop: camera-motion detection, the resolution/spp
 * controller (`resolutionPolicy.ts`), reprojection uniforms, and the two draw passes (TRACE,
 * PRESENT). Shares the caller's `WebGLRenderer` and canvas — no second GL context.
 *
 * While the camera is moving, this loop does not trace at all — it calls back into
 * `renderRaster` (a thin wrapper around `SceneRenderer.renderOnce()`) so the canvas shows an
 * ordinary rasterized frame: clean, instant, and free, since that rasterizer already exists and
 * shares this same renderer/scene/camera. Tracing only begins once the camera comes to rest,
 * at which point the resolution ladder starts at its cheapest rung and climbs as `resolutionPolicy`
 * allows. This is why interactivity does not depend on the resolution ladder at all — the ladder
 * is purely an optimisation for the converging, stationary-camera phase.
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

import { BUNDLED_COLOR_LIBRARY } from '../../ldraw/bundledLibrary.ts';

import type { PathtraceSnapshot } from '../../scene/SceneRenderer.ts';

import { bakePathtraceScene, MAX_MATERIALS } from './sceneBake.ts';
import type { PathtraceMaterial } from './materials.ts';
import { FULLSCREEN_VERTEX_SHADER, PRESENT_FRAGMENT_SHADER, TRACE_FRAGMENT_SHADER } from './shaders.ts';
import { initialResolutionState, nextResolutionState, renderScaleFor, sppFor } from './resolutionPolicy.ts';
import type { ResolutionState } from './resolutionPolicy.ts';
import { DEFAULT_ENVIRONMENT } from './environments.ts';
import type { PathtraceEnvironment } from './environments.ts';
import { DEFAULT_LIGHTING } from './lighting.ts';
import type { LightingPreset } from './lighting.ts';

/** What `build()` renders: the environment (sky + floor) and the key light. */
export interface PathtraceRenderSettings {
  readonly environment: PathtraceEnvironment;
  readonly lighting: LightingPreset;
}

export const DEFAULT_RENDER_SETTINGS: PathtraceRenderSettings = {
  environment: DEFAULT_ENVIRONMENT,
  lighting: DEFAULT_LIGHTING,
};

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
  /** 'moving': the camera is in motion, so this frame was an ordinary rasterized draw —
   *  no trace, no accumulation. 'rendering': the camera is still and this frame came from
   *  the accumulating path trace. */
  readonly status: 'building' | 'moving' | 'rendering';
  readonly samples: number;
  readonly renderScale: number;
  readonly spp: number;
  readonly frameMs: number;
  readonly fps: number;
  readonly triangleCount: number;
  /** Primary rays traced since the camera last moved — see docs on `raysSinceMove` below. */
  readonly raysCast: number;
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
  /** Draws one ordinary rasterized frame to the shared canvas — `SceneRenderer.renderOnce()`.
   *  Called instead of tracing whenever the camera is in motion. */
  private readonly renderRaster: () => void;

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
  /** Primary rays traced since the camera last moved (spp × active pixel count, summed
   *  frame over frame); zeroed the instant `cameraMoved` sees a new pose. */
  private raysSinceMove = 0;

  private onStats: ((stats: PathtraceStats) => void) | null = null;

  constructor(handles: {
    renderer: THREE.WebGLRenderer;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    renderRaster: () => void;
  }) {
    this.renderer = handles.renderer;
    this.camera = handles.camera;
    this.controls = handles.controls;
    this.renderRaster = handles.renderRaster;
  }

  /**
   * Fetches the LDraw palette, flattens+bakes the live scene (plus a grounding floor sized
   * to it) into a BVH, and compiles shaders. `settings` picks the environment (sky + floor)
   * and lighting preset; switching either later means calling `build()` again — a full
   * rebake, but a rare, user-initiated one, not a per-frame cost. See `docs/DESIGN.md` for
   * the "studio / golden hour / dramatic rim / catalogue" presets this reads.
   */
  async build(snapshot: PathtraceSnapshot, settings: PathtraceRenderSettings = DEFAULT_RENDER_SETTINGS): Promise<void> {
    const colorLibrary = BUNDLED_COLOR_LIBRARY;
    const { environment, lighting } = settings;
    const baked = bakePathtraceScene(snapshot.instances, colorLibrary, {
      color: environment.floorColor,
      roughness: environment.floorRoughness,
    });
    this.bakedScene = baked;
    this.triangleCount = baked.triangleCount;

    const { matA, matB, matC, matD, matE } = packMaterials(baked.materials);
    const skyZenith = new THREE.Color().fromArray(environment.skyZenith).multiplyScalar(lighting.ambientMultiplier);
    const skyHorizon = new THREE.Color().fromArray(environment.skyHorizon).multiplyScalar(lighting.ambientMultiplier);

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
        uSunDirection: { value: new THREE.Vector3().fromArray(lighting.sunDirection).normalize() },
        uSunColor: { value: new THREE.Color().fromArray(lighting.sunColor) },
        uSunRadius: { value: lighting.sunRadius },
        uSkyZenith: { value: skyZenith },
        uSkyHorizon: { value: skyHorizon },
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
        // three.js's own path-tracer example (webgl_renderer_pathtracer, ACESFilmicToneMapping)
        // leaves exposure at the renderer default of 1 rather than boosting it — match that
        // now that the diffuse NEE term in shaders.ts carries its own PI normalisation and
        // isn't relying on exposure to compensate for missing energy conservation.
        uExposure: { value: 1.0 },
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

    if (moved) {
      // Clean, instant and free: the rasterizer already renders this exact scene, so a
      // moving camera gets its frames from there rather than from a 1spp trace. The
      // resolution ladder still resets here (mirroring what `nextResolutionState` would do
      // for a traced frame) so the instant the camera settles, tracing resumes at its
      // cheapest rung rather than wherever it happened to be before the drag started.
      this.resolution = nextResolutionState(this.resolution, { frameMs: this.lastFrameMs, cameraMoved: true });
      this.raysSinceMove = 0;
      this.renderRaster();
      this.prevViewProj.copy(this.camera.projectionMatrix).multiply(this.camera.matrixWorldInverse);
      this.lastFrameMs = performance.now() - frameStart;
      this.onStats?.({
        status: 'moving',
        samples: 0,
        renderScale: renderScaleFor(this.resolution),
        spp: 0,
        frameMs: this.lastFrameMs,
        fps: this.lastFrameMs > 0 ? 1000 / this.lastFrameMs : 0,
        triangleCount: this.triangleCount,
        raysCast: 0,
      });
      return;
    }

    this.resolution = nextResolutionState(this.resolution, { frameMs: this.lastFrameMs, cameraMoved: moved });
    const scale = renderScaleFor(this.resolution);
    const spp = sppFor(this.resolution);
    const rw = Math.max(2, Math.round(this.fullSize.x * scale));
    const rh = Math.max(2, Math.round(this.fullSize.y * scale));

    // Rays cast resets the instant the camera moves — it counts progress toward the
    // current, settled view, not a lifetime total that would just climb forever.
    this.raysSinceMove = moved ? 0 : this.raysSinceMove + rw * rh * spp;

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
      fps: this.lastFrameMs > 0 ? 1000 / this.lastFrameMs : 0,
      triangleCount: this.triangleCount,
      raysCast: this.raysSinceMove,
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
