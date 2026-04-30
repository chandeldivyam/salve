import { mutators } from '@opendesk/mutators';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Logo,
} from '@opendesk/ui';
import { queries } from '@opendesk/zero-schema';
import { useQuery } from '@rocicorp/zero/react';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { authClient, switchWorkspace } from '@/lib/auth-client';
import { fetchSession, listOrganizations, type SessionData } from '@/lib/session-loader';
import { useZero } from '@/lib/zero';

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
      <main className="mx-auto grid max-w-3xl gap-6 p-8">
        <Card>
          <CardHeader>
            <CardTitle>Phase 2a — Zero sync</CardTitle>
            <CardDescription>
              Reads through zero-cache-dev. Phase 2b adds the inbox UI + custom mutators on top of
              this.
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
            {activeID ? (
              <ZeroSyncPanel workspaceID={activeID} workspaceName={active?.name ?? activeID} />
            ) : null}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

/**
 * Phase 2b verification panel — uses the workspace-scoped `inboxOpen` custom
 * query to read tickets (no more raw `.where(...)`); writes via the
 * `ticket.create` custom mutator. Permissions live entirely in the mutator
 * assertions + `applyWorkspaceScope` (see `packages/zero-schema/src/queries.ts`,
 * `packages/mutators/src/auth.ts`).
 *
 * TEMP: removed in Phase 2c — replaced with the real inbox UI (TanStack Table
 * + Tiptap composer).
 */
function ZeroSyncPanel({ workspaceName }: { workspaceID: string; workspaceName: string }) {
  const z = useZero();
  // `inboxOpen` takes no args — the validator in queries.ts is `z.undefined()`.
  const [tickets, status] = useQuery(queries.inboxOpen());
  const ready = status?.type !== 'unknown';
  const recent = tickets.slice(0, 5);

  async function onCreateTestTicket() {
    // Drizzle declared `ticket.id` as a Postgres `uuid`, so the client-side id
    // must be a real RFC 4122 UUID — `nanoid()` would be rejected by the
    // server-side replay with "invalid input syntax for type uuid". (Phase
    // 2c will likely move id generation server-side anyway.)
    const id = crypto.randomUUID();
    // Modern Zero 1.x mutator-call shape: `z.mutate(mutators.ns.action(args))`.
    // The mutator runs optimistically here, then again authoritatively on the
    // server (`apps/api/src/server-mutators.ts`).
    await z.mutate(
      mutators.ticket.create({
        id,
        title: `Hello from agent (${new Date().toLocaleTimeString()})`,
        description: 'Created via the Phase 2b verification button.',
        priority: 'normal',
      }),
    );
  }

  return (
    <div className="mt-3 grid gap-3">
      <div className="rounded-md border border-emerald-200 bg-emerald-50/50 px-3 py-2 text-sm text-emerald-900">
        <span className="font-medium">Sync status:</span>{' '}
        {ready ? `${tickets.length} ticket(s) in ${workspaceName}.` : 'connecting to zero-cache…'}
      </div>

      {/* TEMP: removed in Phase 2c — replaced with real inbox UI. */}
      <div className="grid gap-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-700">Recent open tickets</h3>
          <Button size="sm" onClick={onCreateTestTicket}>
            Create test ticket
          </Button>
        </div>
        {recent.length === 0 ? (
          <p className="text-xs text-slate-500">No tickets yet — click the button above.</p>
        ) : (
          <ul className="divide-y divide-slate-200 rounded-md border border-slate-200 bg-white">
            {recent.map((t) => (
              <li
                key={t.id}
                className="grid grid-cols-[1fr_auto_auto] items-center gap-3 px-3 py-2 text-sm"
              >
                <span className="truncate font-medium text-slate-800">{t.title}</span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                  {t.status}
                </span>
                <span className="font-mono text-[11px] text-slate-400">
                  {new Date(t.createdAt).toLocaleTimeString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
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
