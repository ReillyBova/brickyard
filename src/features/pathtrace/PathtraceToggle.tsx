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
  rendererRef: RefObject<SceneRenderer | null>;
  active: boolean;
  onActiveChange: (active: boolean) => void;
}

export function PathtraceToggle({ rendererRef, active, onActiveChange }: PathtraceToggleProps) {
  const controllerRef = useRef<PathTracerController | null>(null);
  const [stats, setStats] = useState<PathtraceStats | null>(null);

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
    setStats({ status: 'building', samples: 0, renderScale: 0, spp: 0, frameMs: 0, triangleCount: 0 });

    controller
      .build(snapshot)
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
  }, [active]);

  const label = active ? 'Exit path-traced render' : 'Path-traced render';

  return (
    <div className="by-pathtrace-toggle">
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
      {active && stats !== null && (
        <div className="by-pathtrace-stats" role="status">
          {stats.status === 'building'
            ? 'Building scene…'
            : `${stats.triangleCount.toLocaleString()} tris · ${Math.round(stats.renderScale * 100)}% res · ${stats.spp} spp · ${stats.frameMs.toFixed(1)} ms`}
        </div>
      )}
    </div>
  );
}
