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
import { createFileRoute, Link } from '@tanstack/react-router';
import { format, formatDistanceToNow } from 'date-fns';
import {
  ChevronDown,
  ExternalLink,
  Lock,
  MoreHorizontal,
  Paperclip,
  UserMinus,
  UserPlus,
} from 'lucide-react';
import { Composer, type ComposerSendArgs } from '@/components/composer';
import { useZero } from '@/lib/zero';

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

function TicketDetail() {
  const { ticketId } = Route.useParams();
  const z = useZero();
  const { session } = Route.useRouteContext() as {
    session: { user: { id: string; name: string; email: string } };
  };
  const currentUserID = session.user.id;

  // Zero's relational types don't surface through `useQuery` without heavy
  // plumbing; project to a structural type at the call site.
  // biome-ignore lint/suspicious/noExplicitAny: see comment above
  type AnyTicket = any;
  // biome-ignore lint/suspicious/noExplicitAny: see comment above
  type AnyMember = any;
  const [ticket, status] = useQuery(queries.ticketByID({ id: ticketId })) as unknown as [
    AnyTicket | null,
    { type: string },
  ];
  const [members] = useQuery(queries.workspaceMembers()) as unknown as [
    AnyMember[],
    { type: string },
  ];

  if (status?.type === 'unknown') {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-slate-400">Loading…</div>
    );
  }

  if (!ticket) {
    return (
      <div className="flex flex-1 items-center justify-center px-6">
        <div className="max-w-sm rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <p className="text-sm font-semibold text-slate-800">Ticket not found</p>
          <p className="mt-1 text-xs text-slate-500">
            This ticket doesn't exist or isn't in your workspace.
          </p>
          <Button asChild className="mt-4" variant="outline" size="sm">
            <Link to="/app/inbox">Back to inbox</Link>
          </Button>
        </div>
      </div>
    );
  }

  const messages: Array<{
    id: string;
    bodyHtml: string;
    bodyText: string;
    isInternal: boolean;
    authorType: 'customer' | 'agent' | 'system';
    authorUserID?: string | null;
    createdAt: number;
    authorUser?: { id: string; name?: string | null; email: string } | null;
    attachments?: Array<{
      id: string;
      filename: string;
      sizeBytes: number;
      mimeType: string;
      s3Key: string;
    }>;
  }> = ticket.messages ?? [];

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
    await z.mutate(
      mutators.message.send({
        id: crypto.randomUUID(),
        ticketID: ticketId,
        bodyHTML: args.bodyHTML,
        bodyText: args.bodyText,
        isInternal: args.isInternal,
        attachments: args.attachments,
      }),
    );
  }

  return (
    <div className="flex h-full flex-1 flex-col bg-slate-50">
      <header className="flex shrink-0 flex-col gap-3 border-b border-slate-200 bg-white px-6 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
              {ticket.customer?.email ?? ticket.customer?.name ?? 'No customer'} ·{' '}
              {ticket.shortID > 0 ? `#${ticket.shortID}` : 'new'}
            </p>
            <h1 className="truncate text-lg font-semibold text-slate-900" title={ticket.title}>
              {ticket.title}
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="grid h-8 w-8 place-items-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setStatus('snoozed')}>
                  Snooze 24h
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setStatus('resolved')}>Close</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => window.open(window.location.href, '_blank')}>
                  <ExternalLink className="h-3.5 w-3.5" /> Open in new tab
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Status dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-md ring-1 ring-inset ring-transparent transition-colors hover:ring-slate-200"
              >
                <Badge variant={statusVariant(ticket.status)}>
                  {STATUS_OPTIONS.find((o) => o.id === ticket.status)?.label ?? ticket.status}
                  <ChevronDown className="-mr-0.5 h-3 w-3" />
                </Badge>
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

          {/* Priority dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-md ring-1 ring-inset ring-transparent transition-colors hover:ring-slate-200"
              >
                <Badge variant={priorityVariant(ticket.priority)}>
                  {ticket.priority}
                  <ChevronDown className="-mr-0.5 h-3 w-3" />
                </Badge>
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

          {/* Assignee dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-md border border-transparent px-1 py-0.5 text-xs text-slate-600 hover:border-slate-200 hover:bg-slate-50"
              >
                {ticket.assignee ? (
                  <>
                    <Avatar size={20}>
                      <AvatarFallback>
                        {initialsFromName(ticket.assignee.name, ticket.assignee.email)}
                      </AvatarFallback>
                    </Avatar>
                    <span>{ticket.assignee.name ?? ticket.assignee.email}</span>
                  </>
                ) : (
                  <>
                    <UserPlus className="h-3.5 w-3.5 text-slate-400" />
                    <span>Unassigned</span>
                  </>
                )}
                <ChevronDown className="h-3 w-3 text-slate-400" />
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

          <div className="ml-auto text-[11px] text-slate-400">
            Updated {formatDistanceToNow(new Date(ticket.updatedAt), { addSuffix: true })}
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col">
        <ScrollArea className="flex-1">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-6 py-6">
            {ticket.description ? (
              <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-700 shadow-sm">
                <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-400">
                  Original description
                </p>
                <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed">
                  {ticket.description}
                </p>
              </div>
            ) : null}
            {messages.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-200 bg-white px-4 py-6 text-center text-xs text-slate-400">
                No messages yet — write a reply or note below to get started.
              </div>
            ) : (
              messages.map((m) => (
                <MessageBubble
                  key={m.id}
                  message={m}
                  isAgent={m.authorType === 'agent' || m.authorType === 'system'}
                  isSelf={m.authorUserID === currentUserID}
                />
              ))
            )}
          </div>
        </ScrollArea>
        <Separator />
        <div className="shrink-0">
          <Composer
            ticketID={ticketId}
            disabled={isClosed}
            disabledReason="This ticket is closed. Reopen it to reply."
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
}: {
  message: {
    id: string;
    bodyHtml: string;
    bodyText: string;
    isInternal: boolean;
    createdAt: number;
    authorUser?: { id: string; name?: string | null; email: string } | null;
    attachments?: Array<{
      id: string;
      filename: string;
      sizeBytes: number;
      mimeType: string;
      s3Key: string;
    }>;
  };
  isAgent: boolean;
  isSelf: boolean;
}) {
  const author = message.authorUser;
  const ts = new Date(message.createdAt);
  const internal = message.isInternal;

  if (internal) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 shadow-sm">
        <div className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-amber-700">
          <Lock className="h-3 w-3" /> Internal note
          <span className="ml-auto text-[10px] font-normal text-amber-600/80">
            {format(ts, 'MMM d, h:mm a')}
          </span>
        </div>
        <div
          className="prose prose-sm max-w-none text-[13.5px] text-amber-900"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: Tiptap output sanitized at compose-time; Phase 7 hardens with server-side stripping.
          dangerouslySetInnerHTML={{ __html: message.bodyHtml }}
        />
        <AttachmentList attachments={message.attachments} />
        <p className="mt-2 text-[11px] text-amber-800/70">
          {author?.name ?? author?.email ?? 'Unknown'}
        </p>
      </div>
    );
  }

  const align = isAgent ? 'items-end' : 'items-start';
  return (
    <div className={cn('flex flex-col gap-1', align)}>
      <div className={cn('flex w-full items-end gap-2', isAgent && 'flex-row-reverse')}>
        <Avatar size={28}>
          <AvatarFallback>{initialsFromName(author?.name, author?.email)}</AvatarFallback>
        </Avatar>
        <div
          className={cn(
            'max-w-[75%] rounded-2xl px-4 py-2.5 text-[13.5px] shadow-sm',
            isAgent
              ? 'bg-brand-50 text-brand-900 ring-1 ring-brand-100'
              : 'bg-white text-slate-800 ring-1 ring-slate-200',
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
          'px-10 text-[10.5px] text-slate-400',
          isAgent ? 'self-end text-right' : 'self-start',
        )}
      >
        {author?.name ?? author?.email ?? 'Unknown'}
        {isSelf ? ' (you)' : ''} · {format(ts, 'MMM d, h:mm a')}
      </p>
    </div>
  );
}

const apiBase = (import.meta.env.VITE_API_URL as string | undefined) ?? '';

function AttachmentList({
  attachments,
}: {
  attachments?: Array<{
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
          className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-50"
        >
          <Paperclip className="h-3 w-3" />
          <span className="max-w-[160px] truncate">{a.filename}</span>
          <span className="text-slate-400">·</span>
          <span>{formatBytes(a.sizeBytes)}</span>
        </button>
      ))}
    </div>
  );
}

function formatBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}
