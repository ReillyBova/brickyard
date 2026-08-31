import { useEffect, useRef, useState } from 'react';

import { FilterIcon } from '../icons';

interface CategoryMenuProps {
  categories: readonly string[];
  /** `undefined` means no filter applied ("All categories"). */
  value: string | undefined;
  onChange: (category: string | undefined) => void;
  /** Label for the "no filter" entry, shown first in the list. */
  allLabel: string;
}

/**
 * An icon-triggered popover list — the new `.by-menu` variant in `components.css`. Past
 * four options `.by-seg` doesn't fit and a bare `<select>` carries browser chrome the
 * rest of the system doesn't, so this is the documented gap: an icon button (`list-filter`,
 * already in docs/DESIGN.md's icon set) opens a floating list styled like the app's other
 * popovers.
 *
 * The trigger's accessible name states the current filter — never just the tooltip — and
 * turns `.is-active` (the same treatment other toggled icon buttons use) whenever a
 * category is applied, so the filter's state is visible with the menu closed. Escape and
 * an outside click both close it and return focus to the trigger; arrow keys walk the list.
 */
export function CategoryMenu({ categories, value, onChange, allLabel }: CategoryMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  function choose(next: string | undefined) {
    onChange(next);
    setOpen(false);
    triggerRef.current?.focus();
  }

  function onItemKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number, count: number) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const item = rootRef.current?.querySelector<HTMLElement>(`[data-menu-index="${(index + 1) % count}"]`);
      item?.focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      const item = rootRef.current?.querySelector<HTMLElement>(
        `[data-menu-index="${(index - 1 + count) % count}"]`,
      );
      item?.focus();
    }
  }

  const current = value ?? allLabel;
  const options = [allLabel, ...categories];

  return (
    <div className="by-menu" ref={rootRef}>
      <button
        type="button"
        ref={triggerRef}
        className={`by-icon-btn${value !== undefined ? ' is-active' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Filter by category: ${current}`}
        title="Filter by category"
        onClick={() => setOpen((o) => !o)}
      >
        <FilterIcon />
      </button>
      {open && (
        <div className="by-menu__panel" role="menu" aria-label="Filter by category">
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
        </div>
      )}
    </div>
  );
}
