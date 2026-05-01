import { cn } from '@opendesk/ui';
import { useRouteContext, useRouter } from '@tanstack/react-router';
import type { AnchorHTMLAttributes, MouseEvent, ReactNode } from 'react';
import type { SessionData } from '@/lib/session-loader';
import {
  makeTicketTabHref,
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
  ...props
}: WorkbenchLinkProps) {
  const router = useRouter();
  const { session } = useRouteContext({ from: '/app' }) as { session: SessionData };
  const workspaceID = workspaceKey(session.session.activeOrganizationId ?? null);
  const openOrReuseTab = useWorkbenchStore((state) => state.openOrReuseTab);
  const forkTab = useWorkbenchStore((state) => state.forkTab);

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (event.defaultPrevented) return;
    if (event.button !== 0) return;

    event.preventDefault();
    const forkHref =
      source === 'ticket-row' && href.startsWith('/app/inbox/t/')
        ? makeTicketTabHref(href.split('/').pop()?.split('?')[0] ?? '')
        : href;
    const tab =
      event.metaKey || event.ctrlKey
        ? forkTab(workspaceID, forkHref, source)
        : openOrReuseTab(workspaceID, href, source);
    navigateWorkbenchHref(router, tab.href);
  }

  return (
    <a href={href} className={cn(className)} onClick={handleClick} {...props}>
      {children}
    </a>
  );
}
