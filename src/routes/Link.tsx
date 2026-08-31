/**
 * A real `<a>` bound to the hand-rolled router: keyboard-focusable and operable like
 * any link, middle-click/`⌘`-click still open a new tab (we only intercept a plain
 * left click), and the href is always correct for deep-linking even before JS takes
 * over navigation.
 */
import type { AnchorHTMLAttributes, MouseEvent } from 'react';

import { routeHref, useRoute, type RouteName } from './route-context';

interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  to: RouteName;
}

export function Link({ to, onClick, ...rest }: LinkProps) {
  const { navigate } = useRoute();

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented) return;
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(to);
  };

  return <a href={routeHref(to)} onClick={handleClick} {...rest} />;
}
