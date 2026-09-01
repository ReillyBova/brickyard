import type { ReactNode } from 'react';

import { Landing } from '../ui/Landing/Landing';
import { ModelPicker } from './ModelPicker';
import { useRoute } from './route-context';
import type { BundledModelEntry } from '../features/omr/types';

interface AppRouterProps {
  /** The sandbox editor, built by the composition root — this slice never imports
   * `src/scene/` or `src/model/` directly. */
  sandbox: ReactNode;
  /** Forwarded to `ModelPicker`: hands a chosen model up to the composition root. */
  onOpenModel: (entry: BundledModelEntry) => void;
}

/** Renders the current route. Mounted once inside a `RouteProvider`. */
export function AppRouter({ sandbox, onOpenModel }: AppRouterProps) {
  const { route } = useRoute();

  if (route === 'sandbox') return <>{sandbox}</>;
  if (route === 'models') return <ModelPicker onOpenModel={onOpenModel} />;
  return <Landing />;
}
