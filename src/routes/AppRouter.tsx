import type { ReactNode } from 'react';

import { Landing } from '../ui/Landing/Landing';
import { ModelPicker } from './ModelPicker';
import { useRoute } from './route-context';

interface AppRouterProps {
  /** The sandbox editor, built by the composition root — this slice never imports
   * `src/scene/` or `src/model/` directly. */
  sandbox: ReactNode;
}

/** Renders the current route. Mounted once inside a `RouteProvider`. */
export function AppRouter({ sandbox }: AppRouterProps) {
  const { route } = useRoute();

  if (route === 'sandbox') return <>{sandbox}</>;
  if (route === 'models') return <ModelPicker />;
  return <Landing />;
}
