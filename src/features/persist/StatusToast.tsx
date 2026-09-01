/**
 * Renders `useFileActions`'s `status` as a `.by-toast` — save/open/export/import all
 * happen away from where the user's eyes are (the toolbar, or a native file dialog), so
 * this is where they find out it worked or didn't. Busy states render through the
 * existing `by-model-load-overlay` progress bar in `App.tsx` instead, since that's
 * already the "something is loading" surface a bundled model import uses.
 */
import { useEffect } from 'react';

import { XIcon } from '../../ui/icons';
import type { FileStatus } from './useFileActions.tsx';

const AUTO_DISMISS_MS = 4000;

export function StatusToast({ status, onDismiss }: { status: FileStatus; onDismiss: () => void }) {
  const message = status.kind === 'info' || status.kind === 'error' ? status.message : undefined;

  useEffect(() => {
    if (message === undefined) return;
    const timer = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
    // Re-arms only when the message itself changes, not on every `onDismiss` identity.
  }, [message]);

  if (message === undefined) return null;

  return (
    <div className={`by-toast${status.kind === 'error' ? ' by-toast--error' : ''}`} role="status">
      <span>{message}</span>
      <button type="button" className="by-icon-btn" aria-label="Dismiss" onClick={onDismiss}>
        <XIcon />
      </button>
    </div>
  );
}
