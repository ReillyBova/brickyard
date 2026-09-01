import { createContext } from 'react';

/**
 * Shared hover-delay state for one toolbar. Per docs/DESIGN.md: tooltips wait 400ms
 * before showing, except moving between siblings in the same tool group, which shows
 * instantly — the group reads as one object the user is already looking at. The
 * provider that implements this timing lives in `ToolbarTooltipProvider.tsx`; this file
 * only holds the context object so it isn't bundled with a component export (fast
 * refresh wants one or the other per file, not both).
 */
export interface TooltipState {
  openId: string | null;
  show: (id: string, groupId: string) => void;
  hide: () => void;
}

const noop = (): void => {};

export const ToolbarTooltipContext = createContext<TooltipState>({
  openId: null,
  show: noop,
  hide: noop,
});
