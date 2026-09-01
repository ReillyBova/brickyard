import { useEffect, useMemo, useRef, useState } from 'react';

import { importModel, RESOLVE_SHARE } from './features/omr/importModel';
import { LoadModelPanel } from './features/omr/LoadModelPanel';
import { MODELS_BASE } from './features/omr/modelIndex';
import { createNetworkReader } from './features/omr/network';
import type { BundledModelEntry } from './features/omr/types';
import {
  StatusToast,
  UnsavedChangesDialog,
  useBeforeUnload,
  useDirty,
  useFileActions,
} from './features/persist';
import { AppRouter } from './routes/AppRouter';
import { useRoute } from './routes/route-context';
import { RouteProvider } from './routes/router';
import type { DocumentSeed } from './scene/interaction/BuilderCanvas.tsx';
import { BuilderCanvas } from './scene/interaction/BuilderCanvas.tsx';
import type { EditorSession } from './scene/interaction/editor.ts';
import { useEditorSessionOrNull } from './scene/interaction/session-context.ts';
import { EditorSessionProvider } from './scene/interaction/sessionContext.tsx';
import { RuntimeThumbnailRenderer } from './scene/thumbnail.ts';
import { AppShell } from './ui/AppShell/AppShell';
import { ColorPicker } from './ui/ColorPicker/ColorPicker';
import { LDRAW_PALETTE } from './ui/ColorPicker/palette';
import { ApertureIcon, EditorIcon, GraphModeIcon, PackageIcon, PaintbrushIcon } from './ui/icons';
import { PartsChest } from './ui/PartsChest/PartsChest';
import { PART_CATALOG } from './ui/PartsChest/catalog';
import { GraphModeMount } from './features/graph';
import { EnvironmentPanel } from './features/pathtrace/EnvironmentPanel';
import { DEFAULT_ENVIRONMENT } from './features/pathtrace/environments';
import type { PathtraceEnvironment } from './features/pathtrace/environments';
import { DEFAULT_LIGHTING } from './features/pathtrace/lighting';
import type { LightingPreset } from './features/pathtrace/lighting';
import { PathtraceToggle } from './features/pathtrace/PathtraceToggle';
import type { PathtraceStats } from './features/pathtrace/PathTracerController';
import { RestyleContainer } from './features/restyle';
import type { SceneRenderer } from './scene/SceneRenderer.ts';
import { Toolbar, useGrouping, useUndoRedo } from './ui/toolbar';
import type { ToolbarAction } from './ui/toolbar/types';

/** The app's three modes. Editor is where everything is built; the other two are views over it. */
export type AppMode = 'editor' | 'graph' | 'render';

/** LDraw 4 — classic brick red — so the chest always has a real active color to preview. */
const DEFAULT_COLOR_CODE = 4;

type ModelLoadState = { progress: number; phase: string } | { error: string } | null;

/**
 * Fetches and imports a bundled model, reporting `docs/ARCHITECTURE.md`'s `0..1`
 * progress convention. Lives in the composition root rather than inside `BuilderCanvas`
 * because import mechanics (`src/features/omr/`) sit above `src/scene/interaction/` in
 * the module dependency graph — `features/` depends on `scene/`, never the reverse.
 * `BuilderCanvas` only ever receives a finished `SceneDocument` plus its resolved parts,
 * through the same `seed` prop a hand-built document would use.
 */
function useModelLoad(
  entry: BundledModelEntry | undefined,
): { seed: DocumentSeed | undefined; state: ModelLoadState; clearSeed: () => void } {
  const [seed, setSeed] = useState<DocumentSeed | undefined>(undefined);
  const [state, setState] = useState<ModelLoadState>(null);

  useEffect(() => {
    if (!entry) return;
    let cancelled = false;
    setState({ progress: 0, phase: 'fetching' });

    void (async () => {
      const text = await fetch(`${MODELS_BASE}${entry.mpdFile}`).then((res) => {
        if (!res.ok) throw new Error(`fetching ${entry.mpdFile}: ${res.status} ${res.statusText}`);
        return res.text();
      });
      if (cancelled) return;

      const { read } = createNetworkReader();
      const result = await importModel(text, entry.name, {
        read,
        onProgress: (progress) => {
          if (cancelled) return;
          setState({ progress, phase: progress < RESOLVE_SHARE ? 'resolving parts' : 'solving connection graph' });
        },
      });
      if (cancelled) return;

      setSeed({ document: result.document, parts: [...result.partDefs.values()] });
      setState(null);
    })().catch((err: unknown) => {
      if (!cancelled) setState({ error: String(err) });
    });

    return () => {
      cancelled = true;
    };
  }, [entry]);

  return { seed, state, clearSeed: () => setSeed(undefined) };
}

/**
 * The top toolbar, split out so it can call `useEditorSessionOrNull` — it has to render
 * as a child of `EditorSessionProvider` to see the session at all, and `SandboxEditor`
 * itself renders before that provider has one (the canvas reports it asynchronously via
 * `onSessionReady`). `useUndoRedo`/`useGrouping` both accept `null` and degrade to
 * disabled actions for exactly that first frame.
 */
function BuilderToolbar({
  mode,
  onModeChange,
  onToggleRestyle,
  restyleOpen,
  onToggleLoadModel,
  loadModelOpen,
  fileActions,
}: {
  mode: AppMode;
  onModeChange: (mode: AppMode) => void;
  onToggleRestyle: () => void;
  restyleOpen: boolean;
  onToggleLoadModel: () => void;
  loadModelOpen: boolean;
  /** Save / Open / Export / Import — built in `SandboxEditor` via `useFileActions`, so
   * the dialog guarding the wordmark and this toolbar group share one `markSaved`. */
  fileActions: readonly ToolbarAction[];
}) {
  const session = useEditorSessionOrNull();
  const [, forceRender] = useState(0);
  useEffect(() => {
    if (!session) return;
    return session.subscribe(() => forceRender((n) => n + 1));
  }, [session]);

  const [undoAction, redoAction] = useUndoRedo(session);
  const [groupAction, ungroupAction] = useGrouping(session);

  // Restyle is an action *within* the editor, not a mode — it recolors whatever is
  // loaded, so it only makes sense while the editor owns the view.
  const restyleAction = {
    id: 'restyle',
    label: 'Restyle',
    icon: <PaintbrushIcon />,
    active: restyleOpen,
    disabled: session === null || mode !== 'editor',
    onClick: onToggleRestyle,
  };

  // Loading a model is an action within the editor too, the same as restyle — it opens
  // the chest rail's counterpart to `/models` rather than switching anywhere, so
  // building and loading stay in one place. First in the list: it's the primary way
  // content gets onto the baseplate, alongside the file actions.
  const loadModelAction = {
    id: 'load-model',
    label: 'Load model',
    icon: <PackageIcon />,
    active: loadModelOpen,
    disabled: session === null || mode !== 'editor',
    onClick: onToggleLoadModel,
  };

  return (
    <Toolbar
      items={[
        { kind: 'group', group: { id: 'load', actions: [loadModelAction] } },
        { kind: 'group', group: { id: 'history', actions: [undoAction, redoAction] } },
        { kind: 'group', group: { id: 'grouping', actions: [groupAction, ungroupAction] } },
        { kind: 'group', group: { id: 'style', actions: [restyleAction] } },
        { kind: 'group', group: { id: 'file', actions: fileActions } },
        {
          kind: 'modeSwitch',
          modeSwitch: {
            id: 'app-mode',
            options: [
              { id: 'editor', label: 'Editor', icon: <EditorIcon /> },
              { id: 'graph', label: 'Graph', icon: <GraphModeIcon /> },
              { id: 'render', label: 'Render', icon: <ApertureIcon /> },
            ],
            value: mode,
            onChange: (id) => onModeChange(id as AppMode),
          },
        },
      ]}
    />
  );
}

/**
 * The `/sandbox` route. Owns the only state in the UI slice — which part and color are
 * selected — as plain `useState`; the document store connects here once it exists.
 * Everything below is built and verified against mock data, per docs/AGENTS.md: this
 * slice must not depend on `src/scene/` or `src/model/` internals. It does depend on
 * `src/ldraw/colors.ts` for the real LDraw palette (`ui/ColorPicker/palette.ts`) — a
 * pure parser over a committed fixture, not a runtime dependency on the ldraw slice's
 * fetch/cache machinery.
 */
function SandboxEditor({
  pendingModel,
  onModelConsumed,
}: {
  /** A bundled model chosen from `/models`, still importing or ready to seed. */
  pendingModel?: BundledModelEntry;
  onModelConsumed: () => void;
}) {
  const [selectedPartId, setSelectedPartId] = useState<string | undefined>(undefined);
  const [selectedColorCode, setSelectedColorCode] = useState<number>(DEFAULT_COLOR_CODE);
  const [session, setSession] = useState<EditorSession | null>(null);
  const [mode, setMode] = useState<AppMode>('editor');
  const [restyleOpen, setRestyleOpen] = useState(false);
  const [loadModelOpen, setLoadModelOpen] = useState(false);
  const [environment, setEnvironment] = useState<PathtraceEnvironment>(DEFAULT_ENVIRONMENT);
  const [lighting, setLighting] = useState<LightingPreset>(DEFAULT_LIGHTING);
  const [pathtraceStats, setPathtraceStats] = useState<PathtraceStats | null>(null);
  // The path tracer shares this renderer's GL context, camera and controls rather than
  // opening a second one — see SceneRenderer.getPathtraceSnapshot().
  const rendererRef = useRef<SceneRenderer | null>(null);
  // There is no autosave: leaving the editor and coming back gives an empty baseplate,
  // and opening a model replaces the document outright. Persistence is explicit —
  // Save, Open, Export, Import — so what is on screen is always what you last chose.
  const { seed, state: loadState, clearSeed: clearModelSeed } = useModelLoad(pendingModel);

  // "Dirty" tracks commits since the last save/load, per docs/ROADMAP.md's "Save and
  // load" and the wordmark's unsaved-work guard — see src/features/persist/dirty.ts for
  // why this reads only EditorSession's public surface rather than editing that file.
  const dirty = useDirty(session);
  useBeforeUnload(dirty.dirty);
  const fileActions = useFileActions(session, dirty.markSaved);
  const { navigate } = useRoute();
  const [confirmLeave, setConfirmLeave] = useState(false);

  // One offscreen renderer for the whole session — see src/scene/thumbnail.ts. Built once
  // via useMemo rather than per render, since it owns a WebGL context.
  const thumbnailSource = useMemo(() => new RuntimeThumbnailRenderer(), []);

  const activeColor = useMemo(
    () => LDRAW_PALETTE.find((color) => color.code === selectedColorCode) ?? LDRAW_PALETTE[0],
    [selectedColorCode],
  );

  // fps / rays cast / resolution, appended to the bottom status bar in render mode —
  // BuilderCanvas owns the bar's layout, this only supplies its content (see
  // `statusExtra` on BuilderCanvas and `onStats` on PathtraceToggle).
  const pathtraceStatusExtra =
    mode === 'render' && pathtraceStats?.status === 'rendering' ? (
      <span className="by-mono">
        {Math.round(pathtraceStats.fps)} fps · {pathtraceStats.raysCast.toLocaleString()} rays ·{' '}
        {Math.round(pathtraceStats.renderScale * 100)}% res
      </span>
    ) : mode === 'render' && pathtraceStats?.status === 'moving' ? (
      // No trace runs while the camera moves — see PathTracerController — so there are no
      // rays or resolution to report, only the live rasterized frame rate.
      <span className="by-mono">{Math.round(pathtraceStats.fps)} fps · live</span>
    ) : null;

  return (
    <EditorSessionProvider session={session}>
      <AppShell
        viewport={
          <>
            {/* The canvas is never unmounted when the mode changes: BuilderCanvas reports
                null through onSessionReady on unmount, which would destroy the
                EditorSession the other two modes read from. Graph hides it; render
                borrows its GL context. */}
            <div style={{ visibility: mode === 'graph' ? 'hidden' : 'visible', position: 'absolute', inset: 0 }}>
            <BuilderCanvas
              suspended={mode !== 'editor'}
              onRendererReady={(renderer) => {
                rendererRef.current = renderer;
              }}
              heldPartId={selectedPartId}
              heldColorCode={selectedColorCode}
              onHeldConsumed={() => setSelectedPartId(undefined)}
              seed={seed}
              onSeedConsumed={() => {
                // Freshly loaded counts as "nothing unsaved yet" — the same reasoning
                // `useFileActions` applies after Open/Import.
                clearModelSeed();
                onModelConsumed();
                dirty.markSaved();
              }}
              onSessionReady={setSession}
              statusExtra={pathtraceStatusExtra}
            />
            </div>
            {mode === 'graph' && <GraphModeMount />}
            <PathtraceToggle
              chromeless
              rendererRef={rendererRef}
              active={mode === 'render'}
              onActiveChange={(active) => setMode(active ? 'render' : 'editor')}
              environment={environment}
              lighting={lighting}
              onStats={setPathtraceStats}
            />
            {loadState && (
              <div className="by-model-load-overlay">
                {'error' in loadState ? (
                  <p className="by-mono by-faint">Failed to load model: {loadState.error}</p>
                ) : (
                  <>
                    <div
                      className="by-progress"
                      role="progressbar"
                      aria-valuenow={Math.round(loadState.progress * 100)}
                    >
                      <div
                        className="by-progress__fill"
                        style={{ width: `${Math.round(loadState.progress * 100)}%` }}
                      />
                    </div>
                    <p className="by-mono by-faint">
                      {Math.round(loadState.progress * 100)}% · {loadState.phase}
                    </p>
                  </>
                )}
              </div>
            )}
            <StatusToast status={fileActions.status} onDismiss={fileActions.dismissStatus} />
            {confirmLeave && (
              <UnsavedChangesDialog
                onCancel={() => setConfirmLeave(false)}
                onLeaveWithoutSaving={() => {
                  setConfirmLeave(false);
                  navigate('landing');
                }}
                onSaveAndLeave={() => {
                  fileActions.actions[0].onClick();
                  setConfirmLeave(false);
                  navigate('landing');
                }}
              />
            )}
          </>
        }
        onWordmarkClick={() => {
          if (dirty.dirty) setConfirmLeave(true);
          else navigate('landing');
        }}
        toolbar={
          <BuilderToolbar
            mode={mode}
            onModeChange={(next) => {
              setMode(next);
              if (next !== 'editor') {
                setRestyleOpen(false);
                setLoadModelOpen(false);
              }
            }}
            onToggleRestyle={() => {
              setRestyleOpen((open) => !open);
              setLoadModelOpen(false);
            }}
            restyleOpen={restyleOpen}
            onToggleLoadModel={() => {
              setLoadModelOpen((open) => !open);
              setRestyleOpen(false);
            }}
            loadModelOpen={loadModelOpen}
            fileActions={fileActions.actions}
          />
        }
        chestPanel={
          mode === 'graph' ? (
            // Nothing to place or color while reading the graph — the rail's space is
            // better given back to the view.
            null
          ) : mode === 'render' ? (
            <EnvironmentPanel
              environment={environment}
              onEnvironmentChange={setEnvironment}
              lighting={lighting}
              onLightingChange={setLighting}
            />
          ) : restyleOpen && session !== null ? (
            // Restyle replaces the chest rather than floating over it: while remapping
            // colors there is nothing to place, and the palette below would compete with
            // the panel's own per-row color targets.
            <RestyleContainer session={session} onClose={() => setRestyleOpen(false)} />
          ) : loadModelOpen && session !== null ? (
            // Same reasoning as restyle: browsing models to load competes with the
            // chest's own part grid, so it replaces it rather than floating over it.
            <LoadModelPanel
              onLoad={(doc, parts) => {
                session.mergeDocument(doc, parts);
                setLoadModelOpen(false);
              }}
              onClose={() => setLoadModelOpen(false)}
            />
          ) : (
            <PartsChest
              parts={PART_CATALOG}
              selectedId={selectedPartId}
              onSelect={setSelectedPartId}
              activeColorHex={activeColor.hex}
              thumbnailSource={thumbnailSource}
            />
          )
        }
        colorPanel={
          mode !== 'editor' || restyleOpen || loadModelOpen ? null : (
            <ColorPicker colors={LDRAW_PALETTE} selectedCode={selectedColorCode} onSelect={setSelectedColorCode} />
          )
        }
      />
    </EditorSessionProvider>
  );
}

/**
 * Composition root. Mounts the hand-rolled router (`src/routes/`) and hands it the
 * sandbox editor as a prop, so the routing slice never imports `src/scene/` or
 * `src/model/` directly — see `src/routes/AppRouter.tsx`.
 *
 * Owns which bundled model (if any) is being opened: `/models` picks one, this fetches
 * and imports it, and the sandbox seeds its one `EditorSession` from the result once
 * it's ready — "load a model" and "open the sandbox" are the same screen, differing
 * only in whether the document starts empty or populated.
 */
function App() {
  const [pendingModel, setPendingModel] = useState<BundledModelEntry | undefined>(undefined);

  return (
    <RouteProvider>
      <AppRouter
        sandbox={<SandboxEditor pendingModel={pendingModel} onModelConsumed={() => setPendingModel(undefined)} />}
        onOpenModel={setPendingModel}
      />
    </RouteProvider>
  );
}

export default App;
