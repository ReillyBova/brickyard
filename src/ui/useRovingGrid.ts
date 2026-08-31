import { useCallback, useRef, type KeyboardEvent } from 'react';

/**
 * Roving-tabindex keyboard navigation for a flat list of items laid out as a wrapping
 * grid. One item is ever tab-stoppable at a time; arrow keys move focus and Home/End
 * jump to the ends. Shared by the parts chest and colour picker, whose grids differ
 * only in item count and column count.
 *
 * `columns` is measured live from the DOM (`data-col-probe`) rather than assumed, so it
 * stays correct across the responsive layout without a second source of truth.
 */
export function useRovingGrid(itemCount: number) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const focusIndex = useCallback((index: number) => {
    const container = containerRef.current;
    if (container === null) return;
    const clamped = Math.max(0, Math.min(itemCount - 1, index));
    const el = container.querySelector<HTMLElement>(`[data-index="${clamped}"]`);
    el?.focus();
  }, [itemCount]);

  const columnsAt = useCallback((): number => {
    const container = containerRef.current;
    if (container === null) return 1;
    const items = container.querySelectorAll<HTMLElement>('[data-index]');
    if (items.length < 2) return 1;
    const firstTop = items[0].offsetTop;
    let count = 1;
    for (let i = 1; i < items.length; i++) {
      if (items[i].offsetTop !== firstTop) break;
      count++;
    }
    return count;
  }, []);

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLElement>, currentIndex: number) => {
    const cols = columnsAt();
    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault();
        focusIndex(currentIndex + 1);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        focusIndex(currentIndex - 1);
        break;
      case 'ArrowDown':
        event.preventDefault();
        focusIndex(currentIndex + cols);
        break;
      case 'ArrowUp':
        event.preventDefault();
        focusIndex(currentIndex - cols);
        break;
      case 'Home':
        event.preventDefault();
        focusIndex(0);
        break;
      case 'End':
        event.preventDefault();
        focusIndex(itemCount - 1);
        break;
      default:
        break;
    }
  }, [columnsAt, focusIndex, itemCount]);

  return { containerRef, onKeyDown };
}
