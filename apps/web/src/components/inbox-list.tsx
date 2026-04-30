// Phase 2c inbox list — Linear-tight, virtualized, keyboard-driven.
//
// Reads `inboxOpen` (workspace-scoped) once and applies `filter` + `search`
// fully client-side; Phase 4 will introduce dedicated server-side queries
// for /unassigned, /mine, /resolved when the inbox grows past ~5k rows.

import { mutators } from '@opendesk/mutators';
import {
  Avatar,
  AvatarFallback,
  Badge,
  Button,
  cn,
  Input,
  initialsFromName,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@opendesk/ui';
import { type InboxRow, queries, type Ticket } from '@opendesk/zero-schema';
import { useQuery } from '@rocicorp/zero/react';
import { Link, useNavigate, useRouteContext } from '@tanstack/react-router';
import { useVirtualizer } from '@tanstack/react-virtual';
import { formatDistanceToNow } from 'date-fns';
import { ArrowRight, Filter, Inbox, ListChecks, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSetupProgress } from '@/lib/setup-progress';
import { sortedTagsFromRelations, type TagRow, tagPillStyle } from '@/lib/support-metadata';
import { useZero } from '@/lib/zero';

type InboxFilter = 'all' | 'unassigned' | 'mine' | 'resolved';

interface InboxListProps {
  selectedTicketID: string | null;
  currentUserID: string;
}

// `InboxRow` is `QueryResultType<typeof queries.inboxOpen>[number]` from
// `@opendesk/zero-schema` — it carries the ticket columns plus the
// `customer`, `assignee`, and tag relateds declared on `inboxOpen`.
type TicketRow = InboxRow;

const STATUS_LABEL: Record<Ticket['status'], string> = {
  open: 'Open',
  in_progress: 'In progress',
  snoozed: 'Snoozed',
  resolved: 'Resolved',
  closed: 'Closed',
};

function statusVariant(status: Ticket['status']): 'default' | 'success' | 'warning' | 'muted' {
  switch (status) {
    case 'open':
      return 'default';
    case 'in_progress':
      return 'warning';
    case 'snoozed':
      return 'muted';
    case 'resolved':
    case 'closed':
      return 'success';
  }
}

const FILTERS: Array<{ id: InboxFilter; label: string }> = [
  { id: 'all', label: 'All open' },
  { id: 'unassigned', label: 'Unassigned' },
  { id: 'mine', label: 'Mine' },
  { id: 'resolved', label: 'Resolved' },
];

export function InboxList({ selectedTicketID, currentUserID }: InboxListProps) {
  const navigate = useNavigate();
  const z = useZero();
  const ctx = useRouteContext({ from: '/app' }) as {
    session: { session: { activeOrganizationId: string | null } };
  };
  const workspaceID = ctx.session.session.activeOrganizationId ?? null;
  const setupProgress = useSetupProgress(workspaceID);
  const [tickets, status] = useQuery(queries.inboxOpen());
  const ready = status?.type !== 'unknown';
  const [filter, setFilter] = useState<InboxFilter>('all');
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tickets.filter((t) => {
      // status filter
      if (filter === 'unassigned' && t.assigneeID) return false;
      if (filter === 'mine' && t.assigneeID !== currentUserID) return false;
      if (filter === 'resolved') {
        if (t.status !== 'resolved' && t.status !== 'closed') return false;
      } else if (t.status === 'resolved' || t.status === 'closed') {
        // The default `inboxOpen` query already excludes resolved/closed —
        // this branch is a defence in depth in case the query changes.
        return false;
      }
      if (!q) return true;
      return (
        t.title.toLowerCase().includes(q) ||
        (t.customer?.email?.toLowerCase().includes(q) ?? false) ||
        (t.customer?.name?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [tickets, filter, search, currentUserID]);

  // Selected index based on URL — keeps J/K + selected highlight in sync
  // with the actual route param.
  const selectedIndex = useMemo(() => {
    if (!selectedTicketID) return -1;
    return filtered.findIndex((t) => t.id === selectedTicketID);
  }, [filtered, selectedTicketID]);

  const parentRef = useRef<HTMLDivElement | null>(null);
  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 96,
    overscan: 8,
  });

  // J/K + arrow keys for keyboard navigation. E archives (close mutator).
  // Bound on the list container itself so the composer textarea isn't
  // hijacked.
  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      // ignore when an input/textarea/contenteditable is focused
      const target = ev.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return;
      }
      if (filtered.length === 0) return;
      const cur = selectedIndex < 0 ? 0 : selectedIndex;
      let next = cur;
      if (ev.key === 'j' || ev.key === 'ArrowDown') {
        next = Math.min(filtered.length - 1, cur + 1);
      } else if (ev.key === 'k' || ev.key === 'ArrowUp') {
        next = Math.max(0, cur - 1);
      } else if (ev.key === 'Enter') {
        const t = filtered[cur];
        if (t) navigate({ to: '/app/inbox/t/$ticketId', params: { ticketId: t.id } });
        return;
      } else if (ev.key === 'e' || ev.key === 'E') {
        const t = filtered[cur];
        if (t) {
          z.mutate(mutators.ticket.close({ id: t.id }));
        }
        return;
      } else {
        return;
      }
      ev.preventDefault();
      const t = filtered[next];
      if (t) {
        navigate({ to: '/app/inbox/t/$ticketId', params: { ticketId: t.id } });
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [filtered, navigate, selectedIndex, z]);

  async function onCreateSampleTicket() {
    const samples = [
      {
        title: 'Where is my refund?',
        priority: 'high' as const,
        customerEmail: 'amelia@northwind.com',
        customerName: 'Amelia Hart',
      },
      {
        title: 'Cannot connect Slack integration',
        priority: 'normal' as const,
        customerEmail: 'priya@acme.io',
        customerName: 'Priya Shah',
      },
      {
        title: 'Feature request: keyboard shortcut for snooze',
        priority: 'low' as const,
        customerEmail: 'leo@cobalt.dev',
        customerName: 'Leo Park',
      },
    ];
    for (const s of samples) {
      await z.mutate(
        mutators.ticket.create({
          id: crypto.randomUUID(),
          ...s,
        }),
      );
    }
  }

  return (
    <div className="flex h-full w-full flex-col bg-surface">
      <div className="flex shrink-0 flex-col gap-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search title or customer…"
              className="h-9 pl-8 text-sm"
            />
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="Filters"
                className="grid h-9 w-9 place-items-center rounded-md border border-border text-muted-foreground hover:bg-surface-muted"
              >
                <Filter className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Filters (placeholder)</TooltipContent>
          </Tooltip>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={cn(
                'rounded-md px-2 py-1 text-xs font-medium transition-colors',
                filter === f.id
                  ? 'bg-brand-soft text-brand-soft-foreground ring-1 ring-brand-border'
                  : 'text-muted-foreground hover:bg-surface-muted',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div ref={parentRef} className="flex-1 overflow-y-auto">
        {!ready ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            Loading inbox…
          </div>
        ) : filtered.length === 0 ? (
          <EmptyInbox
            showSampleCreate={tickets.length === 0 && filter === 'all' && search === ''}
            onCreate={onCreateSampleTicket}
            setup={setupProgress}
          />
        ) : (
          <div
            style={{
              height: virtualizer.getTotalSize(),
              width: '100%',
              position: 'relative',
            }}
          >
            {virtualizer.getVirtualItems().map((vi) => {
              const t = filtered[vi.index];
              if (!t) return null;
              const isSelected = t.id === selectedTicketID;
              return (
                <div
                  key={t.id}
                  data-testid="inbox-row"
                  data-selected={isSelected ? 'true' : 'false'}
                  ref={virtualizer.measureElement}
                  data-index={vi.index}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    transform: `translateY(${vi.start}px)`,
                  }}
                >
                  <InboxListRow ticket={t} isSelected={isSelected} />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyInbox({
  showSampleCreate,
  onCreate,
  setup,
}: {
  showSampleCreate: boolean;
  onCreate: () => void;
  setup: ReturnType<typeof useSetupProgress>;
}) {
  const isDev = import.meta.env.DEV;
  const promoteSetup = setup.ready && !setup.isComplete && !setup.dismissed;
  const nextItem = setup.items.find((item) => !item.completed);

  if (promoteSetup) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-8 py-12 text-center">
        <div className="grid h-12 w-12 place-items-center rounded-full bg-brand-soft text-brand-soft-foreground ring-1 ring-brand-border">
          <ListChecks className="h-6 w-6" />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">Set up your inbox</p>
          <p className="text-xs text-muted-foreground">
            {setup.completedCount} of {setup.total} complete
            {nextItem ? ` · Next: ${NEXT_LABEL[nextItem.id]}` : ''}
          </p>
        </div>
        <Button asChild size="sm">
          <Link to="/app/settings/setup">
            Continue setup <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </Button>
        {isDev && showSampleCreate ? (
          <button
            type="button"
            onClick={onCreate}
            className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            Dev: create sample tickets
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-8 py-12 text-center">
      <div className="grid h-12 w-12 place-items-center rounded-full bg-brand-soft text-brand-soft-foreground">
        <Inbox className="h-6 w-6" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">Your inbox is empty</p>
        <p className="text-xs text-muted-foreground">Replies will appear here.</p>
      </div>
      {isDev && showSampleCreate ? (
        <button
          type="button"
          onClick={onCreate}
          className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          Dev: create sample tickets
        </button>
      ) : null}
    </div>
  );
}

const NEXT_LABEL: Record<ReturnType<typeof useSetupProgress>['items'][number]['id'], string> = {
  workspace: 'create your workspace',
  domain: 'add a sending domain',
  dnsVerified: 'verify DNS',
  address: 'create a support address',
  routing: 'configure routing',
  firstMessage: 'receive your first message',
  invite: 'invite a teammate',
};

function InboxListRow({ ticket, isSelected }: { ticket: TicketRow; isSelected: boolean }) {
  const isUrgent = ticket.priority === 'urgent' || ticket.priority === 'high';
  const customerLabel = ticket.customer?.name ?? ticket.customer?.email ?? 'No customer';
  const updated = new Date(ticket.updatedAt);
  const rowTags = sortedTagsFromRelations((ticket as unknown as Record<string, unknown>).tags);

  return (
    <Link
      to="/app/inbox/t/$ticketId"
      params={{ ticketId: ticket.id }}
      className={cn(
        'group block border-b border-border transition-colors',
        isSelected
          ? 'border-l-4 border-l-brand-500 bg-brand-soft/60'
          : 'border-l-4 border-l-transparent hover:bg-surface-muted',
      )}
    >
      <div className="flex items-start gap-3 px-4 py-3">
        {isUrgent ? (
          <span
            aria-hidden="true"
            className={cn(
              'mt-1 h-2 w-2 shrink-0 rounded-full',
              ticket.priority === 'urgent' ? 'bg-danger' : 'bg-warning',
            )}
          />
        ) : (
          <span
            aria-hidden="true"
            className="mt-1 h-2 w-2 shrink-0 rounded-full bg-border-strong"
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span
              className={cn(
                'block truncate text-[13px] text-muted-foreground',
                isSelected && 'text-brand-soft-foreground',
              )}
              title={customerLabel}
            >
              {customerLabel}
            </span>
            <div className="flex min-w-0 shrink-0 items-center gap-1">
              <InboxRowTags tags={rowTags} />
              <span className="text-[11px] tabular-nums text-muted-foreground">
                {formatDistanceToNow(updated, { addSuffix: false })}
              </span>
            </div>
          </div>
          <p
            className={cn(
              'mt-0.5 line-clamp-1 text-[13.5px] leading-snug',
              isSelected ? 'font-semibold text-foreground' : 'font-medium text-foreground/90',
            )}
          >
            {ticket.title}
          </p>
          <div className="mt-1.5 flex items-center gap-1.5">
            <Badge variant={statusVariant(ticket.status)}>{STATUS_LABEL[ticket.status]}</Badge>
            {ticket.priority !== 'normal' ? (
              <Badge
                variant={
                  ticket.priority === 'urgent'
                    ? 'danger'
                    : ticket.priority === 'high'
                      ? 'warning'
                      : 'muted'
                }
              >
                {ticket.priority}
              </Badge>
            ) : null}
            <span className="ml-auto">
              {ticket.assignee ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Avatar size={20}>
                      <AvatarFallback>
                        {initialsFromName(ticket.assignee.name, ticket.assignee.email)}
                      </AvatarFallback>
                    </Avatar>
                  </TooltipTrigger>
                  <TooltipContent>{ticket.assignee.name ?? ticket.assignee.email}</TooltipContent>
                </Tooltip>
              ) : (
                <span className="text-[11px] text-muted-foreground">Unassigned</span>
              )}
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}

function InboxRowTags({ tags }: { tags: TagRow[] }) {
  if (tags.length === 0) return null;
  const shown = tags.slice(0, 3);
  const hidden = tags.slice(3);

  return (
    <span className="hidden min-w-0 items-center gap-1 sm:inline-flex">
      {shown.map((tag) => (
        <span
          key={tag.id}
          className="inline-flex h-[18px] max-w-20 items-center rounded-full border px-1.5 text-[10px] font-medium leading-none"
          style={tagPillStyle(tag)}
          title={tag.group?.label ?? tag.label}
        >
          <span className="truncate">{tag.label}</span>
        </span>
      ))}
      {hidden.length > 0 ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="inline-flex h-[18px] items-center rounded-full border border-border bg-muted px-1.5 text-[10px] font-medium leading-none text-muted-foreground"
              aria-label={`${hidden.length} more tags`}
              onClick={(event) => event.preventDefault()}
            >
              +{hidden.length}
            </button>
          </TooltipTrigger>
          <TooltipContent>{hidden.map((tag) => tag.label).join(', ')}</TooltipContent>
        </Tooltip>
      ) : null}
    </span>
  );
}
