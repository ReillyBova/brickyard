import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { CheckIcon, FilterIcon } from '../icons';
import { useTooltip } from '../tooltip';

export interface FilterMenuSection {
  /** Stable key, distinct across sections. */
  key: string;
  label: string;
  options: readonly string[];
  selected: ReadonlySet<string>;
  onToggle: (option: string) => void;
}

interface FilterMenuProps {
  sections: readonly FilterMenuSection[];
  /** Total selected values across every section — drives the trigger's badge and label. */
  activeCount: number;
  onClearAll: () => void;
  /** What's being filtered, for the trigger's accessible name — e.g. "models". */
  subject: string;
}

interface MenuPosition {
  top: number;
  left: number;
}

/** Gap between trigger and panel — matches `--by-space-1`, but this is a fixed-position
 * calculation in viewport px, not something a CSS var can reach into JS. Mirrors CategoryMenu. */
const MENU_GAP = 4;
const VIEWPORT_MARGIN = 8;

/**
 * A single filter trigger opening a portal-positioned popover with two or more
 * multi-select sections — the `.by-menu` variant, generalized from `CategoryMenu`'s
 * single-select radio list to checkbox groups that combine (any value within a section
 * is OR'd; sections AND together). One button replaces one-button-per-filter-dimension,
 * with a count badge standing in for the "which filters are on" glance a bank of buttons
 * used to give for free.
 *
 * Positioning, focus and dismissal follow `CategoryMenu` exactly (portal into
 * `document.body`, two-pass measure-then-place, flip above the trigger when the bottom
 * would overflow, clamp the left edge into the viewport rather than letting it run off
 * the right) — see that file for the reasoning. Kept as a sibling copy rather than a
 * shared hook because the item model underneath differs (radio vs. checkbox, one list vs.
 * sectioned lists); if a third menu needs this, that's the point to extract it.
 */
export function FilterMenu({ sections, activeCount, onClearAll, subject }: FilterMenuProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    setPosition(null);
    triggerRef.current?.focus();
  }, []);

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

  useLayoutEffect(() => {
    if (open) reposition();
  }, [open, reposition]);

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
    // `capture: true` sees scroll from any scrollable ancestor of the *trigger*, which
    // should close this — the anchor moved out from under it. But it equally sees this
    // panel's own scrolling body, and with 200 models the theme list genuinely overflows.
    // Closing there made the menu un-scrollable: the first wheel tick closed it before
    // the browser had moved `scrollTop`. Same fix as ColorTargetPicker.
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

  // Flattened so arrow keys move through every checkbox in the panel regardless of
  // which section it's in, the same way a native <select multiple> would. Each section's
  // options carry their global index precomputed here rather than via a counter mutated
  // during render.
  const indexedSections = useMemo(() => {
    let next = 0;
    return sections.map((section) => ({
      section,
      items: section.options.map((option) => ({ option, index: next++ })),
    }));
  }, [sections]);
  const flatCount = useMemo(() => sections.reduce((n, s) => n + s.options.length, 0), [sections]);

  function onItemKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const item = panelRef.current?.querySelector<HTMLElement>(
        `[data-menu-index="${(index + 1) % flatCount}"]`,
      );
      item?.focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      const item = panelRef.current?.querySelector<HTMLElement>(
        `[data-menu-index="${(index - 1 + flatCount) % flatCount}"]`,
      );
      item?.focus();
    }
  }

  const label =
    activeCount === 0
      ? `Filter ${subject}`
      : `Filter ${subject}: ${activeCount} active`;
  const tip = useTooltip({ id: 'filter-menu', label });

  return (
    <div className="by-menu">
      <button
        type="button"
        ref={(node) => {
          triggerRef.current = node;
          tip.ref(node);
        }}
        className={`by-icon-btn${activeCount > 0 ? ' is-active' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={() => (open ? close() : setOpen(true))}
        onMouseEnter={tip.onMouseEnter}
        onMouseLeave={tip.onMouseLeave}
        onFocus={tip.onFocus}
        onBlur={tip.onBlur}
        aria-describedby={tip['aria-describedby']}
      >
        <FilterIcon />
        {activeCount > 0 && (
          <span className="by-icon-btn__badge" aria-hidden="true">
            {activeCount}
          </span>
        )}
      </button>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            className="by-menu__panel"
            role="menu"
            aria-label={`Filter ${subject}`}
            style={{ top: position?.top ?? 0, left: position?.left ?? 0 }}
          >
            {indexedSections.map(({ section, items }, sectionIndex) => (
              <div className="by-menu__section" key={section.key}>
                {sectionIndex > 0 && <div className="by-menu__divider" />}
                <div className="by-eyebrow by-menu__section-label">{section.label}</div>
                {items.map(({ option, index }) => {
                  const isActive = section.selected.has(option);
                  return (
                    <button
                      key={option}
                      type="button"
                      role="menuitemcheckbox"
                      aria-checked={isActive}
                      data-menu-index={index}
                      className={`by-menu__item by-menu__item--check${isActive ? ' is-active' : ''}`}
                      onClick={() => section.onToggle(option)}
                      onKeyDown={(event) => onItemKeyDown(event, index)}
                    >
                      <span className="by-menu__item-check">{isActive && <CheckIcon />}</span>
                      {option}
                    </button>
                  );
                })}
              </div>
            ))}
            {activeCount > 0 && (
              <div className="by-menu__footer">
                <button type="button" className="by-menu__clear" onClick={onClearAll}>
                  Clear all
                </button>
              </div>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
