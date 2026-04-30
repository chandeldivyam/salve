// /app/settings — sidebar layout for workspace settings. Phase 3a ships the
// canonical Email Channel screen; legacy `/settings/email/domains` routes stay
// mounted so older links keep working.
//
// File-based routing: this is the parent of `settings.channels.email` and the
// older `settings.email.domains` route family.

import { createFileRoute, Link, Outlet, useLocation } from '@tanstack/react-router';
import { AppHeader } from '@/components/app-header';

export const Route = createFileRoute('/app/settings')({
  component: SettingsLayout,
});

function SettingsLayout() {
  const location = useLocation();
  const isEmailChannel =
    location.pathname.startsWith('/app/settings/channels/email') ||
    location.pathname.startsWith('/app/settings/email/domains');

  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader />
      <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
        <aside className="flex shrink-0 flex-col gap-1 border-b border-border bg-surface px-3 py-4 sm:w-[240px] sm:border-r sm:border-b-0 sm:py-5">
          <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground sm:pb-2">
            Settings
          </p>
          <SettingsLink to="/app/settings/channels/email" active={isEmailChannel}>
            Email channel
          </SettingsLink>
        </aside>
        <main className="flex min-w-0 flex-1 flex-col bg-background">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function SettingsLink({
  to,
  active,
  children,
}: {
  to: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      className={
        active
          ? 'rounded-md bg-brand-soft px-2 py-1.5 text-sm font-medium text-brand-soft-foreground ring-1 ring-brand-border'
          : 'rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-surface-muted hover:text-foreground'
      }
    >
      {children}
    </Link>
  );
}
