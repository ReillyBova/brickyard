import { useEffect, useState, type RefObject } from 'react';

/**
 * True once `ref`'s element has intersected the viewport (with `ROOT_MARGIN` of
 * lookahead so a tile starts loading just before it's scrolled into frame), and stays
 * true afterward. There is nothing to gain from re-observing after the first hit —
 * `ThumbnailSource.get` caches by `(partId, colorHex)`, so scrolling a tile off-screen
 * and back is a free cache hit, not a re-render.
 *
 * One `IntersectionObserver` per tile, disconnected on first intersection. That's
 * hundreds of observers at full chest size, but each is cheap to construct and the
 * browser batches their callbacks off the main thread's layout pass — the alternative,
 * an unbounded eager render of every tile's thumbnail on mount, is the actual cost this
 * exists to avoid (see `usePartThumbnail`'s `enabled` flag and `docs/DESIGN.md`).
 */
const ROOT_MARGIN = '200px 0px';

export function useLazyVisible<T extends Element>(ref: RefObject<T | null>): boolean {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (visible) return;
    const el = ref.current;
    if (el === null) return;

    // No IntersectionObserver (old browser, or a non-DOM test environment): fail open
    // rather than never rendering a thumbnail at all.
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: ROOT_MARGIN },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, visible]);

  return visible;
}
