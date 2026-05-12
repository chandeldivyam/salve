// /app/settings/migrations/atlas/webhooks — manage Atlas → Salve webhook
// subscriptions. Reads come from Zero (`atlasMigrationRuns`,
// `atlasWebhookSubscriptions`); the only REST calls are writes that reach
// Atlas (Subscribe = POST /v1/webhooks; Remove = POST /v1/webhooks/{id} with
// status=INACTIVE — Atlas's public API has no DELETE).

import { useQuery } from '@rocicorp/zero/react';
import {
  Badge,
  Button,
  CopyValue,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldDescription,
  FieldLabel,
  Input,
} from '@salve/ui';
import {
  type AtlasMigrationRunRow,
  type AtlasWebhookSubscriptionRow,
  queries,
} from '@salve/zero-schema';
import { createFileRoute, Link } from '@tanstack/react-router';
import { AlertTriangle, ArrowLeft, ShieldCheck, Trash2 } from 'lucide-react';
import { type FormEvent, useMemo, useState } from 'react';
import { RouteErrorFeedback, RoutePendingFeedback } from '@/components/route-feedback';
import { EmptyState, ListSection, SettingsBody, SettingsHeader } from '@/components/settings';
import { showError, showSuccess } from '@/lib/feedback';
import {
  ATLAS_WEBHOOK_EVENT_DESCRIPTIONS,
  ATLAS_WEBHOOK_EVENT_LABELS,
  ATLAS_WEBHOOK_EVENTS,
  type AtlasWebhookEvent,
  setAtlasRunApiKey,
  subscribeAtlasWebhook,
  unsubscribeAtlasWebhook,
} from '@/lib/migrations';
import { CACHE_NAV } from '@/lib/zero-cache';

export const Route = createFileRoute('/app/settings/migrations/atlas/webhooks')({
  component: AtlasWebhooksPage,
  pendingComponent: RoutePendingFeedback,
  errorComponent: RouteErrorFeedback,
});

function AtlasWebhooksPage() {
  const [runs] = useQuery(queries.atlasMigrationRuns(), CACHE_NAV);
  const [subscriptions] = useQuery(queries.atlasWebhookSubscriptions(), CACHE_NAV);

  const latestRun = runs[0] ?? null;
  const subsByEvent = useMemo(() => {
    const m = new Map<string, AtlasWebhookSubscriptionRow>();
    for (const s of subscriptions) m.set(s.event, s);
    return m;
  }, [subscriptions]);

  return (
    <>
      <SettingsHeader
        title="Atlas webhooks"
        description="Stream Atlas conversation updates into Salve in real time. Subscribing creates a webhook on Atlas via your stored API key; removing deactivates it."
        actions={
          <Button asChild size="sm" variant="outline" className="h-8">
            <Link to="/app/settings/migrations/atlas">
              <ArrowLeft className="h-3.5 w-3.5" />
              Migration
            </Link>
          </Button>
        }
      />
      <SettingsBody>
        <div className="flex flex-col gap-5">
          {!latestRun ? (
            <EmptyState
              icon={AlertTriangle}
              title="No Atlas migration found"
              description="Start an Atlas backfill before configuring webhooks. Webhooks bind to the latest run for credentials and lazy-expand."
              action={
                <Button asChild size="sm">
                  <Link to="/app/settings/migrations/atlas">Start a migration</Link>
                </Button>
              }
            />
          ) : !latestRun.hasApiKey ? (
            <SetApiKeyCard runId={latestRun.id} />
          ) : (
            <>
              <SigningSecretCallout subscriptions={subscriptions} />
              <EventsList latestRun={latestRun} subsByEvent={subsByEvent} />
            </>
          )}
        </div>
      </SettingsBody>
    </>
  );
}

function SetApiKeyCard({ runId }: { runId: string }) {
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!apiKey.trim()) return;
    setBusy(true);
    try {
      await setAtlasRunApiKey({
        apiKey: apiKey.trim(),
        baseUrl: baseUrl.trim() || undefined,
      });
      showSuccess('API key saved. You can now subscribe to events.');
      setApiKey('');
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to save API key');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-md border border-line-default bg-bg-elevated/40 p-4">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning-foreground" />
        <div className="flex-1">
          <p className="font-medium text-[13px] text-fg-primary">Add an Atlas API key</p>
          <p className="mt-1 text-[12px] text-fg-tertiary">
            Run <span className="font-mono">{runId}</span> is missing credentials. Webhooks call
            Atlas's API for lazy-expand of unmapped conversations, so a key is required.
          </p>
        </div>
      </div>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Field>
          <FieldLabel>Atlas API key</FieldLabel>
          <Input
            type="password"
            autoComplete="new-password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="atlas_..."
          />
          <FieldDescription>Used for the backfill and any webhook syncs.</FieldDescription>
        </Field>
        <Field>
          <FieldLabel>Atlas API host (optional)</FieldLabel>
          <Input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://api.atlas.so"
          />
        </Field>
        <div className="flex justify-end">
          <Button size="sm" type="submit" disabled={busy || !apiKey.trim()}>
            {busy ? 'Saving…' : 'Save API key'}
          </Button>
        </div>
      </form>
    </section>
  );
}

function SigningSecretCallout({
  subscriptions,
}: {
  subscriptions: readonly AtlasWebhookSubscriptionRow[];
}) {
  const sample = subscriptions[0]?.endpoint ?? null;
  const publicBase = sample
    ? sample.replace(/\/api\/migrations\/atlas\/webhook\/[^/]+\/?$/, '')
    : null;
  const isLocalhost = publicBase?.startsWith('http://localhost') ?? false;

  return (
    <div className="rounded-md border border-line-default bg-bg-elevated/40 p-4">
      <div className="mb-2 flex items-start gap-2">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success-foreground" />
        <div className="flex-1">
          <p className="font-medium text-[13px] text-fg-primary">How signing works</p>
          <p className="mt-1 text-[12px] text-fg-tertiary">
            When you Subscribe, we call <code>POST /v1/webhooks</code> on Atlas with your API key.
            Atlas returns a one-time signing secret which we store server-side. Every delivery is
            HMAC-SHA256 signed with that secret and verified before we touch your data — no manual
            setup needed.
          </p>
        </div>
      </div>
      {publicBase ? (
        <div className="mt-3 grid grid-cols-[120px_minmax(0,1fr)] gap-y-1.5 text-[12px]">
          <span className="text-fg-tertiary">Callback origin</span>
          <CopyValue value={publicBase} />
        </div>
      ) : null}
      {isLocalhost ? (
        <p className="mt-3 flex items-start gap-2 text-[12px] text-warning-foreground">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Atlas cannot reach <code>localhost</code>. Expose port 3001 (e.g. ngrok) and set{' '}
            <code>SALVE_PUBLIC_API_URL</code> before subscribing.
          </span>
        </p>
      ) : null}
    </div>
  );
}

function EventsList({
  latestRun,
  subsByEvent,
}: {
  latestRun: AtlasMigrationRunRow;
  subsByEvent: ReadonlyMap<string, AtlasWebhookSubscriptionRow>;
}) {
  const [confirmEvent, setConfirmEvent] = useState<AtlasWebhookEvent | null>(null);
  return (
    <>
      <ListSection title="Events" count={ATLAS_WEBHOOK_EVENTS.length}>
        {ATLAS_WEBHOOK_EVENTS.map((event) => (
          <EventRow
            key={event}
            event={event}
            runId={latestRun.id}
            subscription={subsByEvent.get(event) ?? null}
            onRequestRemove={() => setConfirmEvent(event)}
          />
        ))}
      </ListSection>
      <RemoveSubscriptionDialog event={confirmEvent} onClose={() => setConfirmEvent(null)} />
    </>
  );
}

function EventRow({
  event,
  runId,
  subscription,
  onRequestRemove,
}: {
  event: AtlasWebhookEvent;
  runId: string;
  subscription: AtlasWebhookSubscriptionRow | null;
  onRequestRemove: () => void;
}) {
  const subscribed = subscription?.status === 'active';
  const [busy, setBusy] = useState(false);

  async function onSubscribe() {
    setBusy(true);
    try {
      await subscribeAtlasWebhook({ event, runId });
      showSuccess(`Subscribed to ${ATLAS_WEBHOOK_EVENT_LABELS[event]}`);
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Webhook subscribe failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-start gap-3 rounded-md px-2 py-3">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2">
          <span className="font-medium text-[13px] text-fg-primary">
            {ATLAS_WEBHOOK_EVENT_LABELS[event]}
          </span>
          <code className="rounded bg-bg-elevated px-1.5 py-0.5 text-[11px] text-fg-tertiary">
            {event}
          </code>
          {subscribed ? <Badge variant="success">Subscribed</Badge> : null}
        </div>
        <p className="mt-1 text-[12px] text-fg-tertiary">
          {ATLAS_WEBHOOK_EVENT_DESCRIPTIONS[event]}
        </p>
        {subscribed && subscription ? (
          <div className="mt-2 grid grid-cols-[120px_minmax(0,1fr)] gap-y-1 text-[11px]">
            <span className="text-fg-quaternary">Atlas id</span>
            <span className="font-mono text-fg-tertiary">{subscription.remoteID}</span>
            <span className="text-fg-quaternary">Callback URL</span>
            <CopyValue value={subscription.endpoint} className="text-[11px]" />
          </div>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center">
        {subscribed ? (
          <Button
            size="sm"
            variant="outline"
            className="h-7"
            disabled={busy}
            onClick={onRequestRemove}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Remove
          </Button>
        ) : (
          <Button size="sm" className="h-7 min-w-[96px]" disabled={busy} onClick={onSubscribe}>
            {busy ? 'Subscribing…' : 'Subscribe'}
          </Button>
        )}
      </div>
    </div>
  );
}

function RemoveSubscriptionDialog({
  event,
  onClose,
}: {
  event: AtlasWebhookEvent | null;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const open = event !== null;

  async function confirm() {
    if (!event || busy) return;
    setBusy(true);
    try {
      await unsubscribeAtlasWebhook(event);
      showSuccess(`Removed ${ATLAS_WEBHOOK_EVENT_LABELS[event]} subscription`);
      onClose();
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Webhook remove failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? onClose() : null)}>
      <DialogContent className="!w-[440px] !max-w-[calc(100vw-2rem)] gap-0 p-0">
        <DialogHeader className="px-5 pt-5 pb-3">
          <DialogTitle className="text-[15px]">Remove subscription</DialogTitle>
          <DialogDescription className="text-xs">
            Deactivates the {event ? ATLAS_WEBHOOK_EVENT_LABELS[event] : ''} webhook on Atlas's side
            (their public API has no DELETE). You can re-subscribe later — Atlas will issue a fresh
            signing secret.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="px-5 pb-5 pt-2">
          <Button size="sm" variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" variant="destructive" onClick={confirm} disabled={busy}>
            {busy ? 'Removing…' : 'Remove subscription'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
