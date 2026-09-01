/**
 * Confirmation for emptying the baseplate. Clearing is undoable — it commits one
 * transaction like any other edit — but it removes everything at once, which is
 * destructive enough to be worth a deliberate second step.
 */

import { useEffect, useRef } from 'react';

export interface ClearSceneDialogProps {
  /** How many bricks will go, so the dialog can say what is actually at stake. */
  brickCount: number;
  onClear: () => void;
  onCancel: () => void;
}

export function ClearSceneDialog({ brickCount, onClear, onCancel }: ClearSceneDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  return (
    <div className="by-dialog-backdrop" onClick={onCancel}>
      <div
        className="by-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="clear-scene-title"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="by-dialog__title" id="clear-scene-title">
          Clear the baseplate?
        </p>
        <p className="by-dialog__body">
          This removes {brickCount.toLocaleString()} brick{brickCount === 1 ? '' : 's'}, including any
          loaded models. You can undo it.
        </p>
        <div className="by-dialog__actions">
          <button type="button" className="by-btn by-btn--secondary" ref={cancelRef} onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="by-btn by-btn--danger" onClick={onClear}>
            Clear everything
          </button>
        </div>
      </div>
    </div>
  );
}
