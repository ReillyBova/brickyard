import { useCallback, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { TooltipContext } from './tooltipContext';
import type { TooltipState } from './tooltipContext';
import { TooltipHost } from './TooltipHost';

const SHOW_DELAY_MS = 400;
/** How long after leaving a group its next hover still counts as "already looking here". */
const GROUP_GRACE_MS = 300;

/**
 * App-wide tooltip host. Mounted once, wrapping `<App />` in `main.tsx`, so every
 * control below it can call `useTooltip` / `useTooltipDelegate` (`src/ui/tooltip/`)
 * instead of a native `title=`.
 *
 * Timing is ported from `src/ui/toolbar/ToolbarTooltipProvider.tsx` — 400ms delay,
 * instant when the next hover lands in the same group within 300ms of leaving the last
 * one. That file isn't imported directly: it belongs to the toolbar slice (in review,
 * off-limits here), and main doesn't have `src/ui/toolbar/` yet. This is a parallel
 * implementation with the same contract, not a fork of behaviour — the two should stay
 * in step if either changes.
 */
export function TooltipProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<TooltipState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const activeGroup = useRef<{ id: string; at: number } | null>(null);

  const show = useCallback((next: TooltipState, groupId: string) => {
    clearTimeout(timer.current);
    const recentlyInGroup =
      activeGroup.current?.id === groupId && Date.now() - activeGroup.current.at < GROUP_GRACE_MS;
    activeGroup.current = { id: groupId, at: Date.now() };
    if (recentlyInGroup) {
      setState(next);
      return;
    }
    timer.current = setTimeout(() => setState(next), SHOW_DELAY_MS);
  }, []);

  const hide = useCallback(() => {
    clearTimeout(timer.current);
    if (activeGroup.current) activeGroup.current = { ...activeGroup.current, at: Date.now() };
    setState(null);
  }, []);

  const value = useMemo(() => ({ state, show, hide }), [state, show, hide]);

  return (
    <TooltipContext.Provider value={value}>
      {children}
      <TooltipHost state={state} />
    </TooltipContext.Provider>
  );
}
