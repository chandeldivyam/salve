// /app/settings — sidebar layout for workspace settings. Phase 3a ships the
// canonical Email Channel screen; legacy `/settings/email/domains` routes stay
// mounted so older links keep working.
//
// File-based routing: this is the parent of `settings.channels.email` and the
// older `settings.email.domains` route family.

import {
  createFileRoute,
  Link,
  Outlet,
  useLocation,
  useRouteContext,
} from '@tanstack/react-router';
import { ListChecks, Mail } from 'lucide-react';
import type { ReactNode } from 'react';
import { AppHeader } from '@/components/app-header';
import type { SessionData } from '@/lib/session-loader';
import { useSetupProgress } from '@/lib/setup-progress';

export const Route = createFileRoute('/app/settings')({
  component: SettingsLayout,
});

function SettingsLayout() {
  const location = useLocation();
  const { session } = useRouteContext({ from: '/app' }) as { session: SessionData };
  const workspaceID = session.session.activeOrganizationId ?? null;
  const progress = useSetupProgress(workspaceID);

  const isEmailChannel =
    location.pathname.startsWith('/app/settings/channels/email') ||
    location.pathname.startsWith('/app/settings/email/domains');
  const isSetup = location.pathname.startsWith('/app/settings/setup');

  // Hide the Setup item only when the user finished and dismissed it.
  const showSetup = !(progress.dismissed && progress.isComplete);

  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader />
      <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
        <aside className="flex shrink-0 flex-col gap-1 border-b border-border bg-surface px-3 py-4 sm:w-[240px] sm:border-r sm:border-b-0 sm:py-5">
          <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground sm:pb-2">
            Settings
          </p>
          {showSetup ? (
            <SettingsLink to="/app/settings/setup" active={isSetup}>
              <ListChecks className="h-3.5 w-3.5" />
              <span className="flex-1">Setup</span>
              {progress.ready && !progress.isComplete ? (
                <span className="rounded-full bg-brand-soft px-1.5 py-0.5 text-[10px] font-semibold text-brand-soft-foreground ring-1 ring-brand-border">
                  {progress.completedCount}/{progress.total}
                </span>
              ) : null}
            </SettingsLink>
          ) : null}
          <SettingsLink to="/app/settings/channels/email" active={isEmailChannel}>
            <Mail className="h-3.5 w-3.5" />
            <span className="flex-1">Email channel</span>
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
  children: ReactNode;
}) {
  return (
    <Link
      to={to}
      className={
        active
          ? 'flex items-center gap-2 rounded-md bg-brand-soft px-2 py-1.5 text-sm font-medium text-brand-soft-foreground ring-1 ring-brand-border'
          : 'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-surface-muted hover:text-foreground'
      }
    >
      {children}
    </Link>
  );
}
