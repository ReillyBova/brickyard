/**
 * The wordmark's leave-and-lose-work guard. Shown when navigating home (or, by the same
 * logic, closing the tab — see `useBeforeUnload.ts`) while the document has commits since
 * the last save. `.by-dialog`/`.by-dialog-backdrop` per docs/DESIGN.md; words say what
 * will be lost and offer to save, per the same doc's "Words" section.
 */
import { useEffect, useRef } from 'react';

export interface UnsavedChangesDialogProps {
  onSaveAndLeave: () => void;
  onLeaveWithoutSaving: () => void;
  onCancel: () => void;
}

export function UnsavedChangesDialog({
  onSaveAndLeave,
  onLeaveWithoutSaving,
  onCancel,
}: UnsavedChangesDialogProps) {
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
        aria-labelledby="unsaved-changes-title"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="by-dialog__title" id="unsaved-changes-title">
          Leave without saving?
        </p>
        <p className="by-dialog__body">
          This model has changes that haven&rsquo;t been saved. Leaving now will lose them.
        </p>
        <div className="by-dialog__actions">
          <button type="button" className="by-btn by-btn--secondary" ref={cancelRef} onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="by-btn by-btn--danger" onClick={onLeaveWithoutSaving}>
            Leave without saving
          </button>
          <button type="button" className="by-btn by-btn--primary" onClick={onSaveAndLeave}>
            Save and leave
          </button>
        </div>
      </div>
    </div>
  );
}
