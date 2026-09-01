/**
 * Closing the tab loses unsaved work exactly as thoroughly as navigating to the landing
 * route does, so it gets the same guard via the standard `beforeunload` prompt. Browsers
 * ignore any custom string these days and show their own generic wording, but setting
 * `returnValue` is still what triggers the native "leave site?" dialog at all.
 */
import { useEffect } from 'react';

export function useBeforeUnload(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);
}
