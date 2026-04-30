// /app/settings — sidebar layout for workspace settings. Phase 3a only ships
// the Email Domains screen; later phases add General, Team, Billing, etc.
//
// File-based routing: this is the parent of `settings.email.domains` and
// `settings.email.domains.$domainId`. The dot-notation in TanStack Router
// produces nested `/app/settings/email/domains/...` URLs.

import { createFileRoute, Link, Outlet, useLocation } from '@tanstack/react-router';
import { AppHeader } from '@/components/app-header';

export const Route = createFileRoute('/app/settings')({
  component: SettingsLayout,
});

function SettingsLayout() {
  const location = useLocation();
  const isEmailDomains = location.pathname.startsWith('/app/settings/email/domains');

  return (
    <div className="flex h-dvh flex-col">
      <AppHeader />
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[240px] shrink-0 flex-col gap-1 border-r border-slate-200 bg-white px-3 py-5">
          <p className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Settings
          </p>
          <SettingsLink to="/app/settings/email/domains" active={isEmailDomains}>
            Email domains
          </SettingsLink>
        </aside>
        <main className="flex min-w-0 flex-1 flex-col bg-slate-50">
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
          ? 'rounded-md bg-brand-50 px-2 py-1.5 text-sm font-medium text-brand-700 ring-1 ring-brand-100'
          : 'rounded-md px-2 py-1.5 text-sm text-slate-600 hover:bg-slate-50 hover:text-slate-900'
      }
    >
      {children}
    </Link>
  );
}
