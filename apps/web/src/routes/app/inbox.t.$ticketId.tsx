// /app/inbox/t/$ticketId — ticket detail (right pane).
//
// Loads the workspace-scoped `ticketByID` custom query (see
// `packages/zero-schema/src/queries.ts`) which already pulls customer,
// assignee, creator, messages with attachments, and the message author user.
// All writes go through `mutators.ticket.*` / `mutators.message.send` so
// permission assertions enforce workspace boundaries on both client + server.

import { mutators } from '@opendesk/mutators';
import {
  Avatar,
  AvatarFallback,
  Badge,
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  initialsFromName,
  ScrollArea,
  Separator,
} from '@opendesk/ui';
import { queries } from '@opendesk/zero-schema';
import { useQuery } from '@rocicorp/zero/react';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { format, formatDistanceToNow } from 'date-fns';
import {
  AlertTriangle,
  ArrowDown,
  ChevronDown,
  Equal,
  ExternalLink,
  Lock,
  MoreHorizontal,
  Paperclip,
  ShieldCheck,
  UserMinus,
  UserPlus,
} from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { Composer, type ComposerEmailAddress, type ComposerSendArgs } from '@/components/composer';
import { CustomFieldsBlock } from '@/components/conversation/custom-fields-block';
import { TagsField } from '@/components/conversation/tags-field';
import { BackToInbox } from '@/components/inbox/back-to-inbox';
import { TicketDetailSkeleton } from '@/components/skeletons';
import { useShortcut } from '@/lib/shortcuts';
import { useWorkbenchStore } from '@/lib/workbench';
import { useZero } from '@/lib/zero';
import { CACHE_FOREVER, CACHE_NAV } from '@/lib/zero-cache';

export const Route = createFileRoute('/app/inbox/t/$ticketId')({
  component: TicketDetail,
});

const STATUS_OPTIONS: Array<{
  id: 'open' | 'in_progress' | 'snoozed' | 'resolved' | 'closed';
  label: string;
}> = [
  { id: 'open', label: 'Open' },
  { id: 'in_progress', label: 'In progress' },
  { id: 'snoozed', label: 'Snoozed' },
  { id: 'resolved', label: 'Resolved' },
  { id: 'closed', label: 'Closed' },
];

const PRIORITY_OPTIONS: Array<{
  id: 'low' | 'normal' | 'high' | 'urgent';
  label: string;
}> = [
  { id: 'urgent', label: 'Urgent' },
  { id: 'high', label: 'High' },
  { id: 'normal', label: 'Normal' },
  { id: 'low', label: 'Low' },
];

type SendMessageWithEmailAddress = Parameters<typeof mutators.message.send>[0] & {
  emailAddressID?: string;
};

type AuthSignal =
  | 'pass'
  | 'fail'
  | 'softfail'
  | 'neutral'
  | 'none'
  | 'temperror'
  | 'permerror'
  | 'unknown';

interface InboundAuthResults {
  spf: AuthSignal;
  dkim: AuthSignal;
  dmarc: AuthSignal;
}

// Structural reader for inbound rows. The Zero schema row carries
// `processedMessageID` / `headers: ReadonlyJSONValue` etc.; this interface
// keeps the union of legacy + current field shapes the helpers below tolerate
// (the helpers normalise everything to a single auth-results record).
interface InboundRowReader {
  id: string;
  messageID?: string | null;
  messageId?: string | null;
  processedMessageID?: string | null;
  processedMessageId?: string | null;
  message?: { id?: string | null } | null;
  processedMessage?: { id?: string | null } | null;
  emailAddressID?: string | null;
  emailAddressId?: string | null;
  addressID?: string | null;
  addressId?: string | null;
  emailAddress?: { id?: string | null; fullAddress?: string | null } | null;
  destinationAddress?: string | null;
  envelopeTo?: string | null;
  recipientAddress?: string | null;
  // `headers` is `json()` in the Zero schema (i.e. `ReadonlyJSONValue`); the
  // helpers below only read object-shaped headers, all other shapes fall
  // through to `null`.
  headers?: unknown;
  authenticationResults?: unknown;
  authResults?: unknown;
  providerMeta?: unknown;
  receivedAt?: number | null;
  createdAt?: number | null;
}

function statusVariant(status: string): 'default' | 'success' | 'warning' | 'muted' {
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
    default:
      return 'muted';
  }
}

function priorityVariant(p: string): 'default' | 'warning' | 'danger' | 'muted' {
  switch (p) {
    case 'urgent':
      return 'danger';
    case 'high':
      return 'warning';
    case 'low':
      return 'muted';
    default:
      return 'default';
  }
}

function statusDotClass(status: string): string {
  switch (status) {
    case 'open':
      return 'bg-brand-500';
    case 'in_progress':
      return 'bg-warning';
    case 'snoozed':
      return 'bg-border-strong';
    case 'resolved':
    case 'closed':
      return 'bg-success';
    default:
      return 'bg-border-strong';
  }
}

const HEADER_PILL_CLASS =
  'inline-flex items-center gap-1 rounded-md px-1.5 h-6 text-[12px] text-muted-foreground hover:bg-surface-muted hover:text-foreground border border-transparent hover:border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors';

function TicketDetail() {
  const { ticketId } = Route.useParams();
  const navigate = useNavigate();
  const z = useZero();
  const { session } = Route.useRouteContext() as {
    session: {
      user: { id: string; name: string; email: string };
      session: { activeOrganizationId: string | null };
    };
  };
  const currentUserID = session.user.id;
  const workspaceID = session.session.activeOrganizationId ?? null;
  const setActiveTabTitle = useWorkbenchStore((state) => state.setActiveTabTitle);
  const recordRecentTicket = useWorkbenchStore((state) => state.recordRecentTicket);

  const [ticket, ticketStatus] = useQuery(queries.ticketByID({ id: ticketId }), CACHE_NAV);
  const [members] = useQuery(queries.workspaceMembers(), CACHE_FOREVER);
  // Subscribe to the same inbox window as InboxList so j/k from inside a
  // ticket walks the same ordered list. CACHE_FOREVER is shared with the
  // list query — no extra hydration cost on back-nav. Always uses the
  // default `all` ordering; per-route filters aren't preserved here.
  const [inboxList] = useQuery(queries.inboxOpen({ limit: 200 }), CACHE_FOREVER);
  const inboxIndex = useMemo(
    () => inboxList.findIndex((t: { id: string }) => t.id === ticketId),
    [inboxList, ticketId],
  );

  useShortcut(['j'], () => {
    if (inboxList.length === 0) return;
    const next = inboxIndex < 0 ? 0 : Math.min(inboxList.length - 1, inboxIndex + 1);
    const target = inboxList[next];
    if (target && target.id !== ticketId) {
      navigate({ to: '/app/inbox/t/$ticketId', params: { ticketId: target.id } });
    }
  });
  useShortcut(['k'], () => {
    if (inboxList.length === 0) return;
    const prev = inboxIndex < 0 ? 0 : Math.max(0, inboxIndex - 1);
    const target = inboxList[prev];
    if (target && target.id !== ticketId) {
      navigate({ to: '/app/inbox/t/$ticketId', params: { ticketId: target.id } });
    }
  });
  // Phase 3a: outbound delivery status per message. Empty until the
  // Post-commit Inngest delivery → mailpit/SES round-trip stamps a row.
  const [outboundRows] = useQuery(queries.outboundMessagesByTicket({ id: ticketId }), CACHE_NAV);
  const [sendableEmailAddresses] = useQuery(queries.sendableEmailAddresses(), CACHE_FOREVER);
  const [inboundMessageRows] = useQuery(
    queries.inboundMessagesByTicket({ id: ticketId }),
    CACHE_NAV,
  );
  const deliveryByMessage = new Map<string, { status: string; error?: string | null }>();
  for (const r of outboundRows) {
    deliveryByMessage.set(r.messageID, { status: r.status, error: r.error });
  }

  useEffect(() => {
    if (!ticket) return;
    const title = ticket.shortID > 0 ? `#${ticket.shortID} ${ticket.title}` : ticket.title;
    setActiveTabTitle(workspaceID, title, 'ticket');
    recordRecentTicket(workspaceID, ticketId);
  }, [recordRecentTicket, setActiveTabTitle, ticket, ticketId, workspaceID]);

  // Distinguish "still hydrating" (don't claim not-found) from "server
  // confirmed empty" (truly not found). zbugs `issue-page.tsx` makes the
  // same distinction: only render the not-found card once the result is
  // `complete`, otherwise render a layout-shape skeleton.
  if (!ticket) {
    if (ticketStatus?.type !== 'complete') {
      return <TicketDetailSkeleton />;
    }
    return (
      <div className="flex flex-1 items-center justify-center px-6">
        <div className="max-w-sm rounded-xl border border-border bg-surface p-6 text-center shadow-sm">
          <p className="text-sm font-semibold text-foreground">Ticket not found</p>
          <p className="mt-1 text-xs text-muted-foreground">
            This ticket doesn't exist or isn't in your workspace.
          </p>
          <Button asChild className="mt-4" variant="outline" size="sm">
            <Link to="/app/inbox">Back to inbox</Link>
          </Button>
        </div>
      </div>
    );
  }

  const messages: ReadonlyArray<{
    readonly id: string;
    readonly bodyHtml: string;
    readonly bodyText: string;
    readonly isInternal: boolean;
    readonly authorType: 'customer' | 'agent' | 'system';
    readonly authorUserID?: string | null;
    readonly createdAt: number;
    readonly authorUser?: { id: string; name?: string | null; email: string } | null;
    readonly authorCustomer?: {
      id: string;
      name?: string | null;
      displayName?: string | null;
      email: string;
    } | null;
    readonly attachments?: ReadonlyArray<{
      id: string;
      filename: string;
      sizeBytes: number;
      mimeType: string;
      s3Key: string;
    }>;
  }> = ticket.messages ?? [];
  const inboundRows = inboundMessageRows;
  const inboundAuthByMessageID = buildInboundAuthByMessageID(inboundRows);
  const preferredEmailAddressID = preferredInboundEmailAddressID(
    ticket,
    inboundRows,
    messages,
    sendableEmailAddresses,
  );

  const isClosed = ticket.status === 'closed';
  const isResolved = ticket.status === 'resolved';

  async function setStatus(next: (typeof STATUS_OPTIONS)[number]['id']) {
    if (next === 'resolved') {
      await z.mutate(mutators.ticket.close({ id: ticketId }));
    } else if (next === 'open' && (isResolved || isClosed)) {
      await z.mutate(mutators.ticket.reopen({ id: ticketId }));
    } else if (next === 'snoozed') {
      await z.mutate(
        mutators.ticket.snooze({ id: ticketId, until: Date.now() + 24 * 60 * 60 * 1000 }),
      );
    } else {
      // For in_progress / closed we use update with an explicit status — but
      // update mutator currently doesn't accept status. Fallback: use close
      // for closed, reopen for open. Other transitions go through close +
      // a synthetic update; in Phase 4 ticket.update will accept status.
      if (next === 'closed') {
        await z.mutate(mutators.ticket.close({ id: ticketId }));
      } else if (next === 'in_progress') {
        // Treat in_progress as a reopen (best-effort) — the update mutator
        // doesn't take status yet.
        await z.mutate(mutators.ticket.reopen({ id: ticketId }));
      }
    }
  }

  async function setPriority(p: (typeof PRIORITY_OPTIONS)[number]['id']) {
    await z.mutate(mutators.ticket.update({ id: ticketId, priority: p }));
  }

  async function setAssignee(userID: string | null) {
    await z.mutate(mutators.ticket.assign({ id: ticketId, assigneeID: userID }));
  }

  async function onSend(args: ComposerSendArgs) {
    const payload: SendMessageWithEmailAddress = {
      id: crypto.randomUUID(),
      ticketID: ticketId,
      bodyHTML: args.bodyHTML,
      bodyText: args.bodyText,
      isInternal: args.isInternal,
      attachments: args.attachments,
      ...(!args.isInternal && args.emailAddressID ? { emailAddressID: args.emailAddressID } : {}),
    };
    await z.mutate(mutators.message.send(payload as Parameters<typeof mutators.message.send>[0]));
  }

  const statusLabel = STATUS_OPTIONS.find((o) => o.id === ticket.status)?.label ?? ticket.status;
  const customerLine = ticket.customer?.email ?? ticket.customer?.name ?? 'No customer';

  return (
    <div className="flex h-full flex-1 flex-col bg-background">
      <header className="flex shrink-0 flex-col gap-1.5 border-b border-border bg-surface px-6 py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-1.5 text-[12px] text-muted-foreground">
            <BackToInbox />
            <span aria-hidden="true">·</span>
            <span className="truncate" title={customerLine}>
              {customerLine}
            </span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">
              {ticket.shortID > 0 ? `#${ticket.shortID}` : 'new'}
            </span>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Ticket actions"
                className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-surface-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setStatus('snoozed')}>Snooze 24h</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setStatus('resolved')}>Close</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => window.open(window.location.href, '_blank')}>
                <ExternalLink className="h-3.5 w-3.5" /> Open in new tab
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <h1 className="truncate text-lg font-semibold text-foreground" title={ticket.title}>
          {ticket.title}
        </h1>

        <div className="flex flex-wrap items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className={HEADER_PILL_CLASS}>
                <span
                  className={cn('h-2 w-2 shrink-0 rounded-full', statusDotClass(ticket.status))}
                  aria-hidden="true"
                />
                <span className="text-foreground">{statusLabel}</span>
                <ChevronDown className="h-3 w-3 opacity-60" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel>Set status</DropdownMenuLabel>
              {STATUS_OPTIONS.map((s) => (
                <DropdownMenuItem key={s.id} onSelect={() => setStatus(s.id)}>
                  <Badge variant={statusVariant(s.id)}>{s.label}</Badge>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className={HEADER_PILL_CLASS}>
                <PriorityIcon priority={ticket.priority} />
                <span className="text-foreground capitalize">{ticket.priority}</span>
                <ChevronDown className="h-3 w-3 opacity-60" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel>Set priority</DropdownMenuLabel>
              {PRIORITY_OPTIONS.map((p) => (
                <DropdownMenuItem key={p.id} onSelect={() => setPriority(p.id)}>
                  <Badge variant={priorityVariant(p.id)}>{p.label}</Badge>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className={HEADER_PILL_CLASS}>
                {ticket.assignee ? (
                  <>
                    <Avatar size={16}>
                      <AvatarFallback>
                        {initialsFromName(ticket.assignee.name, ticket.assignee.email)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-foreground">
                      {ticket.assignee.name ?? ticket.assignee.email}
                    </span>
                  </>
                ) : (
                  <>
                    <UserPlus className="h-3.5 w-3.5" />
                    <span>Unassigned</span>
                  </>
                )}
                <ChevronDown className="h-3 w-3 opacity-60" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuLabel>Assign to</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => setAssignee(currentUserID)}>
                <UserPlus className="h-3.5 w-3.5" /> Assign to me
              </DropdownMenuItem>
              {ticket.assigneeID ? (
                <DropdownMenuItem onSelect={() => setAssignee(null)}>
                  <UserMinus className="h-3.5 w-3.5" /> Unassign
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuSeparator />
              {members.length === 0 ? (
                <DropdownMenuItem disabled>No teammates yet</DropdownMenuItem>
              ) : (
                members.map(
                  (m: { id: string; userId: string; user?: { name?: string; email?: string } }) => (
                    <DropdownMenuItem key={m.id} onSelect={() => setAssignee(m.userId)}>
                      <Avatar size={18}>
                        <AvatarFallback>
                          {initialsFromName(m.user?.name, m.user?.email)}
                        </AvatarFallback>
                      </Avatar>
                      <span>{m.user?.name ?? m.user?.email ?? m.userId}</span>
                    </DropdownMenuItem>
                  ),
                )
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          <TagsField ticketID={ticketId} ticket={ticket} />

          <div className="ml-auto text-[11px] text-muted-foreground">
            Updated {formatDistanceToNow(new Date(ticket.updatedAt), { addSuffix: true })}
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1">
          <ScrollArea className="flex-1">
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-6 py-6">
              <div className="grid gap-3 xl:hidden">
                <CustomFieldsBlock entity="ticket" entityID={ticketId} record={ticket} />
                {ticket.customer?.id ? (
                  <CustomFieldsBlock
                    entity="customer"
                    entityID={ticket.customer.id}
                    record={ticket.customer}
                  />
                ) : null}
              </div>
              {ticket.description ? (
                <div className="rounded-lg border border-border bg-surface p-4 text-sm text-surface-foreground shadow-sm">
                  <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Original description
                  </p>
                  <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed">
                    {ticket.description}
                  </p>
                </div>
              ) : null}
              {messages.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border bg-surface px-4 py-6 text-center text-xs text-muted-foreground">
                  No messages yet — write a reply or note below to get started.
                </div>
              ) : (
                messages.map((m) => {
                  const isAgentMessage = m.authorType === 'agent' || m.authorType === 'system';
                  return (
                    <MessageBubble
                      key={m.id}
                      message={m}
                      isAgent={isAgentMessage}
                      isSelf={m.authorUserID === currentUserID}
                      delivery={deliveryByMessage.get(m.id) ?? null}
                      inboundAuth={
                        !isAgentMessage ? (inboundAuthByMessageID.get(m.id) ?? null) : null
                      }
                    />
                  );
                })
              )}
            </div>
          </ScrollArea>
          <aside className="hidden w-80 shrink-0 flex-col gap-3 overflow-y-auto border-l border-border bg-surface-muted/40 p-3 xl:flex">
            <CustomFieldsBlock entity="ticket" entityID={ticketId} record={ticket} />
            {ticket.customer?.id ? (
              <CustomFieldsBlock
                entity="customer"
                entityID={ticket.customer.id}
                record={ticket.customer}
              />
            ) : null}
          </aside>
        </div>
        <Separator />
        <div className="shrink-0">
          <Composer
            ticketID={ticketId}
            userID={currentUserID}
            workspaceID={workspaceID}
            disabled={isClosed}
            disabledReason="This ticket is closed. Reopen it to reply."
            emailAddresses={sendableEmailAddresses}
            preferredEmailAddressID={preferredEmailAddressID}
            onSend={onSend}
          />
          {isClosed ? (
            <div className="mx-4 mb-4 -mt-2 flex justify-end">
              <Button size="sm" variant="outline" onClick={() => setStatus('open')}>
                Reopen ticket
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function MessageBubble({
  message,
  isAgent,
  isSelf,
  delivery,
  inboundAuth,
}: {
  message: {
    readonly id: string;
    readonly bodyHtml: string;
    readonly bodyText: string;
    readonly isInternal: boolean;
    readonly createdAt: number;
    readonly authorUser?: { id: string; name?: string | null; email: string } | null;
    readonly authorCustomer?: {
      id: string;
      name?: string | null;
      displayName?: string | null;
      email: string;
    } | null;
    readonly attachments?: ReadonlyArray<{
      id: string;
      filename: string;
      sizeBytes: number;
      mimeType: string;
      s3Key: string;
    }>;
  };
  isAgent: boolean;
  isSelf: boolean;
  delivery: { status: string; error?: string | null } | null;
  inboundAuth: InboundAuthResults | null;
}) {
  const author = message.authorUser ?? message.authorCustomer;
  const authorName = message.authorCustomer?.displayName ?? author?.name;
  const ts = new Date(message.createdAt);
  const internal = message.isInternal;

  if (internal) {
    return (
      <div className="rounded-lg border border-warning-border bg-warning-soft px-4 py-3 shadow-sm">
        <div className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-warning-soft-foreground">
          <Lock className="h-3 w-3" /> Internal note
          <span className="ml-auto text-[10px] font-normal text-warning-soft-foreground/80">
            {format(ts, 'MMM d, h:mm a')}
          </span>
        </div>
        <div
          className="prose prose-sm max-w-none text-[13.5px] text-warning-soft-foreground"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: Tiptap output sanitized at compose-time; Phase 7 hardens with server-side stripping.
          dangerouslySetInnerHTML={{ __html: message.bodyHtml }}
        />
        <AttachmentList attachments={message.attachments} />
        <p className="mt-2 text-[11px] text-warning-soft-foreground/70">
          {authorName ?? author?.email ?? 'Unknown'}
        </p>
      </div>
    );
  }

  const align = isAgent ? 'items-end' : 'items-start';
  return (
    <div className={cn('flex flex-col gap-1', align)}>
      <div className={cn('flex w-full items-end gap-2', isAgent && 'flex-row-reverse')}>
        <Avatar size={28}>
          <AvatarFallback>{initialsFromName(authorName, author?.email)}</AvatarFallback>
        </Avatar>
        <div
          className={cn(
            'max-w-[75%] rounded-2xl px-4 py-2.5 text-[13.5px] shadow-sm',
            isAgent
              ? 'bg-brand-soft text-brand-soft-foreground ring-1 ring-brand-border'
              : 'bg-surface text-surface-foreground ring-1 ring-border',
          )}
        >
          <div
            className="prose prose-sm max-w-none leading-relaxed"
            // biome-ignore lint/security/noDangerouslySetInnerHtml: Tiptap output sanitized at compose-time
            dangerouslySetInnerHTML={{ __html: message.bodyHtml }}
          />
          <AttachmentList attachments={message.attachments} />
        </div>
      </div>
      <p
        className={cn(
          'flex flex-wrap items-center gap-1.5 px-10 text-[10.5px] text-muted-foreground',
          isAgent ? 'self-end text-right' : 'self-start',
        )}
      >
        <span>
          {authorName ?? author?.email ?? 'Unknown'}
          {isSelf ? ' (you)' : ''} · {format(ts, 'MMM d, h:mm a')}
        </span>
        {isAgent && delivery ? (
          <DeliveryBadge status={delivery.status} error={delivery.error} />
        ) : null}
        {!isAgent && inboundAuth ? <AuthResultsBadges results={inboundAuth} /> : null}
      </p>
    </div>
  );
}

function AuthResultsBadges({ results }: { results: InboundAuthResults }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <ShieldCheck className="h-3 w-3 text-muted-foreground" />
      <AuthBadge label="SPF" value={results.spf} />
      <AuthBadge label="DKIM" value={results.dkim} />
      <AuthBadge label="DMARC" value={results.dmarc} />
    </span>
  );
}

function AuthBadge({ label, value }: { label: string; value: AuthSignal }) {
  return (
    <Badge variant={authVariant(value)} title={`${label}: ${value}`}>
      {label} {value}
    </Badge>
  );
}

function buildInboundAuthByMessageID(rows: InboundRowReader[]): Map<string, InboundAuthResults> {
  const byMessageID = new Map<string, InboundAuthResults>();
  for (const row of rows) {
    const messageID = inboundRowMessageID(row);
    if (!messageID) continue;
    byMessageID.set(messageID, authResultsFromInboundRow(row));
  }
  return byMessageID;
}

function preferredInboundEmailAddressID(
  // biome-ignore lint/suspicious/noExplicitAny: ticket shape is projected from Zero related rows.
  ticket: any,
  inboundRows: ReadonlyArray<InboundRowReader>,
  messages: ReadonlyArray<{ readonly id: string }>,
  sendableAddresses: ReadonlyArray<ComposerEmailAddress>,
): string | null {
  const sendableIDs = new Set(sendableAddresses.map((address) => address.id));
  const sendableByAddress = new Map(
    sendableAddresses.map((address) => [address.fullAddress.toLowerCase(), address.id]),
  );
  const sortedInboundRows = [...inboundRows].sort(
    (a, b) => inboundRowTimestamp(b) - inboundRowTimestamp(a),
  );
  const candidates = [
    ...sortedInboundRows.map(inboundRowAddressID),
    stringProperty(ticket, 'inboundEmailAddressID'),
    stringProperty(ticket, 'inboundEmailAddressId'),
    stringProperty(ticket, 'emailAddressID'),
    stringProperty(ticket, 'emailAddressId'),
    ...[...messages].reverse().map((message) => stringProperty(message, 'emailAddressID')),
    ...[...messages].reverse().map((message) => stringProperty(message, 'emailAddressId')),
  ];
  const directID = candidates.find((id) => id && sendableIDs.has(id));
  if (directID) return directID;

  for (const row of sortedInboundRows) {
    const destination = inboundRowDestinationAddress(row);
    if (!destination) continue;
    const id = sendableByAddress.get(destination.toLowerCase());
    if (id) return id;
  }

  return null;
}

function inboundRowMessageID(row: InboundRowReader): string | null {
  return (
    row.messageID ??
    row.messageId ??
    row.processedMessageID ??
    row.processedMessageId ??
    row.message?.id ??
    row.processedMessage?.id ??
    null
  );
}

function inboundRowAddressID(row: InboundRowReader): string | null {
  return (
    row.emailAddressID ??
    row.emailAddressId ??
    row.addressID ??
    row.addressId ??
    row.emailAddress?.id ??
    null
  );
}

function inboundRowTimestamp(row: InboundRowReader): number {
  return row.receivedAt ?? row.createdAt ?? 0;
}

function inboundRowDestinationAddress(row: InboundRowReader): string | null {
  return row.destinationAddress ?? row.envelopeTo ?? row.recipientAddress ?? null;
}

function authResultsFromInboundRow(row: InboundRowReader): InboundAuthResults {
  const providerMeta = authObject(row.providerMeta);
  const objectSource =
    authObject(row.authenticationResults) ??
    authObject(row.authResults) ??
    authObject(providerMeta?.authenticationResults) ??
    authObject(providerMeta?.authResults);

  const header = authHeader(row);

  return {
    spf: authSignalFor(objectSource, header, 'spf'),
    dkim: authSignalFor(objectSource, header, 'dkim'),
    dmarc: authSignalFor(objectSource, header, 'dmarc'),
  };
}

function authObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function authHeader(row: InboundRowReader): string | null {
  if (typeof row.authenticationResults === 'string') return row.authenticationResults;
  if (typeof row.authResults === 'string') return row.authResults;
  const headers = authObject(row.headers);
  if (!headers) return null;
  const key = Object.keys(headers).find((name) => name.toLowerCase() === 'authentication-results');
  const value = key ? headers[key] : null;
  if (Array.isArray(value)) return value.join('; ');
  return typeof value === 'string' ? value : null;
}

function authValueFromObject(
  source: Record<string, unknown> | null,
  key: 'spf' | 'dkim' | 'dmarc',
): AuthSignal {
  const value = source?.[key];
  if (typeof value === 'string') return normalizeAuthSignal(value);
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const nested = record.result ?? record.status ?? record.value;
    if (typeof nested === 'string') return normalizeAuthSignal(nested);
  }
  return 'unknown';
}

function authSignalFor(
  source: Record<string, unknown> | null,
  header: string | null,
  key: 'spf' | 'dkim' | 'dmarc',
): AuthSignal {
  const fromObject = authValueFromObject(source, key);
  return fromObject === 'unknown' ? authValueFromHeader(header, key) : fromObject;
}

function authValueFromHeader(header: string | null, key: 'spf' | 'dkim' | 'dmarc'): AuthSignal {
  if (!header) return 'unknown';
  const match = header.toLowerCase().match(new RegExp(`${key}=([a-z]+)`));
  return normalizeAuthSignal(match?.[1]);
}

function normalizeAuthSignal(value: string | undefined): AuthSignal {
  switch (value?.toLowerCase()) {
    case 'pass':
      return 'pass';
    case 'fail':
      return 'fail';
    case 'softfail':
      return 'softfail';
    case 'neutral':
      return 'neutral';
    case 'none':
      return 'none';
    case 'temperror':
      return 'temperror';
    case 'permerror':
      return 'permerror';
    default:
      return 'unknown';
  }
}

function stringProperty(source: unknown, key: string) {
  if (!source || typeof source !== 'object') return null;
  const value = (source as Record<string, unknown>)[key];
  return typeof value === 'string' && value ? value : null;
}

function authVariant(value: AuthSignal): 'default' | 'success' | 'warning' | 'danger' | 'muted' {
  switch (value) {
    case 'pass':
      return 'success';
    case 'fail':
    case 'permerror':
      return 'danger';
    case 'softfail':
    case 'temperror':
      return 'warning';
    case 'neutral':
    case 'none':
    case 'unknown':
      return 'muted';
    default:
      return 'default';
  }
}

function DeliveryBadge({ status, error }: { status: string; error?: string | null }) {
  const variant: 'default' | 'success' | 'warning' | 'danger' | 'muted' =
    status === 'sent' || status === 'delivered'
      ? 'success'
      : status === 'queued' || status === 'sending'
        ? 'warning'
        : status === 'bounced' || status === 'complained' || status === 'failed'
          ? 'danger'
          : 'muted';
  return (
    <Badge variant={variant} title={error ?? undefined}>
      {status}
    </Badge>
  );
}

const apiBase = (import.meta.env.VITE_API_URL as string | undefined) ?? '';

function AttachmentList({
  attachments,
}: {
  attachments?: ReadonlyArray<{
    id: string;
    filename: string;
    sizeBytes: number;
    mimeType: string;
    s3Key: string;
  }>;
}) {
  if (!attachments || attachments.length === 0) return null;
  async function onClick(s3Key: string) {
    try {
      const res = await fetch(`${apiBase}/api/files/get`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ s3Key }),
      });
      if (!res.ok) throw new Error('failed to fetch download url');
      const { getUrl } = (await res.json()) as { getUrl: string };
      window.open(getUrl, '_blank');
    } catch (e) {
      console.error('attachment download', e);
    }
  }
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {attachments.map((a) => (
        <button
          key={a.id}
          type="button"
          onClick={() => onClick(a.s3Key)}
          className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 text-[11px] text-muted-foreground hover:bg-surface-muted"
        >
          <Paperclip className="h-3 w-3" />
          <span className="max-w-[160px] truncate">{a.filename}</span>
          <span className="text-muted-foreground">·</span>
          <span>{formatBytes(a.sizeBytes)}</span>
        </button>
      ))}
    </div>
  );
}

function PriorityIcon({ priority }: { priority: string }) {
  if (priority === 'urgent') {
    return <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-danger" aria-hidden="true" />;
  }
  if (priority === 'high') {
    return <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" aria-hidden="true" />;
  }
  if (priority === 'low') {
    return <ArrowDown className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden="true" />;
  }
  return <Equal className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden="true" />;
}

function formatBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}
