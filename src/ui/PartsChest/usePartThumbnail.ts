import { useEffect, useState } from 'react';

import type { ThumbnailSource } from '../../scene/thumbnail';

interface ThumbnailState {
  /** A data URL once rendered; `undefined` while loading, missing, or on error. */
  url: string | undefined;
  status: 'idle' | 'loading' | 'ready' | 'error';
}

const IDLE: ThumbnailState = { url: undefined, status: 'idle' };
const LOADING: ThumbnailState = { url: undefined, status: 'loading' };

interface Resolved {
  key: string;
  url: string | undefined;
  status: 'ready' | 'error';
}

/**
 * Resolves one tile's thumbnail through `source` (a `RuntimeThumbnailRenderer` in the
 * running app; `undefined` in Storybook and tests, where `PartsChest` falls back to the
 * `AxonBrick` pictogram instead of standing up a WebGL context per story). `source`
 * itself caches per `(partId, colorHex)`, so switching the active color and back is free
 * — this hook only tracks the async status of that lookup for one tile.
 *
 * "Loading" is derived during render by comparing the last *resolved* key against the
 * current one, rather than set by the effect the moment it starts — the effect only ever
 * calls `setState` once real work finishes, so a key change never causes the redundant
 * extra render an immediate "now loading" `setState` would.
 */
export function usePartThumbnail(
  source: ThumbnailSource | undefined,
  partId: string,
  colorHex: string,
): ThumbnailState {
  const key = `${partId}::${colorHex}`;
  const [resolved, setResolved] = useState<Resolved | null>(null);

  useEffect(() => {
    if (source === undefined) return;
    let cancelled = false;

    source.get(partId, colorHex).then(
      (url) => {
        if (!cancelled) setResolved({ key, url, status: 'ready' });
      },
      () => {
        if (!cancelled) setResolved({ key, url: undefined, status: 'error' });
      },
    );

    return () => {
      cancelled = true;
    };
  }, [source, partId, colorHex, key]);

  if (source === undefined) return IDLE;
  if (resolved === null || resolved.key !== key) return LOADING;
  return { url: resolved.url, status: resolved.status };
}
