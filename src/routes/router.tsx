/**
 * A ~20-line router, hand-rolled per docs/AGENTS.md: three routes don't earn a
 * dependency. History API for back/forward and deep links, a context for the current
 * route and `navigate`, and `<Link>` (`./Link.tsx`) for keyboard-accessible in-app
 * navigation. Route resolution lives in `./route-context.ts`.
 *
 * The app deploys to GitHub Pages under a base path (`vite.config.ts` sets
 * `GITHUB_PAGES=true` → `/brickyard/`); `import.meta.env.BASE_URL` carries that value
 * at both build time and dev time, so paths are always resolved relative to it. GitHub
 * Pages itself has no server-side routing, so a hard reload on a deep route relies on
 * `public/404.html` and the inline script in `index.html` to restore the real URL
 * before this ever reads `location.pathname`.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { pathToRoute, routeToPath, RouteContext, type RouteName } from './route-context';

/** Mounted once, at the top of the app. Owns the current route and the History API. */
export function RouteProvider({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState<RouteName>(() => pathToRoute(window.location.pathname));

  useEffect(() => {
    const onPopState = () => setRoute(pathToRoute(window.location.pathname));
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = useCallback((next: RouteName) => {
    const path = routeToPath(next);
    if (window.location.pathname !== path) {
      window.history.pushState(null, '', path);
    }
    setRoute(next);
  }, []);

  return <RouteContext.Provider value={{ route, navigate }}>{children}</RouteContext.Provider>;
}
