import { createContext } from 'react';

/**
 * Shared hover-delay state for tooltips outside the toolbar. Per docs/DESIGN.md:
 * tooltips wait 400ms before showing, except moving between siblings in the same group,
 * which shows instantly — the group reads as one object the user is already looking at.
 * Same timing contract as `src/ui/toolbar/tooltipContext.ts`; this is the app-wide
 * counterpart, used by every non-toolbar control (see `src/ui/tooltip/README` in
 * `TooltipProvider.tsx`'s doc comment for why the two aren't unified into one file).
 *
 * Unlike the toolbar's `openId`, this carries the trigger's `DOMRect` and content
 * directly, because `TooltipHost` renders through a portal (`position: fixed`) rather
 * than as an absolutely-positioned sibling of the trigger — the same clipping problem
 * `PartsChest/CategoryMenu.tsx` documents for its own popover applies here: several call
 * sites (the parts chest, the swatch grid) live inside `overflow-y: auto` panels.
 */
export interface TooltipState {
  id: string;
  rect: DOMRect;
  label: string;
  shortcut?: readonly string[];
}

export interface TooltipContextValue {
  state: TooltipState | null;
  show: (next: TooltipState, groupId: string) => void;
  hide: () => void;
}

const noop = (): void => {};

export const TooltipContext = createContext<TooltipContextValue>({
  state: null,
  show: noop,
  hide: noop,
});
