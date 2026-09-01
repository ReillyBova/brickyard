/**
 * One row's "pick a replacement" control. Opens the real `ColorPicker` — the same
 * component the app's own color rail uses, built on the real LDraw palette — in a
 * portal popover, so restyle doesn't grow a second color-swatch implementation.
 *
 * Positioning follows `PartsChest/CategoryMenu.tsx`'s pattern: portaled into
 * `document.body` so an ancestor's `overflow-y: auto` (the restyle panel's own body)
 * can't clip it, `position: fixed` with JS-measured coordinates, flipped above the
 * trigger when it would overflow the bottom of the viewport.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { ColorPicker } from '../../ui/ColorPicker/ColorPicker';
import type { Swatch } from '../../ui/ColorPicker/types';
import './Restyle.css';

interface ColorTargetPickerProps {
  palette: readonly Swatch[];
  value: number;
  onSelect: (code: number) => void;
  /** Accessible name for the trigger and the popover, e.g. "Replacement for Orange". */
  label: string;
}

const GAP = 6;
const VIEWPORT_MARGIN = 8;

export function ColorTargetPicker({ palette, value, onSelect, label }: ColorTargetPickerProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const current = palette.find((c) => c.code === value) ?? palette[0];

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
      triggerRect.bottom + GAP + panelRect.height > window.innerHeight - VIEWPORT_MARGIN;
    const top = openUpward
      ? triggerRect.top - GAP - panelRect.height
      : triggerRect.bottom + GAP;
    const maxLeft = window.innerWidth - panelRect.width - VIEWPORT_MARGIN;
    const left = Math.min(triggerRect.right - panelRect.width, Math.max(VIEWPORT_MARGIN, maxLeft));
    setPosition({ top, left });
  }, []);

  useLayoutEffect(() => {
    if (open) reposition();
  }, [open, reposition]);

  useEffect(() => {
    if (!open || position === null) return;

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
    // is what should close this — the anchor point moved. But it equally sees the
    // popover's own `.by-panel__body` (unlike CategoryMenu.tsx's flat list, `ColorPicker`
    // wraps an already-scrollable body), and scroll on that is the palette being used,
    // not the trigger moving out from under it — closing there made the palette
    // un-scrollable, since the very first wheel tick closed it before the browser had
    // moved `scrollTop`. Ignore scroll events that originate inside the panel itself.
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

  if (current === undefined) return null;

  return (
    <div className="by-restyle-target">
      <button
        type="button"
        ref={triggerRef}
        className="by-swatch by-restyle-target__trigger"
        style={{ backgroundColor: current.hex, borderColor: current.edgeHex }}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${label}: currently ${current.name}, LDraw color ${current.code}`}
        title={`${label}: ${current.name} · ${current.code}`}
        onClick={() => (open ? close() : setOpen(true))}
      />
      {open &&
        createPortal(
          <div
            ref={panelRef}
            className="by-restyle-target__panel"
            role="dialog"
            aria-label={label}
            style={{
              top: position?.top ?? 0,
              left: position?.left ?? 0,
              visibility: position === null ? 'hidden' : 'visible',
            }}
          >
            <ColorPicker
              colors={palette}
              selectedCode={value}
              onSelect={(code) => {
                onSelect(code);
                close();
              }}
            />
          </div>,
          document.body,
        )}
    </div>
  );
}
