/**
 * The render-mode toggle — a standalone mount until the real toolbar's reserved render
 * slot exists (docs/ROADMAP.md, "Ray-traced render mode"). Owns the `PathTracerController`
 * lifecycle: entering pauses the live raster loop and hands the shared renderer/camera to
 * the tracer; leaving disposes it and resumes rendering.
 */

import { useEffect, useRef, useState, type RefObject, type SVGProps } from 'react';

import type { SceneRenderer } from '../../scene/SceneRenderer.ts';

import { PathTracerController } from './PathTracerController.ts';
import type { PathtraceStats } from './PathTracerController.ts';
import { DEFAULT_ENVIRONMENT } from './environments.ts';
import type { PathtraceEnvironment } from './environments.ts';
import { DEFAULT_LIGHTING } from './lighting.ts';
import type { LightingPreset } from './lighting.ts';
import './pathtrace.css';

/** Lucide "aperture", inlined per docs/DESIGN.md (stroke-width 2.75, `data-lucide` for review). */
function ApertureIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      data-lucide="aperture"
      {...props}
    >
      <circle cx="12" cy="12" r="10" />
      <path d="m14.31 8 5.74 9.94" />
      <path d="M9.69 8h11.48" />
      <path d="m7.38 12 5.74-9.94" />
      <path d="M9.69 16 3.95 6.06" />
      <path d="M14.31 16H2.83" />
      <path d="m16.62 12-5.74 9.94" />
    </svg>
  );
}

interface PathtraceToggleProps {
  /**
   * When true, render no button of our own — the toolbar's mode switch is the control.
   * The component still owns the PathTracerController lifecycle and the stats readout.
   */
  chromeless?: boolean;
  rendererRef: RefObject<SceneRenderer | null>;
  active: boolean;
  onActiveChange: (active: boolean) => void;
  /** The chosen environment and lighting preset — see `App.tsx`'s render-mode panel, which
   *  replaces the parts chest. Changing either rebuilds the traced scene (a full, but rare
   *  and user-initiated, BVH rebake — see `PathTracerController.build`). */
  environment?: PathtraceEnvironment;
  lighting?: LightingPreset;
  /**
   * Reports the live stats object on every frame (and `null` when inactive), so a caller
   * can surface it somewhere other than this component's own floating readout — see
   * `App.tsx`, which feeds it into `BuilderCanvas`'s bottom status bar via `statusExtra`.
   */
  onStats?: (stats: PathtraceStats | null) => void;
}

export function PathtraceToggle({
  rendererRef,
  active,
  onActiveChange,
  chromeless = false,
  environment = DEFAULT_ENVIRONMENT,
  lighting = DEFAULT_LIGHTING,
  onStats,
}: PathtraceToggleProps) {
  const controllerRef = useRef<PathTracerController | null>(null);
  const [stats, setStats] = useState<PathtraceStats | null>(null);

  useEffect(() => {
    onStats?.(stats);
    // onStats is a fresh inline callback from the caller most renders; reporting on its
    // identity change too would be harmless but noisy, so only `stats` drives this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stats]);

  useEffect(() => {
    if (!active) {
      controllerRef.current?.dispose();
      controllerRef.current = null;
      setStats(null);
      rendererRef.current?.start();
      return;
    }

    const sceneRenderer = rendererRef.current;
    if (sceneRenderer === null) return;

    let cancelled = false;
    sceneRenderer.stop();
    const snapshot = sceneRenderer.getPathtraceSnapshot();
    const controller = new PathTracerController({
      renderer: snapshot.renderer,
      camera: snapshot.camera,
      controls: snapshot.controls,
    });
    controllerRef.current = controller;
    setStats({
      status: 'building',
      samples: 0,
      renderScale: 0,
      spp: 0,
      frameMs: 0,
      fps: 0,
      triangleCount: 0,
      raysCast: 0,
    });

    controller
      .build(snapshot, { environment, lighting })
      .then(() => {
        if (cancelled) return;
        controller.start(setStats);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        // eslint-disable-next-line no-console
        console.error('pathtrace: failed to build scene', error);
        onActiveChange(false);
      });

    return () => {
      cancelled = true;
      controller.dispose();
      controllerRef.current = null;
      sceneRenderer.start();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, environment, lighting]);

  const label = active ? 'Exit path-traced render' : 'Path-traced render';

  return (
    <div className="by-pathtrace-toggle">
      {!chromeless && (
      <div className="by-tool-group">
        <button
          type="button"
          className={`by-icon-btn${active ? ' is-active' : ''}`}
          aria-label={label}
          aria-pressed={active}
          title={label}
          onClick={() => onActiveChange(!active)}
        >
          <ApertureIcon />
        </button>
      </div>
      )}
      {/* The numeric readout (fps, rays cast, resolution, samples, triangles) lives in
          BuilderCanvas's bottom status bar via `onStats` — see App.tsx. This transient
          readout is only for the one state that bar has no room to explain: build in
          progress, before there's a frame to show. */}
      {active && stats?.status === 'building' && (
        <div className="by-pathtrace-stats" role="status">
          Building scene…
        </div>
      )}
    </div>
  );
}
