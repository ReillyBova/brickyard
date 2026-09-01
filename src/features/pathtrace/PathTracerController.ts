/**
 * Owns three-gpu-pathtracer's `WebGLPathTracer` and the per-frame loop. Shares the caller's
 * `WebGLRenderer` and canvas — no second GL context.
 *
 * The moving/still split — camera renders the ordinary raster scene while it's in motion, and
 * only traces once it comes to rest — is the library's own built-in behaviour, the same one
 * three.js's `webgl_renderer_pathtracer` example relies on: `WebGLPathTracer.renderSample()` is
 * called unconditionally every frame, and internally decides whether to draw a raster fallback
 * or an accumulated trace sample, driven by `updateCamera()` calls and its own
 * `renderDelay`/`fadeDuration` timers. The only thing this class changes about that behaviour is
 * *what* the fallback draws: `rasterizeSceneCallback` is pointed at `renderRaster` — a thin
 * wrapper around `SceneRenderer.renderOnce()` — instead of the library's default `renderer.render()`
 * of the (merged, non-instanced) baked scene, so the fallback frame is the same instanced,
 * grid-and-ghost-aware raster the rest of the app already draws, not a second, cheaper copy of
 * the model. `OrbitControls`'s own `change` event (fired continuously during damped motion, once
 * per settle) is what tells the tracer the camera moved — there is no independent
 * matrix-diffing here; that duplicated the library's own state machine and is why samples never
 * used to advance (`dynamicLowRes` combined with `rasterizeScene = false` disabled the library's
 * fallback path on every frame, not just moving ones).
 *
 * `build()` does the expensive part — flattening the live scene into real meshes and calling
 * `pathTracer.setScene()`, which builds the BVH — and only runs when the model on the
 * baseplate changes (entering render mode) or the environment preset changes (its floor colour
 * is baked into a real material). Everything a lighting dial touches (`updateLighting`) goes
 * through the library's cheap `update*()` calls instead, so dragging a slider never re-triggers
 * a BVH build.
 */

import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { ShapedAreaLight, WebGLPathTracer } from 'three-gpu-pathtracer';

import { BUNDLED_COLOR_LIBRARY } from '../../ldraw/bundledLibrary.ts';

import type { PathtraceSnapshot } from '../../scene/SceneRenderer.ts';

import { bakePathtraceScene } from './sceneBake.ts';
import { DEFAULT_ENVIRONMENT, loadEnvironmentTexture } from './environments.ts';
import type { PathtraceEnvironment } from './environments.ts';
import { DEFAULT_LIGHTING, kelvinToRGB, sunDirectionFor } from './lighting.ts';
import type { LightingSettings } from './lighting.ts';

/** What `build()` renders: the environment (sky + floor) and the key light. */
export interface PathtraceRenderSettings {
  readonly environment: PathtraceEnvironment;
  readonly lighting: LightingSettings;
}

export const DEFAULT_RENDER_SETTINGS: PathtraceRenderSettings = {
  environment: DEFAULT_ENVIRONMENT,
  lighting: DEFAULT_LIGHTING,
};

export interface PathtraceStats {
  /** 'moving': the camera moved recently enough that the library is still showing (or fading
   *  from) the raster fallback — no accumulated trace to show yet. 'rendering': the trace has
   *  fully faded in. */
  readonly status: 'building' | 'moving' | 'rendering';
  readonly samples: number;
  readonly frameMs: number;
  readonly fps: number;
  readonly triangleCount: number;
}

/** Key light distance is proportional to the model's own size (`SceneBounds.radius`) rather
 *  than a fixed LDU constant, so a tiny model and a 20k-brick set both get a light that reads
 *  as "outside the scene" instead of sitting inside or absurdly far from the bricks. */
const LIGHT_DISTANCE_FACTOR = 3.5;
const MIN_LIGHT_DISTANCE = 500;
/** Disc diameter at `softness = 0` and `softness = 1`, as a fraction of the light's distance —
 *  small reads as a near-point source (hard shadows), large as a big soft source. */
const MIN_SOFTNESS_FRACTION = 0.02;
const MAX_SOFTNESS_FRACTION = 0.55;
/** Calibrated against the studio environment default so `intensity = 1` reads as a plausible
 *  single light source next to the environment's own contribution, not a blowout or a no-op. */
const BASE_LIGHT_POWER = 6;

export class PathTracerController {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  /** Draws one ordinary rasterized frame to the shared canvas — `SceneRenderer.renderOnce()`.
   *  Installed as the path tracer's own `rasterizeSceneCallback`, so the library calls it
   *  exactly when (and only when) it needs a fallback frame. */
  private readonly renderRaster: () => void;
  private readonly previousToneMapping: THREE.ToneMapping;

  private pathTracer: WebGLPathTracer | null = null;
  private scene: THREE.Scene | null = null;
  private baked: ReturnType<typeof bakePathtraceScene> | null = null;
  private envTexture: THREE.Texture | null = null;
  private keyLight: ShapedAreaLight | null = null;
  private lightDistance = MIN_LIGHT_DISTANCE;
  private lightTarget = new THREE.Vector3();
  /** The live viewport's own background colour, for `showBackground = false` — a plain ground
   *  rather than a hole through to black. */
  private canvasBackground: THREE.Color | null = null;

  /** Timestamp of the last `updateCamera()` call — from user motion or from a settings change
   *  that resets accumulation. Used only to derive the `moving` stat; the tracer itself tracks
   *  its own elapsed time internally. */
  private lastCameraUpdateAt = 0;
  private readonly onControlsChange = (): void => {
    this.pathTracer?.updateCamera();
    this.lastCameraUpdateAt = performance.now();
  };

  private rafHandle: number | null = null;
  private lastFrameMs = 0;

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
    this.previousToneMapping = handles.renderer.toneMapping;
  }

  /**
   * Fetches the LDraw palette, flattens+bakes the live scene (plus a grounding floor sized to
   * it) into real meshes, loads the environment HDRI, and hands both to
   * `WebGLPathTracer.setScene()` — a full BVH build, but only run when the model changes or the
   * environment preset (and its baked-in floor colour) changes. See the class doc for why
   * lighting dials don't come through here.
   */
  async build(snapshot: PathtraceSnapshot, settings: PathtraceRenderSettings = DEFAULT_RENDER_SETTINGS): Promise<void> {
    const colorLibrary = BUNDLED_COLOR_LIBRARY;
    const { environment, lighting } = settings;

    this.baked?.dispose();
    const baked = bakePathtraceScene(snapshot.instances, colorLibrary, {
      color: environment.floorColor,
      roughness: environment.floorRoughness,
    });
    this.baked = baked;
    this.lightDistance = Math.max(MIN_LIGHT_DISTANCE, baked.bounds.radius * LIGHT_DISTANCE_FACTOR);
    this.lightTarget.set(...baked.bounds.center);
    this.canvasBackground = snapshot.backgroundColor;

    const scene = new THREE.Scene();
    scene.add(baked.group);

    const envTexture = await loadEnvironmentTexture(environment);
    this.envTexture = envTexture;
    scene.environment = envTexture;
    scene.background = lighting.showBackground ? envTexture : this.canvasBackground;
    scene.environmentRotation.y = THREE.MathUtils.degToRad(lighting.envRotationDeg);
    scene.backgroundRotation.y = scene.environmentRotation.y;

    const light = new ShapedAreaLight(0xffffff, 1, 1, 1);
    light.isCircular = true;
    this.keyLight = light;
    this.applyLighting(light, lighting);
    scene.add(light);

    this.scene = scene;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = lighting.exposure;

    if (this.pathTracer === null) {
      const pathTracer = new WebGLPathTracer(this.renderer);
      pathTracer.multipleImportanceSampling = true;
      pathTracer.filterGlossyFactor = 0.5;
      pathTracer.renderScale = 1;
      pathTracer.minSamples = 1;
      pathTracer.renderToCanvas = true;
      // Library defaults: raster fallback on, no low-res ramp. `rasterizeSceneCallback` below
      // is the only override — see the class doc for why.
      pathTracer.rasterizeSceneCallback = () => this.renderRaster();
      this.pathTracer = pathTracer;
      this.controls.addEventListener('change', this.onControlsChange);
    }
    this.pathTracer.setScene(scene, this.camera);
    this.pathTracer.updateCamera();
    this.lastCameraUpdateAt = performance.now();
  }

  start(onStats: (stats: PathtraceStats) => void): void {
    this.onStats = onStats;
    const tick = (): void => {
      this.renderFrame();
      this.rafHandle = requestAnimationFrame(tick);
    };
    this.rafHandle = requestAnimationFrame(tick);
  }

  stop(): void {
    if (this.rafHandle !== null) cancelAnimationFrame(this.rafHandle);
    this.rafHandle = null;
  }

  /** Cheap per-dial update — no geometry rebake, no new BVH. Call on every slider tick. */
  updateLighting(lighting: LightingSettings): void {
    if (this.pathTracer === null || this.scene === null || this.keyLight === null) return;
    this.applyLighting(this.keyLight, lighting);
    this.pathTracer.updateLights();

    this.scene.environmentRotation.y = THREE.MathUtils.degToRad(lighting.envRotationDeg);
    this.scene.backgroundRotation.y = this.scene.environmentRotation.y;
    this.scene.background = lighting.showBackground ? this.envTexture : this.canvasBackground;
    this.pathTracer.updateEnvironment();

    this.renderer.toneMappingExposure = lighting.exposure;
    this.pathTracer.reset();
    this.lastCameraUpdateAt = performance.now();
  }

  /** Swaps the environment map and the floor's material properties without rebuilding the
   *  BVH — the floor's own colour/roughness change but its geometry does not. */
  async updateEnvironment(environment: PathtraceEnvironment, lighting: LightingSettings): Promise<void> {
    if (this.pathTracer === null || this.scene === null || this.baked === null) return;

    const envTexture = await loadEnvironmentTexture(environment);
    this.envTexture = envTexture;
    this.scene.environment = envTexture;
    this.scene.background = lighting.showBackground ? envTexture : this.canvasBackground;
    this.scene.environmentRotation.y = THREE.MathUtils.degToRad(lighting.envRotationDeg);
    this.scene.backgroundRotation.y = this.scene.environmentRotation.y;
    this.pathTracer.updateEnvironment();

    for (const child of this.baked.group.children) {
      if (child.name === 'pathtrace-floor' && child instanceof THREE.Mesh) {
        const material = child.material as THREE.MeshPhysicalMaterial;
        material.color.setRGB(...environment.floorColor);
        material.roughness = environment.floorRoughness;
        material.needsUpdate = true;
      }
    }
    this.pathTracer.updateMaterials();
    this.pathTracer.reset();
    this.lastCameraUpdateAt = performance.now();
  }

  private applyLighting(light: ShapedAreaLight, lighting: LightingSettings): void {
    const [dx, dy, dz] = sunDirectionFor(lighting);
    light.position
      .set(dx, dy, dz)
      .multiplyScalar(this.lightDistance)
      .add(this.lightTarget);
    light.lookAt(this.lightTarget);

    const diameter =
      this.lightDistance * THREE.MathUtils.lerp(MIN_SOFTNESS_FRACTION, MAX_SOFTNESS_FRACTION, lighting.softness);
    light.width = diameter;
    light.height = diameter;

    const [r, g, b] = kelvinToRGB(lighting.warmthK);
    light.color.setRGB(r, g, b);
    // A physically real area light dims as it's spread over a larger disc at fixed radiance —
    // compensate by distance so the `intensity` dial reads as "brightness", and softness reads
    // as "shadow character", rather than the two fighting each other.
    const distanceCompensation = (this.lightDistance / MIN_LIGHT_DISTANCE) ** 2;
    light.intensity = lighting.intensity * BASE_LIGHT_POWER * distanceCompensation;
  }

  private renderFrame(): void {
    if (this.pathTracer === null) return;
    const frameStart = performance.now();

    this.controls.update();
    this.pathTracer.renderSample();

    // Mirrors the library's own settle timing (`renderDelay` before it starts accumulating,
    // `fadeDuration` to cross-fade the trace in) so the UI's "moving" label tracks exactly the
    // window in which `renderSample()` is actually drawing the raster fallback.
    const settleMs = this.pathTracer.renderDelay + this.pathTracer.fadeDuration;
    const moving = performance.now() - this.lastCameraUpdateAt < settleMs;

    this.lastFrameMs = performance.now() - frameStart;
    this.onStats?.({
      status: moving ? 'moving' : 'rendering',
      samples: this.pathTracer.samples,
      frameMs: this.lastFrameMs,
      fps: this.lastFrameMs > 0 ? 1000 / this.lastFrameMs : 0,
      triangleCount: this.baked?.triangleCount ?? 0,
    });
  }

  dispose(): void {
    this.stop();
    this.controls.removeEventListener('change', this.onControlsChange);
    this.pathTracer?.dispose();
    this.pathTracer = null;
    this.baked?.dispose();
    this.baked = null;
    // `envTexture` is shared/cached in `environments.ts` — never disposed here.
    this.envTexture = null;
    this.scene = null;
    this.keyLight = null;
    this.renderer.toneMapping = this.previousToneMapping;
    this.renderer.toneMappingExposure = 1;
  }
}
