// Tab strip for /app/settings/channels/email/*. Each tab is a TanStack
// Router <Link> with `activeProps` to apply the selected styling. The
// Domains tab matches both the list page and a domain-detail child route
// (so the tab stays selected when drilling into DNS records).

import { cn } from '@opendesk/ui';
import { Link, useLocation } from '@tanstack/react-router';
import {
  Inbox,
  LayoutDashboard,
  type LucideIcon,
  Mail,
  Route as RouteIcon,
  ShieldOff,
} from 'lucide-react';
import { useEffect, useRef } from 'react';

interface TabDef {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Match function for active state — covers nested child routes. */
  match: (pathname: string) => boolean;
}

const TABS: TabDef[] = [
  {
    to: '/app/settings/channels/email',
    label: 'Overview',
    icon: LayoutDashboard,
    match: (p) => p === '/app/settings/channels/email' || p === '/app/settings/channels/email/',
  },
  {
    to: '/app/settings/channels/email/domains',
    label: 'Domains',
    icon: Mail,
    match: (p) => p.startsWith('/app/settings/channels/email/domains'),
  },
  {
    to: '/app/settings/channels/email/addresses',
    label: 'Addresses',
    icon: Inbox,
    match: (p) => p.startsWith('/app/settings/channels/email/addresses'),
  },
  {
    to: '/app/settings/channels/email/routing',
    label: 'Routing',
    icon: RouteIcon,
    match: (p) => p.startsWith('/app/settings/channels/email/routing'),
  },
  {
    to: '/app/settings/channels/email/suppressions',
    label: 'Suppressions',
    icon: ShieldOff,
    match: (p) => p.startsWith('/app/settings/channels/email/suppressions'),
  },
];

export function EmailChannelTabs() {
  const location = useLocation();
  const pathname = location.pathname;
  const activeRef = useRef<HTMLLIElement | null>(null);

  // Keep the active tab visible on narrow viewports — the strip scrolls
  // horizontally (no wrap), so navigating to a tab that's currently
  // off-screen should auto-center it. The `pathname` reference inside the
  // effect both keys the effect (so it re-runs on every navigation) and
  // satisfies biome's exhaustive-deps; the value itself is unused at
  // runtime since `activeRef` already points to the new active <li>.
  useEffect(() => {
    void pathname;
    activeRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'center',
    });
  }, [pathname]);

  return (
    <nav
      aria-label="Email channel sections"
      className="border-b border-border bg-surface px-3 sm:px-6"
    >
      <ul className="-mb-px flex flex-nowrap gap-1 overflow-x-auto">
        {TABS.map((tab) => {
          const active = tab.match(pathname);
          const Icon = tab.icon;
          return (
            <li key={tab.to} ref={active ? activeRef : undefined} className="shrink-0">
              <Link
                to={tab.to}
                className={cn(
                  'inline-flex h-10 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 text-xs font-medium transition-colors',
                  active
                    ? 'border-brand-600 text-foreground'
                    : 'border-transparent text-muted-foreground hover:border-border-strong hover:text-foreground',
                )}
                aria-current={active ? 'page' : undefined}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{tab.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
