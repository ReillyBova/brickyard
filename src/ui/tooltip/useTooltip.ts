import { useCallback, useContext, useRef } from 'react';

import { TooltipContext } from './tooltipContext';
import { tooltipDomId } from './tooltipDomId';

export interface UseTooltipOptions {
  /** Stable, unique across the app (DOM ids and tooltip identity both derive from it). */
  id: string;
  /** Headline text — see docs/DESIGN.md: say what isn't already obvious from the control. */
  label: string;
  /** Glyphs in press order, e.g. `['⌘', 'Z']`. Omit for controls with no shortcut. */
  shortcut?: readonly string[];
  /**
   * Siblings sharing a `groupId` skip the 400ms delay when hopping between them. Give
   * every standalone control its own unique groupId (its `id` works fine) unless it's
   * genuinely part of a cluster the user reads as one object.
   */
  groupId?: string;
  disabled?: boolean;
}

export interface TooltipTriggerProps {
  ref: (node: HTMLElement | null) => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onFocus: () => void;
  onBlur: () => void;
  'aria-describedby': string | undefined;
}

/**
 * Wires one discrete control (a button that isn't part of a large repeated grid) up to
 * the shared tooltip host. Spread the returned props onto the trigger element:
 *
 *   const tip = useTooltip({ id: 'theme-toggle', label: 'Switch to light theme' });
 *   <button {...tip}>...</button>
 *
 * For a grid with many repeated items (a swatch palette, a tile chest), use
 * `useTooltipDelegate` instead — one listener per grid, not one hook call per item.
 */
export function useTooltip({ id, label, shortcut, groupId, disabled }: UseTooltipOptions): TooltipTriggerProps {
  const { state, show, hide } = useContext(TooltipContext);
  const nodeRef = useRef<HTMLElement | null>(null);

  const setRef = useCallback((node: HTMLElement | null) => {
    nodeRef.current = node;
  }, []);

  const open = useCallback(() => {
    if (disabled) return;
    const node = nodeRef.current;
    if (node === null) return;
    show({ id, rect: node.getBoundingClientRect(), label, shortcut }, groupId ?? id);
  }, [disabled, id, label, shortcut, groupId, show]);

  return {
    ref: setRef,
    onMouseEnter: open,
    onMouseLeave: hide,
    onFocus: open,
    onBlur: hide,
    'aria-describedby': state?.id === id ? tooltipDomId(id) : undefined,
  };
}
