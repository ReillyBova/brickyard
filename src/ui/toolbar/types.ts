/**
 * The toolbar slot contract.
 *
 * This is what a feature codes against to put a control in the top rail. Two shapes,
 * for the two things a toolbar control actually is:
 *
 * `ToolbarAction` — a momentary command or an on/off toggle, rendered as `.by-icon-btn`.
 * Group related ones into a `ToolbarGroup`, which rides one `.by-tool-group` pill.
 *
 *   const restyleAction: ToolbarAction = {
 *     id: 'restyle',
 *     icon: <PaintbrushIcon />,
 *     label: 'Restyle',                 // accessible name + tooltip headline
 *     shortcut: ['⌘', '⇧', 'R'],         // optional — shown in the tooltip via `.by-kbd-set`
 *     active: panelOpen,                 // optional — renders `.is-active`
 *     disabled: selection.size === 0,    // optional
 *     onClick: () => setPanelOpen((open) => !open),
 *     panel: panelOpen ? <RestylePanel .../> : undefined, // optional popover content
 *   };
 *
 * `ToolbarModeSwitch` — the app's one exclusive, persistent mode: editor, graph, or
 * render (the `.by-seg` sketched in `design-language.html`, now three-way rather than
 * the two it originally showed). Not a `ToolbarAction`: a mode has no "active" boolean,
 * no shortcut chip, and never sits inside a `.by-tool-group` — it's a standing choice
 * among options, not a command, and there is exactly one of it in the toolbar.
 * Everything else — including restyle's paintbrush — is an *action within a mode*, not
 * a mode of its own; see `restyleAction` above, which opens a panel over the editor
 * rather than switching anywhere.
 *
 *   const appModeSwitch: ToolbarModeSwitch = {
 *     id: 'app-mode',
 *     options: [
 *       { id: 'editor', label: 'Editor', icon: <EditorIcon /> },
 *       { id: 'graph', label: 'Graph', icon: <GraphModeIcon /> },
 *       { id: 'render', label: 'Render', icon: <ApertureIcon /> },
 *     ],
 *     value: mode,                       // 'editor' | 'graph' | 'render'
 *     onChange: setMode,
 *   };
 *
 * Hand either shape to `<Toolbar items={[...]} />` (see `Toolbar.tsx`) wrapped as a
 * `ToolbarItem`. The toolbar owns layout, spacing, tooltip behaviour, and disabled/active
 * styling; a contributing slice owns only the meaning of its own actions or modes.
 * `ToolbarModeSwitchView` (used internally by `Toolbar`) renders the switch icon-only —
 * see `ToolbarModeOption.label`'s own doc for why.
 *
 * Rules for a conforming action (per docs/DESIGN.md):
 * - `label` is the *undo-label vocabulary* where one applies — "Rotate assembly", not
 *   "Transform". Tooltip and accessible name both come from it verbatim; don't write a
 *   second string.
 * - `shortcut` keys are the literal glyphs to render (`'⌘'`, `'⇧'`, `'Z'`), already in the
 *   order they're pressed. The toolbar renders them in `.by-kbd` chips; it does not know or
 *   enforce what actually triggers the shortcut — a contributing slice registers its own
 *   keydown handler (see `useUndoRedo.tsx` for a worked example) and only *reports* the
 *   combination here so the tooltip stays honest.
 * - Icons come from `src/ui/icons.tsx` at stroke-width 2.75, sized by `.by-icon-btn` (18px)
 *   — never a raw SVG import, never a different icon set.
 * - A group is a set of *related* actions that should read as one object riding one pill
 *   (`.by-tool-group`). Keep groups small; a lone action is still a group of one.
 * - A mode switch is 2–4 options, per `.by-seg`'s own guidance (`docs/DESIGN.md`) — for
 *   more than that, it isn't a segmented control any more.
 */

import type { ReactNode } from 'react';

export interface ToolbarAction {
  /** Stable, unique within the toolbar. Used as the React key. */
  id: string;
  icon: ReactNode;
  /** Accessible name and tooltip headline — the user's-terms verb, e.g. "Undo Place brick". */
  label: string;
  /** Glyphs in press order, e.g. `['⌘', 'Z']`. Omit for actions with no shortcut. */
  shortcut?: readonly string[];
  /** Renders `.is-active` — for toggles and open panels, not for momentary commands. */
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  /**
   * Optional popover content shown near the button while `active` — a color panel, a
   * settings sheet. The toolbar renders it but has no opinion on its contents.
   */
  panel?: ReactNode;
}

export interface ToolbarGroup {
  /** Stable, unique within the toolbar. Used as the React key. */
  id: string;
  actions: readonly ToolbarAction[];
}

export interface ToolbarModeOption {
  /** Stable, unique within the switch. Also the value passed to `onChange`. */
  id: string;
  /**
   * Accessible name and tooltip text. `ToolbarModeSwitchView` renders `.by-seg__opt`
   * icon-only — three options plus the wordmark and theme toggle otherwise crowd the
   * bar at narrow widths — so this never appears as visible text, only as the button's
   * `aria-label` and its hover/focus tooltip. Always supply `icon` too: with neither a
   * visible label nor an icon the option renders blank.
   */
  label: string;
  icon?: ReactNode;
}

export interface ToolbarModeSwitch {
  /** Stable, unique within the toolbar. Used as the React key and the group's aria-label. */
  id: string;
  /** 2–4 options; see the rule above. */
  options: readonly ToolbarModeOption[];
  /** The `id` of the active option. */
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}

/** One entry in the toolbar's `items` array — a command group or a mode switch. */
export type ToolbarItem =
  | { kind: 'group'; group: ToolbarGroup }
  | { kind: 'modeSwitch'; modeSwitch: ToolbarModeSwitch };
