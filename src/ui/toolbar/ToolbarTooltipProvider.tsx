import { useCallback, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { ToolbarTooltipContext } from './tooltipContext';

const SHOW_DELAY_MS = 400;
/** How long after leaving a group its next hover still counts as "already looking here". */
const GROUP_GRACE_MS = 300;

export function ToolbarTooltipProvider({ children }: { children: ReactNode }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // The group currently (or most recently) shown, so a hop to a sibling in the same
  // group skips the delay and a hop elsewhere waits out the full 400ms again.
  const activeGroup = useRef<{ id: string; at: number } | null>(null);

  const show = useCallback((id: string, groupId: string) => {
    clearTimeout(timer.current);
    const recentlyInGroup =
      activeGroup.current?.id === groupId && Date.now() - activeGroup.current.at < GROUP_GRACE_MS;
    activeGroup.current = { id: groupId, at: Date.now() };
    if (recentlyInGroup) {
      setOpenId(id);
      return;
    }
    timer.current = setTimeout(() => setOpenId(id), SHOW_DELAY_MS);
  }, []);

  const hide = useCallback(() => {
    clearTimeout(timer.current);
    if (activeGroup.current) activeGroup.current = { ...activeGroup.current, at: Date.now() };
    setOpenId(null);
  }, []);

  const value = useMemo(() => ({ openId, show, hide }), [openId, show, hide]);

  return <ToolbarTooltipContext.Provider value={value}>{children}</ToolbarTooltipContext.Provider>;
}
