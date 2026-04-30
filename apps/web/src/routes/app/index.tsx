import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Logo,
} from '@opendesk/ui';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { authClient, switchWorkspace } from '@/lib/auth-client';
import { fetchSession, listOrganizations, type SessionData } from '@/lib/session-loader';

export const Route = createFileRoute('/app/')({
  component: AppHome,
});

interface Org {
  id: string;
  name: string;
  slug: string;
}

function AppHome() {
  const navigate = useNavigate();
  const [session, setSession] = useState<SessionData | null>(null);
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [s, o] = await Promise.all([fetchSession(), listOrganizations()]);
      if (cancelled) return;
      setSession(s);
      setOrgs(o);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSwitch(workspaceID: string) {
    await switchWorkspace(workspaceID);
    // Hard reload so every cached query observes the new claims.
    window.location.reload();
  }

  async function onSignOut() {
    await authClient.signOut();
    await navigate({ to: '/auth/sign-in' });
  }

  if (loading) {
    return <div className="p-8 text-sm text-slate-500">Loading…</div>;
  }

  const activeID = session?.session.activeOrganizationId ?? null;
  const active = orgs.find((o) => o.id === activeID) ?? null;

  return (
    <div className="min-h-dvh bg-slate-50">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
        <div className="flex items-center gap-4">
          <Logo withWordmark size={20} />
          <WorkspaceSwitcher
            activeID={activeID}
            orgs={orgs}
            onSwitch={onSwitch}
            onCreate={() => navigate({ to: '/app/workspaces/new' })}
          />
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-500">{session?.user.email}</span>
          <Button variant="outline" size="sm" onClick={onSignOut}>
            Sign out
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-3xl p-8">
        <Card>
          <CardHeader>
            <CardTitle>Phase 1 — auth + workspace bootstrap</CardTitle>
            <CardDescription>
              You're signed in. Phase 2 lights up the inbox, tickets, and Zero sync.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <Row label="User ID" value={session?.user.id ?? '-'} mono />
            <Row
              label="Active workspace"
              value={active ? `${active.name} (${active.slug})` : '— none —'}
            />
            <Row
              label="Workspaces"
              value={orgs.length === 0 ? '0 (create one)' : String(orgs.length)}
            />
            {orgs.length === 0 ? (
              <Link
                className="text-sm font-medium text-slate-900 underline"
                to="/app/workspaces/new"
              >
                Create your first workspace →
              </Link>
            ) : null}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[10rem_1fr] gap-3">
      <dt className="text-slate-500">{label}</dt>
      <dd className={mono ? 'font-mono text-xs' : ''}>{value}</dd>
    </div>
  );
}

function WorkspaceSwitcher({
  activeID,
  orgs,
  onSwitch,
  onCreate,
}: {
  activeID: string | null;
  orgs: Org[];
  onSwitch: (id: string) => void;
  onCreate: () => void;
}) {
  return (
    <div className="relative">
      <select
        className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
        value={activeID ?? ''}
        onChange={(e) => {
          const v = e.target.value;
          if (v === '__new__') {
            onCreate();
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
  );
}
