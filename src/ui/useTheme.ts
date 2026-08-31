import { useCallback, useEffect, useState } from 'react';

/**
 * Theme is `data-theme` on `<html>`, per docs/DESIGN.md — never a media query alone,
 * never per component. `src/scene/theme.ts` watches that attribute with a
 * `MutationObserver` and re-reads the `--by-3d-*` / `--by-canvas-grid` tokens from
 * computed style, so setting the attribute here is enough to re-theme the 3D overlays
 * and the baseplate grid along with the chrome.
 */
export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'by-theme';

/**
 * Dark is the default — not `prefers-color-scheme` — because a cream viewport washes
 * out sand, tan and light grey parts, a large share of the corpus. `index.html` sets
 * `data-theme="dark"` statically so the first paint is never wrong; this only overrides
 * it once a stored preference is read.
 */
const DEFAULT_THEME: Theme = 'dark';

function isTheme(value: string | null): value is Theme {
  return value === 'light' || value === 'dark';
}

/** Reads the stored preference. Private browsing and blocked site data both throw. */
function readStoredTheme(): Theme | undefined {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isTheme(stored) ? stored : undefined;
  } catch {
    return undefined;
  }
}

function writeStoredTheme(theme: Theme): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Private browsing / blocked site data — the app still renders with the in-memory
    // theme, it just won't be remembered next load.
  }
}

/**
 * Owns the current theme, persists it, and applies it to `<html data-theme>`. Reads the
 * stored preference on mount (falling back to dark, never to `prefers-color-scheme`)
 * and keeps the DOM attribute in sync with every change.
 */
export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => readStoredTheme() ?? DEFAULT_THEME);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme((current) => {
      const next: Theme = current === 'dark' ? 'light' : 'dark';
      writeStoredTheme(next);
      return next;
    });
  }, []);

  return [theme, toggle];
}
