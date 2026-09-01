import { useContext, useEffect, useRef } from 'react';
import type { RefObject } from 'react';

import { TooltipContext } from './tooltipContext';

/**
 * One delegated tooltip listener for a whole grid of repeated items — a swatch palette,
 * a part-tile chest — instead of a hook call (and its own hover/focus listeners) per
 * item. Hundreds of mounted listeners is the thing to avoid; per docs/DESIGN.md's
 * content rule, these grids also don't need per-item React state, since the tooltip
 * host itself is a single global bubble.
 *
 * Mark each item with `data-tooltip-id` (unique within the grid) and
 * `data-tooltip-label` (the text to show); this hook listens for
 * mouseover/mouseout/focusin/focusout on `containerRef` and resolves the hovered or
 * focused item via `closest('[data-tooltip-id]')`. All items in the grid share one
 * `groupId`, so moving the pointer or arrow-key focus between adjacent items in the same
 * grid never waits out the 400ms delay again — mirrors how a `ToolbarGroup` behaves.
 */
export function useTooltipDelegate(containerRef: RefObject<HTMLElement | null>, groupId: string): void {
  const { show, hide } = useContext(TooltipContext);
  const lastTarget = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;

    function resolve(target: EventTarget | null): HTMLElement | null {
      if (!(target instanceof HTMLElement)) return null;
      return target.closest<HTMLElement>('[data-tooltip-id]');
    }

    function openFor(el: HTMLElement) {
      const id = el.dataset.tooltipId;
      const label = el.dataset.tooltipLabel;
      if (id === undefined || label === undefined) return;
      lastTarget.current = el;
      show({ id, rect: el.getBoundingClientRect(), label }, groupId);
    }

    function onMouseOver(event: MouseEvent) {
      const el = resolve(event.target);
      if (el === null || el === lastTarget.current) return;
      openFor(el);
    }
    function onMouseOut(event: MouseEvent) {
      const next = resolve(event.relatedTarget);
      if (next === lastTarget.current) return;
      lastTarget.current = null;
      hide();
    }
    function onFocusIn(event: FocusEvent) {
      const el = resolve(event.target);
      if (el === null || el === lastTarget.current) return;
      openFor(el);
    }
    function onFocusOut(event: FocusEvent) {
      const next = resolve(event.relatedTarget);
      if (next === lastTarget.current) return;
      lastTarget.current = null;
      hide();
    }

    container.addEventListener('mouseover', onMouseOver);
    container.addEventListener('mouseout', onMouseOut);
    container.addEventListener('focusin', onFocusIn);
    container.addEventListener('focusout', onFocusOut);
    return () => {
      container.removeEventListener('mouseover', onMouseOver);
      container.removeEventListener('mouseout', onMouseOut);
      container.removeEventListener('focusin', onFocusIn);
      container.removeEventListener('focusout', onFocusOut);
    };
  }, [containerRef, show, hide, groupId]);
}
