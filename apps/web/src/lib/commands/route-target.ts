import { useEffect } from 'react';
import type { Target } from './registry';
import { useCommandRegistry } from './registry';

export function useRouteTarget(pathname: string): void {
  useEffect(() => {
    useCommandRegistry.getState().setUrlTarget({
      pathname,
      target: targetFromPathname(pathname),
    });
  }, [pathname]);
}

function targetFromPathname(pathname: string): Target {
  const ticket = /^\/app\/inbox\/t\/([^/]+)\/?$/.exec(pathname)?.[1];
  if (ticket) {
    const id = decodeURIComponent(ticket);
    return { kind: 'ticket', id, label: `Ticket ${id}` };
  }

  const customer = /^\/app\/customers\/([^/]+)\/?$/.exec(pathname)?.[1];
  if (customer) {
    const id = decodeURIComponent(customer);
    return { kind: 'customer', id, label: 'Customer' };
  }

  return { kind: 'none' };
}
