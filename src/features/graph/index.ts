/**
 * Barrel for the graph feature — see `docs/ROADMAP.md`'s "Graph explode".
 *
 * `GraphModeMount` is what the toolbar's mode switch should render when its `graph`
 * option is active — a zero-prop component that reads the live document out of
 * `useEditorSession()` and explodes whatever the user actually has loaded, hand-built
 * or a bundled model, since PR #29 unified the two into one `EditorSession`.
 *
 * `GraphMode` is the presentational piece underneath it (`document: SceneDocument` in,
 * canvas + explode toggle + stats out) — exported too, for direct use or testing
 * against a hand-built document without a session in the picture.
 *
 * Everything else (`GraphExplodeScene`, `computeExplodeLayout`, `classifyEdges`,
 * `computeGraphStats`) is an internal.
 */
export { GraphModeMount } from './GraphModeMount';
export { GraphMode } from './GraphMode';
export type { GraphModeProps } from './GraphMode';
/** For the toolbar's `{ id: 'graph', label: 'Graph', icon: <GraphIcon /> }` mode option. */
export { GraphIcon } from './icons';
