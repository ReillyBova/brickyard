/**
 * Route types, path resolution and the `useRoute` hook — split out of `router.tsx` so
 * that file exports only the `RouteProvider` component (oxlint's `only-export-
 * components` flags a file that mixes component and non-component exports, since it
 * breaks Fast Refresh).
 */
import { createContext, useContext } from 'react';

export type RouteName = 'landing' | 'sandbox' | 'models';

const BASE = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;

const ROUTE_SEGMENT: Record<Exclude<RouteName, 'landing'>, string> = {
  sandbox: 'sandbox',
  models: 'models',
};

export function pathToRoute(pathname: string): RouteName {
  const rest = pathname.startsWith(BASE) ? pathname.slice(BASE.length) : pathname.replace(/^\/+/, '');
  const segment = rest.split('/')[0];
  if (segment === ROUTE_SEGMENT.sandbox) return 'sandbox';
  if (segment === ROUTE_SEGMENT.models) return 'models';
  return 'landing';
}

export function routeToPath(route: RouteName): string {
  return route === 'landing' ? BASE : `${BASE}${ROUTE_SEGMENT[route]}`;
}

/** The full href for a route, base path included — for `<Link>` and any bare `<a>`. */
export function routeHref(route: RouteName): string {
  return routeToPath(route);
}

export interface RouteContextValue {
  route: RouteName;
  navigate: (route: RouteName) => void;
}

export const RouteContext = createContext<RouteContextValue | undefined>(undefined);

export function useRoute(): RouteContextValue {
  const context = useContext(RouteContext);
  if (context === undefined) throw new Error('useRoute must be used within a RouteProvider');
  return context;
}
