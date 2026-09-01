import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import type { TooltipState } from './tooltipContext';
import { tooltipDomId } from './tooltipDomId';

const GAP = 6;
const VIEWPORT_MARGIN = 8;

interface Position {
  top: number;
  left: number;
}

/**
 * The one floating tooltip bubble for the whole app. Portaled to `document.body` and
 * positioned `fixed` from the trigger's `DOMRect` — see `tooltipContext.ts` for why a
 * portal, not an absolutely-positioned sibling like the toolbar's own tooltip.
 *
 * Two-pass placement, same pattern as `PartsChest/CategoryMenu.tsx`: render once
 * (invisible) so the bubble's real size is known, then measure and place before paint.
 * Centered under the trigger, flipped above it when that would overflow the viewport
 * bottom, clamped off the side edges.
 */
export function TooltipHost({ state }: { state: TooltipState | null }) {
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<Position | null>(null);

  useLayoutEffect(() => {
    if (state === null) {
      setPosition(null);
      return;
    }
    const bubble = bubbleRef.current;
    if (bubble === null) return;

    const bubbleRect = bubble.getBoundingClientRect();
    const { rect } = state;
    const openUpward =
      rect.bottom + GAP + bubbleRect.height > window.innerHeight - VIEWPORT_MARGIN;
    const top = openUpward ? rect.top - GAP - bubbleRect.height : rect.bottom + GAP;
    const center = rect.left + rect.width / 2;
    const maxLeft = window.innerWidth - bubbleRect.width - VIEWPORT_MARGIN;
    const left = Math.min(Math.max(center - bubbleRect.width / 2, VIEWPORT_MARGIN), Math.max(VIEWPORT_MARGIN, maxLeft));
    setPosition({ top, left });
    // Re-measured from `state` alone: the bubble's content is entirely a function of it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  if (state === null) return null;

  return createPortal(
    <div
      ref={bubbleRef}
      className="by-tooltip-float"
      role="tooltip"
      id={tooltipDomId(state.id)}
      style={{
        top: position?.top ?? 0,
        left: position?.left ?? 0,
        visibility: position === null ? 'hidden' : 'visible',
      }}
    >
      <span className="by-tooltip">
        <span>{state.label}</span>
        {state.shortcut && state.shortcut.length > 0 && (
          <span className="by-kbd-set">
            {state.shortcut.map((key, i) => (
              // eslint-disable-next-line react/no-array-index-key
              <span className="by-kbd" key={i}>
                {key}
              </span>
            ))}
          </span>
        )}
      </span>
    </div>,
    document.body,
  );
}
