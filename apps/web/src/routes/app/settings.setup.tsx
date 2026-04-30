// /app/settings/setup — first-run checklist. Items are computed live from Zero
// queries via `useSetupProgress` and stay reactive after each side effect.

import { Button, cn } from '@opendesk/ui';
import { queries } from '@opendesk/zero-schema';
import { useQuery } from '@rocicorp/zero/react';
import { createFileRoute, Link, useRouteContext } from '@tanstack/react-router';
import { Check, Circle, ListChecks, Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';
import type { SessionData } from '@/lib/session-loader';
import { type SetupItemSnapshot, setSetupDismissed, useSetupProgress } from '@/lib/setup-progress';

export const Route = createFileRoute('/app/settings/setup')({
  component: SetupPage,
});

function SetupPage() {
  const { session } = useRouteContext({ from: '/app' }) as { session: SessionData };
  const workspaceID = session.session.activeOrganizationId ?? null;
  const progress = useSetupProgress(workspaceID);
  const [domains] = useQuery(queries.sendingDomains());

  if (!progress.ready) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-6 sm:px-8">
        <SetupHeader completedCount={0} total={progress.total} ready={false} />
        <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
          {progress.items.map((item) => (
            <SetupRow
              key={item.id}
              item={item}
              ready={false}
              actionDisabled
              actionLabel={LABEL_FOR[item.id].action}
              actionTo={null}
              title={LABEL_FOR[item.id].title}
              description={LABEL_FOR[item.id].description}
            />
          ))}
        </div>
      </div>
    );
  }

  const verifiedDomain = domains.find((d) => d.dnsStatus === 'verified');
  const firstUnverified = domains.find((d) => d.dnsStatus !== 'verified');
  const dnsTarget = firstUnverified?.id ?? verifiedDomain?.id ?? domains[0]?.id ?? null;
  const verifiedCount = domains.filter((d) => d.dnsStatus === 'verified').length;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-6 sm:px-8">
      <SetupHeader completedCount={progress.completedCount} total={progress.total} ready />

      <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
        {progress.items.map((item) => (
          <SetupRow
            key={item.id}
            item={item}
            ready
            title={LABEL_FOR[item.id].title}
            description={LABEL_FOR[item.id].description}
            actionLabel={LABEL_FOR[item.id].action}
            actionDisabled={ACTION_DISABLED[item.id] ?? false}
            actionTo={resolveActionTo(item.id, dnsTarget)}
            actionCaption={ACTION_CAPTION[item.id]}
          >
            {item.id === 'dnsVerified' && domains.length > 1 ? (
              <p className="mt-2 text-xs text-muted-foreground">
                {verifiedCount} of {domains.length} domains verified
              </p>
            ) : null}
          </SetupRow>
        ))}
      </div>

      <div className="flex flex-col items-center gap-2 pt-2 text-xs text-muted-foreground">
        {progress.dismissed ? (
          <p>
            Setup is hidden from the header.{' '}
            <button
              type="button"
              onClick={() => setSetupDismissed(workspaceID, false)}
              className="font-medium text-brand underline-offset-2 hover:underline"
            >
              Show it again.
            </button>
          </p>
        ) : (
          <button
            type="button"
            onClick={() => setSetupDismissed(workspaceID, true)}
            className="font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            Hide setup checklist
          </button>
        )}
      </div>
    </div>
  );
}

function SetupHeader({
  completedCount,
  total,
  ready,
}: {
  completedCount: number;
  total: number;
  ready: boolean;
}) {
  const pct = total === 0 ? 0 : Math.round((completedCount / total) * 100);
  return (
    <header className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <div className="grid h-9 w-9 place-items-center rounded-md bg-brand-soft text-brand-soft-foreground ring-1 ring-brand-border">
          <ListChecks className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-foreground">Set up your workspace</h1>
          <p className="text-sm text-muted-foreground">
            Get Salve ready to receive and route customer messages.
          </p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div
          className="h-2 flex-1 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-label="Setup progress"
          aria-valuenow={ready ? pct : 0}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full rounded-full bg-brand-600 transition-[width] duration-300"
            style={{ width: `${ready ? pct : 0}%` }}
          />
        </div>
        <span className="shrink-0 tabular-nums text-xs text-muted-foreground">
          {ready ? `${completedCount} of ${total} complete` : 'Loading…'}
        </span>
      </div>
    </header>
  );
}

interface ActionTarget {
  to: string;
  search?: Record<string, string>;
}

function SetupRow({
  item,
  ready,
  title,
  description,
  actionLabel,
  actionTo,
  actionDisabled,
  actionCaption,
  children,
}: {
  item: SetupItemSnapshot;
  ready: boolean;
  title: string;
  description: string;
  actionLabel: string;
  actionTo: ActionTarget | null;
  actionDisabled: boolean;
  actionCaption?: string;
  children?: ReactNode;
}) {
  const completed = item.completed;
  return (
    <div className="flex flex-col gap-3 border-b border-border px-4 py-4 last:border-b-0 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
      <div className="flex min-w-0 items-start gap-3">
        <StatusIcon ready={ready} completed={completed} />
        <div className="min-w-0">
          <p
            className={cn(
              'text-sm font-medium',
              completed ? 'text-muted-foreground line-through' : 'text-foreground',
            )}
          >
            {title}
            {completed ? <span className="sr-only"> (completed)</span> : null}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
          {children}
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-start gap-1 sm:items-end">
        {completed ? (
          <span className="inline-flex h-9 items-center gap-1.5 rounded-md bg-success-soft px-3 text-xs font-medium text-success-soft-foreground">
            <Check className="h-3.5 w-3.5" /> Done
          </span>
        ) : actionDisabled || !actionTo ? (
          <Button size="sm" variant="outline" disabled>
            {actionLabel}
          </Button>
        ) : (
          <Button asChild size="sm" variant={item.id === 'workspace' ? 'outline' : 'default'}>
            <Link to={actionTo.to} search={actionTo.search}>
              {actionLabel}
            </Link>
          </Button>
        )}
        {actionCaption && !completed ? (
          <span className="text-[11px] text-muted-foreground">{actionCaption}</span>
        ) : null}
      </div>
    </div>
  );
}

function StatusIcon({ ready, completed }: { ready: boolean; completed: boolean }) {
  if (!ready) {
    return (
      <span className="mt-0.5 inline-flex h-5 w-5 items-center justify-center text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      </span>
    );
  }
  if (completed) {
    return (
      <span className="mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-success text-success-foreground">
        <Check className="h-3 w-3" aria-hidden />
      </span>
    );
  }
  return (
    <span className="mt-0.5 inline-flex h-5 w-5 items-center justify-center text-border-strong">
      <Circle className="h-4 w-4" strokeDasharray="3 3" aria-hidden />
    </span>
  );
}

const LABEL_FOR: Record<
  SetupItemSnapshot['id'],
  { title: string; description: string; action: string }
> = {
  workspace: {
    title: 'Create your workspace',
    description: "You're in. Every step below scopes to this workspace.",
    action: 'Done',
  },
  domain: {
    title: 'Add a sending domain',
    description: 'Connect a domain so replies go out from your own brand.',
    action: 'Add domain',
  },
  dnsVerified: {
    title: 'Verify DNS',
    description: 'Add the DKIM and MAIL FROM records, then verify.',
    action: 'Verify DNS',
  },
  address: {
    title: 'Create a support address',
    description: 'Pick a local part such as support@ to send and receive on.',
    action: 'Add address',
  },
  routing: {
    title: 'Configure routing',
    description: 'Decide priority, default team, and assignee for inbound messages.',
    action: 'Create rule',
  },
  firstMessage: {
    title: 'Receive your first message',
    description: 'Forward an email to your support address to test the inbox.',
    action: 'Send a test',
  },
  invite: {
    title: 'Invite a teammate',
    description: 'Bring at least one collaborator into the workspace.',
    action: 'Invite teammate',
  },
};

const ACTION_DISABLED: Partial<Record<SetupItemSnapshot['id'], boolean>> = {
  workspace: true,
  firstMessage: true,
  invite: true,
};

const ACTION_CAPTION: Partial<Record<SetupItemSnapshot['id'], string>> = {
  firstMessage: 'Coming next phase',
  invite: 'Coming next phase',
};

function resolveActionTo(
  id: SetupItemSnapshot['id'],
  dnsTarget: string | null,
): ActionTarget | null {
  switch (id) {
    case 'domain':
      return { to: '/app/settings/channels/email/domains', search: { action: 'add' } };
    case 'address':
      return { to: '/app/settings/channels/email/addresses', search: { action: 'add' } };
    case 'routing':
      return { to: '/app/settings/channels/email/routing' };
    case 'dnsVerified':
      return dnsTarget ? { to: `/app/settings/channels/email/domains/${dnsTarget}` } : null;
    default:
      return null;
  }
}
