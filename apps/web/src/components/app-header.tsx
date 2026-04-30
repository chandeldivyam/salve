// AppHeader — fixed top bar shared across all `/app/*` pages. Renders the
// brand wordmark, a workspace switcher and the signed-in user's email + sign
// out button. Phase 2b's `/app/index.tsx` had this baked in inline; Phase 2c
// promotes it to a reusable component because the inbox layout needs the
// same header above its two-pane layout.

import { Button, Logo } from '@opendesk/ui';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { authClient, switchWorkspace } from '@/lib/auth-client';
import { fetchSession, listOrganizations, type SessionData } from '@/lib/session-loader';

interface Org {
  id: string;
  name: string;
  slug: string;
}

export function AppHeader() {
  const navigate = useNavigate();
  const [session, setSession] = useState<SessionData | null>(null);
  const [orgs, setOrgs] = useState<Org[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [s, o] = await Promise.all([fetchSession(), listOrganizations()]);
      if (cancelled) return;
      setSession(s);
      setOrgs(o);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSwitch(workspaceID: string) {
    await switchWorkspace(workspaceID);
    window.location.reload();
  }

  async function onSignOut() {
    await authClient.signOut();
    await navigate({ to: '/auth/sign-in' });
  }

  const activeID = session?.session.activeOrganizationId ?? null;

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-5">
      <div className="flex items-center gap-4">
        <Logo withWordmark size={20} />
        <span className="h-5 w-px bg-slate-200" />
        <select
          aria-label="Active workspace"
          className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          value={activeID ?? ''}
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
      <div className="flex items-center gap-3">
        <span className="text-xs text-slate-500">{session?.user.email}</span>
        <Button variant="outline" size="sm" onClick={onSignOut}>
          Sign out
        </Button>
      </div>
    </header>
  );
}
