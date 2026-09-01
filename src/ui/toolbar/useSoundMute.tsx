import { useState } from 'react';

import { SnapSound } from '../../scene/interaction/click.ts';
import { Volume2Icon, VolumeXIcon } from '../icons';
import type { ToolbarAction } from './types';

/**
 * The mute toggle. `SnapSound` (`src/scene/interaction/click.ts`) owns the actual muted
 * flag as a static, so it applies to every `SnapSound` instance — placement's and
 * `SceneRenderer`'s arrival clicks alike — without either call site needing to know
 * about a toggle. This hook only mirrors that flag into React state so the button
 * re-renders when it changes, and writes back through `SnapSound.setMuted` (which also
 * persists it) on click.
 */
export function useSoundMute(): ToolbarAction {
  const [muted, setMuted] = useState(() => SnapSound.muted);

  return {
    id: 'sound',
    icon: muted ? <VolumeXIcon /> : <Volume2Icon />,
    // A muted speaker reads as "off" on sight; a plain speaker needs no `.is-active`
    // highlight to read as "on", so `active` is left unset here — see ToolbarAction's
    // own doc: `active` is for state a filled icon alone can't carry.
    label: muted ? 'Unmute sound' : 'Mute sound',
    onClick: () => {
      const next = !muted;
      SnapSound.setMuted(next);
      setMuted(next);
    },
  };
}
