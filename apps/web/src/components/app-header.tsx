// AppHeader — fixed top bar shared across all `/app/*` pages. Renders the
// brand wordmark, a workspace switcher and the signed-in user's email + sign
// out button. Phase 2b's `/app/index.tsx` had this baked in inline; Phase 2c
// promotes it to a reusable component because the inbox layout needs the
// same header above its two-pane layout.

import { Button, Logo } from '@opendesk/ui';
import { Link, useLocation, useNavigate } from '@tanstack/react-router';
import { Settings } from 'lucide-react';
import { useEffect, useState } from 'react';
import { SetupEntry } from '@/components/setup-entry';
import { ThemeSwitcher } from '@/components/theme-switcher';
import { authClient, switchWorkspace } from '@/lib/auth-client';
import { showError } from '@/lib/feedback';
import {
  clearSessionCache,
  fetchSession,
  listOrganizations,
  type SessionData,
} from '@/lib/session-loader';

interface Org {
  id: string;
  name: string;
  slug: string;
}

export function AppHeader() {
  const navigate = useNavigate();
  const location = useLocation();
  const [session, setSession] = useState<SessionData | null>(null);
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [switchingWorkspace, setSwitchingWorkspace] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [s, o] = await Promise.all([fetchSession(), listOrganizations()]);
        if (cancelled) return;
        setSession(s);
        setOrgs(o);
      } catch (err) {
        if (!cancelled) showError(err, 'Could not load workspace menu.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
        <Logo withWordmark size={20} />
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
