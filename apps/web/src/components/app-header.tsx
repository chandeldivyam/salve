// AppHeader — fixed top bar rendered once by `routes/app.tsx` and shared
// across every `/app/*` page. Mounts once for the session lifetime: sub-
// route navigation (inbox → settings → tags) does not remount it, so the
// email + workspace switcher never flicker.
//
// Reads the session synchronously from the `/app` route context (set by
// `beforeLoad`) and the org list synchronously from the module-level
// cache (also seeded by `beforeLoad`). No useState for either — those
// would re-run after every render and create the very flicker we're
// avoiding.

import { Button, Logo } from '@opendesk/ui';
import { Link, useLocation, useNavigate, useRouteContext } from '@tanstack/react-router';
import { Settings } from 'lucide-react';
import { useState } from 'react';
import { SetupEntry } from '@/components/setup-entry';
import { ThemeSwitcher } from '@/components/theme-switcher';
import { authClient, switchWorkspace } from '@/lib/auth-client';
import { showError } from '@/lib/feedback';
import { clearSessionCache, getCachedOrgs, type SessionData } from '@/lib/session-loader';

export function AppHeader() {
  const navigate = useNavigate();
  const location = useLocation();
  const { session } = useRouteContext({ from: '/app' }) as { session: SessionData };
  // Org list was pre-fetched in `/app` beforeLoad and cached at module
  // level; read it synchronously. Returns `[]` on the rare path where it
  // wasn't pre-fetched (e.g. someone added a route bypassing /app's
  // beforeLoad), which degrades gracefully to a single-option select.
  const orgs = getCachedOrgs();
  const [switchingWorkspace, setSwitchingWorkspace] = useState(false);

  async function onSwitch(workspaceID: string) {
    setSwitchingWorkspace(true);
    try {
      await switchWorkspace(workspaceID);
      window.location.reload();
    } catch (err) {
      setSwitchingWorkspace(false);
      showError(err, 'Could not switch workspace.');
    }
  }

  async function onSignOut() {
    try {
      await authClient.signOut();
      clearSessionCache();
      await navigate({ to: '/auth/sign-in' });
    } catch (err) {
      showError(err, 'Could not sign out.');
    }
  }

  const activeID = session?.session.activeOrganizationId ?? null;

  return (
    <header className="flex min-h-14 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border bg-surface px-3 py-2 sm:flex-nowrap sm:px-5">
      <div className="flex min-w-0 flex-1 items-center gap-3 sm:gap-4">
        {/* Click-the-logo-to-go-home is a universal product convention.
            Routes to the inbox (the actual "home" of the app); using
            <Link> means cmd-click opens in a new tab and the active
            tab styling stays consistent with every other nav target. */}
        <Link
          to="/app/inbox"
          aria-label="Salve home"
          className="rounded-md outline-none transition-colors hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          <Logo withWordmark size={20} />
        </Link>
        <span className="hidden h-5 w-px bg-border sm:block" />
        <select
          aria-label="Active workspace"
          className="min-w-0 max-w-[56vw] rounded-md border border-border bg-surface px-2 py-1 text-sm text-surface-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:max-w-none"
          value={activeID ?? ''}
          disabled={switchingWorkspace}
          onChange={(e) => {
            const v = e.target.value;
            if (v === '__new__') {
              navigate({ to: '/app/workspaces/new' });
              return;
            }
            if (v) onSwitch(v);
          }}
        >
          <option value="" disabled>
            {orgs.length === 0 ? 'No workspace yet' : 'Choose workspace'}
          </option>
          {orgs.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
          <option value="__new__">＋ Create new workspace…</option>
        </select>
      </div>
      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
        <SetupEntry activeWorkspaceID={activeID} pathname={location.pathname} />
        <Link
          to="/app/settings/channels/email"
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-surface-muted hover:text-foreground"
          title="Settings"
        >
          <Settings className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Settings</span>
        </Link>
        <ThemeSwitcher />
        <span className="hidden text-xs text-muted-foreground md:inline">
          {session?.user.email}
        </span>
        <Button variant="outline" size="sm" onClick={onSignOut}>
          Sign out
        </Button>
      </div>
    </header>
  );
}
