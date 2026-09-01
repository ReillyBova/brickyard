/**
 * The toolbar slot contract.
 *
 * This is what a feature codes against to put a control in the top rail: build a
 * `ToolbarAction`, put it in a `ToolbarGroup`, hand the group to `<Toolbar groups={...} />`
 * (see `Toolbar.tsx`). Nothing else is required — the toolbar owns layout, spacing,
 * the pill-raft grouping, tooltip behaviour and disabled/active styling; a contributing
 * slice owns only the action's meaning.
 *
 *   const restyleAction: ToolbarAction = {
 *     id: 'restyle',
 *     icon: <PaintbrushIcon />,
 *     label: 'Restyle',                 // accessible name + tooltip headline
 *     shortcut: ['⌘', '⇧', 'R'],         // optional — shown in the tooltip via `.by-kbd-set`
 *     active: panelOpen,                 // optional — renders `.is-active`
 *     disabled: selection.size === 0,    // optional
 *     onClick: () => setPanelOpen(true),
 *     panel: panelOpen ? <RestylePanel .../> : undefined, // optional popover content
 *   };
 *
 * Rules for a conforming action (per docs/DESIGN.md):
 * - `label` is the *undo-label vocabulary* where one applies — "Rotate assembly", not
 *   "Transform". Tooltip and accessible name both come from it verbatim; don't write a
 *   second string.
 * - `shortcut` keys are the literal glyphs to render (`'⌘'`, `'⇧'`, `'Z'`), already in the
 *   order they're pressed. The toolbar renders them in `.by-kbd` chips; it does not know or
 *   enforce what actually triggers the shortcut — a contributing slice registers its own
 *   keydown handler (see `useUndoRedo.ts` for a worked example) and only *reports* the
 *   combination here so the tooltip stays honest.
 * - Icons come from `src/ui/icons.tsx` at stroke-width 2.75, sized by `.by-icon-btn` (18px)
 *   — never a raw SVG import, never a different icon set.
 * - A group is a set of *related* actions that should read as one object riding one pill
 *   (`.by-tool-group`). Keep groups small; a lone action is still a group of one.
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
