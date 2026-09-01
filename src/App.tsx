import { useEffect, useMemo, useState } from 'react';

import { importModel, RESOLVE_SHARE } from './features/omr/importModel';
import { createNetworkReader } from './features/omr/network';
import type { BundledModelEntry } from './features/omr/types';
import { AppRouter } from './routes/AppRouter';
import { MODELS_BASE } from './routes/ModelPicker';
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
import { PartsChest } from './ui/PartsChest/PartsChest';
import { PART_CATALOG } from './ui/PartsChest/catalog';
// GRAPH FEATURE MOUNT POINT — src/features/graph/ owns everything the entry control
// opens. A toolbar with a reserved slot for this button is being built in parallel;
// this floating control is the placeholder until the two are wired together at merge.
import { GraphEntry } from './features/graph';
import { Toolbar, useGrouping, useUndoRedo } from './ui/toolbar';

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
function BuilderToolbar() {
  const session = useEditorSessionOrNull();
  const [, forceRender] = useState(0);
  useEffect(() => {
    if (!session) return;
    return session.subscribe(() => forceRender((n) => n + 1));
  }, [session]);

  const [undoAction, redoAction] = useUndoRedo(session);
  const [groupAction, ungroupAction] = useGrouping(session);

  // The app's one persistent mode — editor, graph, or render — per the architecture
  // note this toolbar's contract was built against. Only "editor" actually renders
  // anything today; graph and render are the other two slices' routes, not this one's,
  // so switching here doesn't yet change the view.
  const [mode, setMode] = useState<'editor' | 'graph' | 'render'>('editor');

  return (
    <Toolbar
      items={[
        { kind: 'group', group: { id: 'history', actions: [undoAction, redoAction] } },
        { kind: 'group', group: { id: 'grouping', actions: [groupAction, ungroupAction] } },
        {
          kind: 'modeSwitch',
          modeSwitch: {
            id: 'app-mode',
            options: [
              { id: 'editor', label: 'Editor' },
              { id: 'graph', label: 'Graph' },
              { id: 'render', label: 'Render' },
            ],
            value: mode,
            onChange: (id) => setMode(id as typeof mode),
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
  const { seed, state: loadState, clearSeed } = useModelLoad(pendingModel);

  // One offscreen renderer for the whole session — see src/scene/thumbnail.ts. Built once
  // via useMemo rather than per render, since it owns a WebGL context.
  const thumbnailSource = useMemo(() => new RuntimeThumbnailRenderer(), []);

  const activeColor = useMemo(
    () => LDRAW_PALETTE.find((color) => color.code === selectedColorCode) ?? LDRAW_PALETTE[0],
    [selectedColorCode],
  );

  return (
    <EditorSessionProvider session={session}>
      <AppShell
        viewport={
          <>
            <BuilderCanvas
              heldPartId={selectedPartId}
              heldColorCode={selectedColorCode}
              onHeldConsumed={() => setSelectedPartId(undefined)}
              seed={seed}
              onSeedConsumed={() => {
                clearSeed();
                onModelConsumed();
              }}
              onSessionReady={setSession}
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
          </>
        }
        toolbar={<BuilderToolbar />}
        chestPanel={
          <PartsChest
            parts={PART_CATALOG}
            selectedId={selectedPartId}
            onSelect={setSelectedPartId}
            activeColorHex={activeColor.hex}
            thumbnailSource={thumbnailSource}
          />
        }
        colorPanel={
          <ColorPicker colors={LDRAW_PALETTE} selectedCode={selectedColorCode} onSelect={setSelectedColorCode} />
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
      {/* GRAPH FEATURE MOUNT POINT — see src/features/graph/. Floats over every route
          until the toolbar's reserved slot is wired up. */}
      <GraphEntry />
    </RouteProvider>
  );
}

export default App;
