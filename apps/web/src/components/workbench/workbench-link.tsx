import { cn } from '@salve/ui';
import { useRouteContext, useRouter } from '@tanstack/react-router';
import type { AnchorHTMLAttributes, MouseEvent, ReactNode } from 'react';
import type { SessionData } from '@/lib/session-loader';
import {
  makeTicketTabHref,
  resolveWorkbenchHref,
  selectActiveWorkspaceTab,
  type TabOpenSource,
  useWorkbenchStore,
  workspaceKey,
} from '@/lib/workbench';
import { navigateWorkbenchHref } from './navigation';

interface WorkbenchLinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  href: string;
  source?: TabOpenSource;
  children: ReactNode;
}

export function WorkbenchLink({
  href,
  source = 'left-rail',
  children,
  className,
  onClick,
  onAuxClick,
  ...props
}: WorkbenchLinkProps) {
  const router = useRouter();
  const { session } = useRouteContext({ from: '/app' }) as { session: SessionData };
  const workspaceID = workspaceKey(session.session.activeOrganizationId ?? null);
  const openOrReuseTab = useWorkbenchStore((state) => state.openOrReuseTab);
  const forkTab = useWorkbenchStore((state) => state.forkTab);

  function go(opts: { fork: boolean }) {
    const match = resolveWorkbenchHref(href);
    if (opts.fork) {
      const ticketID =
        source === 'ticket-row' && href.startsWith('/app/inbox/t/')
          ? (href.split('/').pop()?.split('?')[0] ?? '')
          : '';
      const forkHref = ticketID ? makeTicketTabHref(ticketID) : href;
      const tab = forkTab(workspaceID, forkHref, source);
      navigateWorkbenchHref(router, tab.href);
      return;
    }
    // If the active tab is a fork of the same routeId, stay on it — opening
    // a ticket from a forked inbox view should navigate inside the fork
    // rather than yanking the user back to the original inbox tab.
    const activeTab = selectActiveWorkspaceTab(workspaceID);
    const activeIsFork = activeTab?.tabKey?.includes(':fork:') ?? false;
    if (activeTab && activeIsFork && activeTab.routeId === match.route.id) {
      navigateWorkbenchHref(router, href);
      return;
    }
    const tab = openOrReuseTab(workspaceID, href, source);
    navigateWorkbenchHref(router, tab.href);
  }

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (event.defaultPrevented) return;
    if (event.button !== 0) return;
    event.preventDefault();
    go({ fork: event.metaKey || event.ctrlKey });
  }

  // Middle-click (scrollwheel button) → open in a new workbench tab. Browsers
  // dispatch `auxclick` for non-primary buttons; `click` does not fire for
  // them in modern engines. Without this handler, scrollwheel-clicks fall
  // through to the anchor's default `_self` navigation.
  function handleAuxClick(event: MouseEvent<HTMLAnchorElement>) {
    onAuxClick?.(event);
    if (event.defaultPrevented) return;
    if (event.button !== 1) return;
    event.preventDefault();
    go({ fork: true });
  }

  return (
    <a
      href={href}
      className={cn(className)}
      onClick={handleClick}
      onAuxClick={handleAuxClick}
      {...props}
    >
      {children}
    </a>
  );
}
