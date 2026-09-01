import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { FilterIcon } from '../icons';
import { useTooltip } from '../tooltip';

interface CategoryMenuProps {
  categories: readonly string[];
  /** `undefined` means no filter applied ("All categories"). */
  value: string | undefined;
  onChange: (category: string | undefined) => void;
  /** Label for the "no filter" entry, shown first in the list. */
  allLabel: string;
}

interface MenuPosition {
  top: number;
  left: number;
}

/** Gap between trigger and panel — matches `--by-space-1`, but this is a fixed-position
 * calculation in viewport px, not something a CSS var can reach into JS. */
const MENU_GAP = 4;
const VIEWPORT_MARGIN = 8;

/**
 * An icon-triggered popover list — the new `.by-menu` variant in `components.css`. Past
 * four options `.by-seg` doesn't fit and a bare `<select>` carries browser chrome the
 * rest of the system doesn't, so this is the documented gap: an icon button (`list-filter`,
 * already in docs/DESIGN.md's icon set) opens a floating list styled like the app's other
 * popovers.
 *
 * The panel renders through a portal into `document.body`, not inside `.by-panel`: the
 * chest's `.by-panel__body` is `overflow-y: auto`, which clips any absolutely-positioned
 * descendant at its own edge regardless of z-index — clipping is decided before stacking
 * is even considered. A portal escapes that ancestor entirely; position is computed from
 * `getBoundingClientRect()` on the trigger, `position: fixed` in the portal (so it needs
 * no offset parent), flipped above the trigger when it would overflow the bottom of the
 * viewport, and clamped so it never overflows the right edge either.
 *
 * The portal takes the panel out of DOM order, so focus is handled explicitly rather than
 * relied on: opening focuses the active item (or the first), and closing — by Escape, an
 * outside click, or picking an option — always returns focus to the trigger, which keeps
 * `aria-expanded` throughout.
 *
 * Scroll and resize are handled differently, deliberately: a window resize re-measures
 * and re-flips (the trigger itself may have moved), but a scroll just closes the menu
 * rather than re-tracking the trigger's position on every tick — the panel is anchored to
 * a button inside a scrolling chest, and continuously re-measuring against every possible
 * scrollable ancestor is more moving parts than a filter menu justifies.
 */
export function CategoryMenu({ categories, value, onChange, allLabel }: CategoryMenuProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    setPosition(null);
    triggerRef.current?.focus();
  }, []);

  // Shared by the initial two-pass placement and the resize handler below: measures the
  // trigger and the (already-mounted) panel, flips above the trigger when it would
  // overflow the bottom of the viewport, and clamps the right edge.
  const reposition = useCallback(() => {
    const trigger = triggerRef.current;
    const panel = panelRef.current;
    if (trigger === null || panel === null) return;

    const triggerRect = trigger.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const openUpward =
      triggerRect.bottom + MENU_GAP + panelRect.height > window.innerHeight - VIEWPORT_MARGIN;
    const top = openUpward
      ? triggerRect.top - MENU_GAP - panelRect.height
      : triggerRect.bottom + MENU_GAP;
    const maxLeft = window.innerWidth - panelRect.width - VIEWPORT_MARGIN;
    const left = Math.min(triggerRect.left, Math.max(VIEWPORT_MARGIN, maxLeft));
    setPosition({ top, left });
  }, []);

  // Two-pass position: the panel mounts first (so its real height is known), then this
  // measures it and sets the final position before the browser paints — no visible jump.
  useLayoutEffect(() => {
    if (open) reposition();
  }, [open, reposition]);

  // Focus the active item once the panel has a real position, and wire up dismissal.
  useEffect(() => {
    if (!open || position === null) return;

    const panel = panelRef.current;
    const target =
      panel?.querySelector<HTMLElement>('[aria-checked="true"]') ??
      panel?.querySelector<HTMLElement>('[data-menu-index]');
    target?.focus();

    function onPointerDown(event: PointerEvent) {
      const node = event.target as Node;
      if (panelRef.current?.contains(node) || triggerRef.current?.contains(node)) return;
      close();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    }
    // `capture: true` so this sees scroll events from any scrollable ancestor (`.by-
    // panel__body` included) — scroll doesn't bubble, but it does propagate on capture.
    // A resize re-measures and re-flips instead of closing — the trigger itself may have
    // moved (a reflow), so the fix is the same placement pass, not a dismissal.
    // Capture sees scroll from any scrollable ancestor of the trigger, which should
    // close this — the anchor moved. It equally sees this panel's own body, and with 15
    // categories the list overflows: closing there made it unscrollable, since the first
    // wheel tick closed it before scrollTop moved. Same fix as FilterMenu and
    // ColorTargetPicker.
    function onScroll(event: Event) {
      const node = event.target as Node;
      if (panelRef.current?.contains(node)) return;
      close();
    }
    document.addEventListener('scroll', onScroll, true);
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', reposition);
    return () => {
      document.removeEventListener('scroll', onScroll, true);
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', reposition);
    };
  }, [open, position, close, reposition]);

  function choose(next: string | undefined) {
    onChange(next);
    close();
  }

  function onItemKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number, count: number) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const item = panelRef.current?.querySelector<HTMLElement>(`[data-menu-index="${(index + 1) % count}"]`);
      item?.focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      const item = panelRef.current?.querySelector<HTMLElement>(
        `[data-menu-index="${(index - 1 + count) % count}"]`,
      );
      item?.focus();
    }
  }

  const current = value ?? allLabel;
  const options = [allLabel, ...categories];
  const tip = useTooltip({
    id: 'category-menu',
    label: value === undefined ? 'Filter by category' : `Filter by category: ${current}`,
  });

  return (
    <div className="by-menu">
      <button
        type="button"
        ref={(node) => {
          triggerRef.current = node;
          tip.ref(node);
        }}
        className={`by-icon-btn${value !== undefined ? ' is-active' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Filter by category: ${current}`}
        onClick={() => (open ? close() : setOpen(true))}
        onMouseEnter={tip.onMouseEnter}
        onMouseLeave={tip.onMouseLeave}
        onFocus={tip.onFocus}
        onBlur={tip.onBlur}
        aria-describedby={tip['aria-describedby']}
      >
        <FilterIcon />
      </button>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            className="by-menu__panel"
            role="menu"
            aria-label="Filter by category"
            style={{ top: position?.top ?? 0, left: position?.left ?? 0 }}
          >
            {options.map((option, index) => {
              const isAll = option === allLabel;
              const isActive = isAll ? value === undefined : value === option;
              return (
                <button
                  key={option}
                  type="button"
                  role="menuitemradio"
                  aria-checked={isActive}
                  data-menu-index={index}
                  className={`by-menu__item${isActive ? ' is-active' : ''}`}
                  onClick={() => choose(isAll ? undefined : option)}
                  onKeyDown={(event) => onItemKeyDown(event, index, options.length)}
                >
                  {option}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </div>
  );
}
