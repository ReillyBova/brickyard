import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { ChevronDownIcon } from '../../ui/icons';

import { ENVIRONMENTS } from './environments.ts';
import type { PathtraceEnvironment } from './environments.ts';

interface EnvironmentMenuProps {
  value: PathtraceEnvironment;
  onChange: (environment: PathtraceEnvironment) => void;
}

interface MenuPosition {
  top: number;
  left: number;
}

/** Matches `CategoryMenu`'s own constants — see that component for why these are fixed-position
 *  viewport-px values a CSS var can't reach into JS. */
const MENU_GAP = 4;
const VIEWPORT_MARGIN = 8;

/**
 * The environment picker, as a labelled dropdown rather than `CategoryMenu`'s icon-only trigger
 * — seven options is past what `.by-seg` (docs/DESIGN.md: "two to four options only; past four
 * it is a select") comfortably wraps to, and unlike a category filter this control's current
 * value is the primary thing on screen, not a secondary filter state, so the trigger always
 * shows the active environment's label rather than hiding it behind an icon.
 *
 * Otherwise the same shape as `CategoryMenu`: portaled into `document.body` so `.by-panel__body`'s
 * `overflow-y: auto` can't clip it, positioned from the trigger's `getBoundingClientRect()`,
 * flipped above the trigger when it would overflow the viewport bottom. See that component's
 * doc comment for the full reasoning; not repeated here.
 *
 * Each item shows its description under the label, always visible rather than tooltip-only —
 * "say what each is for" matters most exactly when the list is open and every option is being
 * compared at once, not one at a time on hover.
 */
export function EnvironmentMenu({ value, onChange }: EnvironmentMenuProps) {
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
    // Full trigger width, not the panel's natural width — a labelled dropdown reads as one
    // control whose panel lines up with its own edges, unlike a narrow icon-triggered menu.
    const width = triggerRect.width;
    const maxLeft = window.innerWidth - width - VIEWPORT_MARGIN;
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
    document.addEventListener('scroll', close, true);
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', reposition);
    return () => {
      document.removeEventListener('scroll', close, true);
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', reposition);
    };
  }, [open, position, close, reposition]);

  function choose(environment: PathtraceEnvironment) {
    onChange(environment);
    close();
  }

  function onItemKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const item = panelRef.current?.querySelector<HTMLElement>(
        `[data-menu-index="${(index + 1) % ENVIRONMENTS.length}"]`,
      );
      item?.focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      const item = panelRef.current?.querySelector<HTMLElement>(
        `[data-menu-index="${(index - 1 + ENVIRONMENTS.length) % ENVIRONMENTS.length}"]`,
      );
      item?.focus();
    }
  }

  return (
    <div className="by-menu by-env-menu">
      <button
        type="button"
        ref={triggerRef}
        className="by-env-menu__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Environment: ${value.label}`}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <span className="by-env-menu__trigger-label">{value.label}</span>
        <ChevronDownIcon className="by-env-menu__trigger-chevron" />
      </button>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            className="by-menu__panel by-env-menu__panel"
            role="menu"
            aria-label="Environment"
            style={{ top: position?.top ?? 0, left: position?.left ?? 0 }}
          >
            {ENVIRONMENTS.map((environment, index) => {
              const isActive = environment.id === value.id;
              return (
                <button
                  key={environment.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={isActive}
                  data-menu-index={index}
                  className={`by-menu__item by-env-menu__item${isActive ? ' is-active' : ''}`}
                  onClick={() => choose(environment)}
                  onKeyDown={(event) => onItemKeyDown(event, index)}
                >
                  <span className="by-env-menu__item-label">{environment.label}</span>
                  <span className="by-env-menu__item-desc">{environment.description}</span>
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </div>
  );
}
