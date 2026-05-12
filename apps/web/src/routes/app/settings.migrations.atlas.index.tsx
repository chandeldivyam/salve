// /app/settings/migrations/atlas — start a new Atlas migration + view recent runs.
// Reads come from Zero (`queries.atlasMigrationRuns`); writes hit the REST
// /start endpoint, which validates the API key against Atlas before persisting.

import { useQuery } from '@rocicorp/zero/react';
import { Badge, Button, Field, FieldDescription, FieldLabel, Input } from '@salve/ui';
import { type AtlasMigrationRunRow, queries } from '@salve/zero-schema';
import { createFileRoute, Link } from '@tanstack/react-router';
import { formatDistanceToNowStrict } from 'date-fns';
import { ArrowRightLeft } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { RouteErrorFeedback, RoutePendingFeedback } from '@/components/route-feedback';
import { EmptyState, ListSection, SettingsBody, SettingsHeader } from '@/components/settings';
import { showError, showSuccess } from '@/lib/feedback';
import { startAtlasMigration } from '@/lib/migrations';
import { CACHE_NAV } from '@/lib/zero-cache';

export const Route = createFileRoute('/app/settings/migrations/atlas/')({
  component: AtlasMigrationsPage,
  pendingComponent: RoutePendingFeedback,
  errorComponent: RouteErrorFeedback,
});

function AtlasMigrationsPage() {
  const [runs, runsStatus] = useQuery(queries.atlasMigrationRuns(), CACHE_NAV);
  const ready = runsStatus?.type === 'complete';

  return (
    <>
      <SettingsHeader
        title="Atlas migration"
        description="Import historical conversations, customers, custom fields, and tags from Atlas.so. Start a run with the date range you need; webhooks (configured separately) keep things in sync afterwards."
        actions={
          <Button asChild size="sm" variant="outline" className="h-8">
            <Link to="/app/settings/migrations/atlas/webhooks">
              <ArrowRightLeft className="h-3.5 w-3.5" />
              Webhooks
            </Link>
          </Button>
        }
      />
      <SettingsBody maxWidth="wide">
        <div className="flex flex-col gap-6">
          <StartCard />
          <RunsSection runs={runs} ready={ready} />
        </div>
      </SettingsBody>
    </>
  );
}

function StartCard() {
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [sinceDays, setSinceDays] = useState('7');
  const [maxTickets, setMaxTickets] = useState('50');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!apiKey.trim()) return;
    setBusy(true);
    try {
      const sd = sinceDays.trim() ? Number.parseInt(sinceDays.trim(), 10) : undefined;
      const mt = maxTickets.trim() ? Number.parseInt(maxTickets.trim(), 10) : undefined;
      const res = await startAtlasMigration({
        apiKey: apiKey.trim(),
        baseUrl: baseUrl.trim() || undefined,
        sinceDays: Number.isFinite(sd) ? sd : undefined,
        maxTickets: Number.isFinite(mt) ? mt : undefined,
      });
      showSuccess(`Migration ${res.runId} started`);
      setApiKey('');
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to start migration');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <header className="flex flex-col gap-1 border-b border-line-quiet pb-3">
        <h2 className="text-[15px] font-semibold tracking-[-0.011em] text-fg-primary">
          Start a backfill
        </h2>
        <p className="text-[12px] text-fg-tertiary">
          Validates the API key against Atlas before persisting. Repeated runs are idempotent —
          existing tickets are reused rather than duplicated.
        </p>
      </header>
      <form onSubmit={submit} className="grid grid-cols-2 gap-x-5 gap-y-4" noValidate>
        <Field className="col-span-2">
          <FieldLabel>Atlas API key</FieldLabel>
          <Input
            type="password"
            autoComplete="new-password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="ZND..."
          />
          <FieldDescription>Used for the backfill and any webhook syncs.</FieldDescription>
        </Field>
        <Field>
          <FieldLabel>Atlas API host</FieldLabel>
          <Input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://api.atlas.so"
          />
        </Field>
        <Field>
          <FieldLabel>Last N days</FieldLabel>
          <Input
            type="number"
            inputMode="numeric"
            value={sinceDays}
            onChange={(e) => setSinceDays(e.target.value)}
            placeholder="7"
          />
        </Field>
        <Field>
          <FieldLabel>Max tickets</FieldLabel>
          <Input
            type="number"
            inputMode="numeric"
            value={maxTickets}
            onChange={(e) => setMaxTickets(e.target.value)}
            placeholder="50"
          />
        </Field>
        <div className="col-span-2 flex justify-end">
          <Button size="sm" type="submit" disabled={busy || !apiKey.trim()}>
            {busy ? 'Starting…' : 'Start migration'}
          </Button>
        </div>
      </form>
    </section>
  );
}

function RunsSection({ runs, ready }: { runs: readonly AtlasMigrationRunRow[]; ready: boolean }) {
  if (runs.length === 0) {
    if (!ready) {
      return (
        <ListSection title="Recent runs">
          {[0, 1, 2].map((i) => (
            <RunRowSkeleton key={i} />
          ))}
        </ListSection>
      );
    }
    return (
      <EmptyState
        icon={ArrowRightLeft}
        title="No migrations yet"
        description="Validates the key, runs discovery, imports tickets."
      />
    );
  }
  return (
    <ListSection title="Recent runs" count={runs.length}>
      {runs.map((r) => (
        <RunRow key={r.id} run={r} />
      ))}
    </ListSection>
  );
}

function RunRow({ run }: { run: AtlasMigrationRunRow }) {
  const counters = run.counters ?? {};
  const tickets = (counters.tickets_imported ?? 0) + (counters.tickets_reused ?? 0);
  const discovered = counters.discovered ?? 0;
  const messages = counters.messages_imported ?? 0;
  // Row is informational only — no detail page yet, so no hover/chevron
  // affordance (those would imply it's clickable).
  return (
    <div className="flex h-12 items-center gap-3 rounded-md px-2">
      <StatusPill status={run.status} />
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span className="truncate font-mono text-[12px] text-fg-secondary">{run.id}</span>
        <span className="text-[11px] text-fg-quaternary tabular-nums">
          {tickets}/{discovered} tickets · {messages} messages
        </span>
      </div>
      <span className="text-[11px] text-fg-tertiary tabular-nums">
        {formatDistanceToNowStrict(new Date(run.startedAt), { addSuffix: true })}
      </span>
    </div>
  );
}

function RunRowSkeleton() {
  return (
    <div className="flex h-12 items-center gap-3 rounded-md px-2">
      <span className="h-5 w-20 rounded-full bg-bg-elevated/60" />
      <span className="h-3 w-44 flex-1 rounded bg-bg-elevated/60" />
      <span className="h-3 w-12 rounded bg-bg-elevated/60" />
    </div>
  );
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  discovering: 'Discovering',
  backfilling: 'Backfilling',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

function StatusPill({ status }: { status: string }) {
  const variant: 'success' | 'muted' | 'warning' | 'danger' =
    status === 'completed'
      ? 'success'
      : status === 'failed' || status === 'cancelled'
        ? 'danger'
        : status === 'pending'
          ? 'muted'
          : 'warning';
  const label = STATUS_LABELS[status] ?? status;
  return <Badge variant={variant}>{label}</Badge>;
}
