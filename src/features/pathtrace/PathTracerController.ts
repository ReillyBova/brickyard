/**
 * Owns three-gpu-pathtracer's `WebGLPathTracer` and the per-frame loop: camera-motion
 * detection, and the two draw states that follow from it. Shares the caller's `WebGLRenderer`
 * and canvas — no second GL context.
 *
 * While the camera is moving, this loop does not trace at all — it calls back into
 * `renderRaster` (a thin wrapper around `SceneRenderer.renderOnce()`) so the canvas shows an
 * ordinary rasterized frame: clean, instant, and free, since that rasterizer already exists and
 * shares this same renderer/scene/camera. Tracing only resumes once the camera comes to rest,
 * at which point `pathTracer.updateCamera()` resets accumulation and `renderSample()` starts
 * climbing samples again. `WebGLPathTracer` owns its own resolution/sample-count ramp
 * internally (`dynamicLowRes`, `renderDelay`, `fadeDuration`) — there is no separate ladder to
 * maintain here the way a hand-rolled tracer would need.
 *
 * `build()` does the expensive part — flattening the live scene into real meshes and calling
 * `pathTracer.setScene()`, which builds the BVH — and only runs when the model on the
 * baseplate changes (entering render mode) or the environment preset changes (its floor colour
 * is baked into a real material). Everything a lighting dial touches (`updateLighting`) or an
 * environment swap that doesn't touch geometry (`updateEnvironment`) goes through the library's
 * cheap `update*()` calls instead, so dragging a slider never re-triggers a BVH build.
 */

import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { ShapedAreaLight, WebGLPathTracer } from 'three-gpu-pathtracer';

import { BUNDLED_COLOR_LIBRARY } from '../../ldraw/bundledLibrary.ts';

import type { PathtraceSnapshot } from '../../scene/SceneRenderer.ts';

import { bakePathtraceScene } from './sceneBake.ts';
import { DEFAULT_ENVIRONMENT, buildEnvironmentTexture } from './environments.ts';
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
  /** 'moving': the camera is in motion, so this frame was an ordinary rasterized draw —
   *  no trace, no accumulation. 'rendering': the camera is still and this frame came from
   *  the accumulating path trace. */
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

  private readonly prevCameraMatrix = new THREE.Matrix4();
  /** True while the camera is moving or has just stopped — the next still frame after this is
   *  true resets the tracer's accumulation once, rather than every still frame. */
  private wasMoving = true;
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
   * it) into real meshes, builds the environment texture, and hands both to
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

    this.envTexture?.dispose();
    const envTexture = buildEnvironmentTexture(environment);
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
      // We already draw the raster fallback ourselves while the camera moves (see the class
      // doc), so the library doesn't need to cross-fade its own raster preview underneath.
      pathTracer.rasterizeScene = false;
      pathTracer.dynamicLowRes = true;
      pathTracer.lowResScale = 0.25;
      this.pathTracer = pathTracer;
    }
    this.pathTracer.setScene(scene, this.camera);
    this.wasMoving = true;
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
  }

  /** Swaps the environment map and the floor's material properties without rebuilding the
   *  BVH — the floor's own colour/roughness change but its geometry does not. */
  updateEnvironment(environment: PathtraceEnvironment, lighting: LightingSettings): void {
    if (this.pathTracer === null || this.scene === null || this.baked === null) return;

    this.envTexture?.dispose();
    const envTexture = buildEnvironmentTexture(environment);
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
    this.camera.updateMatrixWorld();
    const moved = cameraMoved(this.camera.matrixWorld, this.prevCameraMatrix);
    this.prevCameraMatrix.copy(this.camera.matrixWorld);

    if (moved) {
      this.wasMoving = true;
      this.renderRaster();
      this.lastFrameMs = performance.now() - frameStart;
      this.onStats?.({
        status: 'moving',
        samples: 0,
        frameMs: this.lastFrameMs,
        fps: this.lastFrameMs > 0 ? 1000 / this.lastFrameMs : 0,
        triangleCount: this.baked?.triangleCount ?? 0,
      });
      return;
    }

    if (this.wasMoving) {
      this.pathTracer.updateCamera();
      this.wasMoving = false;
    }
    this.pathTracer.renderSample();

    this.lastFrameMs = performance.now() - frameStart;
    this.onStats?.({
      status: 'rendering',
      samples: this.pathTracer.samples,
      frameMs: this.lastFrameMs,
      fps: this.lastFrameMs > 0 ? 1000 / this.lastFrameMs : 0,
      triangleCount: this.baked?.triangleCount ?? 0,
    });
  }

  dispose(): void {
    this.stop();
    this.pathTracer?.dispose();
    this.pathTracer = null;
    this.baked?.dispose();
    this.baked = null;
    this.envTexture?.dispose();
    this.envTexture = null;
    this.scene = null;
    this.keyLight = null;
    this.renderer.toneMapping = this.previousToneMapping;
    this.renderer.toneMappingExposure = 1;
  }
}
