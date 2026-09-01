/**
 * Barrel for the graph feature — see `docs/ROADMAP.md`'s "Graph explode". `GraphMode`
 * is the only export a caller outside this directory needs; everything else
 * (`GraphExplodeScene`, `computeExplodeLayout`, `classifyEdges`, `computeGraphStats`)
 * is an internal.
 *
 * NOT YET WIRED IN. `GraphMode` takes a `SceneDocument` directly rather than calling
 * `useEditorSession()` itself, because that hook (`src/scene/interaction/session-
 * context.ts`) doesn't exist on `main` yet — it ships on a sibling branch
 * (`worktree-agent-afd78e9804bd3252b`), and the three-way mode switch this is meant to
 * render inside of ships on another (`worktree-agent-a22618cac2735c1b3`,
 * `ToolbarModeSwitch` in `src/ui/toolbar/types.ts`). Once both land on `main`, wiring
 * this in is:
 *
 *   // in the composition root, inside <EditorSessionProvider>:
 *   const session = useEditorSession();
 *   const modeSwitch: ToolbarModeSwitch = {
 *     id: 'app-mode',
 *     options: [
 *       { id: 'editor', label: 'Editor' },
 *       { id: 'graph', label: 'Graph', icon: <GraphIcon /> },
 *       { id: 'render', label: 'Render' },
 *     ],
 *     value: mode,
 *     onChange: setMode,
 *   };
 *   // viewport slot:
 *   {mode === 'graph' ? <GraphMode document={session.document} /> : <BuilderCanvas ... />}
 *
 * `GraphMode` reloads its scene once per mount (see its own doc comment) rather than
 * live-updating while the sandbox is edited underneath it — entering the mode fresh
 * each time is the deliberate scope; live-updating while mounted is a follow-up once
 * that wiring exists to test against.
 */
export { GraphMode } from './GraphMode';
export type { GraphModeProps } from './GraphMode';
