/**
 * `localStorage` autosave — a convenience so a refresh doesn't lose work, not the save
 * system. It is not versioned against the user's intent the way a real save is: it's
 * silently overwritten on every change and silently read back once, on mount.
 *
 * Uses the same JSON the real save system writes (`src/model/serialize.ts`), so restoring
 * an autosave and opening a saved file are the same code path.
 *
 * Not unit-tested: it's a thin wrapper over `localStorage`, which vitest's `node`
 * environment doesn't provide (see `vite.config.ts`); exercised in-browser instead. Every
 * call is wrapped, because private browsing / a full quota / a disabled store all throw
 * rather than no-op in some browsers, and losing autosave is fine — losing the session to
 * an uncaught exception is not.
 */

const KEY = 'brickyard:autosave:v1';

export function readAutosave(): string | undefined {
  try {
    return localStorage.getItem(KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function writeAutosave(json: string): void {
  try {
    localStorage.setItem(KEY, json);
  } catch {
    // Quota exceeded or storage disabled — the document itself is unaffected.
  }
}

export function clearAutosave(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to clean up if the store never accepted a write.
  }
}
