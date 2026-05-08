import { Avatar, AvatarFallback, Badge, Button, cn, initialsFromName } from '@salve/ui';
import { ChevronDown, ChevronRight, MessageSquare, RotateCcw } from 'lucide-react';
import type { KeyboardEvent, ReactNode } from 'react';
import { NoteCard } from '@/components/customer/note-card';
import { WorkbenchLink } from '@/components/workbench/workbench-link';
import { MessageBubble } from './message-bubble';
import { groupTicketActivities, TicketActivityRow } from './ticket-activity-row';
import {
  dayDividerLabel,
  messageSnippet,
  relativeTime,
  statusBadgeVariant,
  statusDotClass,
  statusLabel,
  ticketNumber,
  timestampLabel,
} from './timeline-format';
import type {
  InboundAuthResults,
  TimelineCustomerNote,
  TimelineDelivery,
  TimelineMessage,
  TimelineTicket,
} from './types';

interface ConversationItemProps {
  ticket: TimelineTicket;
  expanded: boolean;
  anchor?: boolean;
  currentUserID: string;
  deliveryByMessage?: ReadonlyMap<string, TimelineDelivery>;
  inboundAuthByMessageID?: ReadonlyMap<string, InboundAuthResults>;
  composer?: ReactNode;
  actions?: ReactNode;
  noteComposer?: ReactNode;
  showEarlier?: ReactNode;
  onToggle?: () => void;
  onReopen?: () => void;
}

type StreamItem =
  | { type: 'message'; id: string; createdAt: number; message: TimelineMessage }
  | {
      type: 'activity';
      id: string;
      createdAt: number;
      group: ReturnType<typeof groupTicketActivities>[number];
    }
  | { type: 'note'; id: string; createdAt: number; note: TimelineCustomerNote };

export function ConversationItem({
  ticket,
  expanded,
  anchor,
  currentUserID,
  deliveryByMessage,
  inboundAuthByMessageID,
  composer,
  actions,
  noteComposer,
  showEarlier,
  onToggle,
  onReopen,
}: ConversationItemProps) {
  const messages = [...(ticket.messages ?? [])].sort(
    (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id),
  );
  const activities = groupTicketActivities(ticket.auditEvents ?? []);
  const ticketNotes = (ticket.customerNotes ?? []).filter((note) => !note.deletedAt);
  const stream = buildStream(messages, activities, ticketNotes);
  const closed = ticket.status === 'closed' || ticket.status === 'resolved';
  const customer = ticket.customer;
  const customerLabel = customer?.displayName ?? customer?.name ?? customer?.email ?? 'Customer';

  return (
    <article
      className={cn(
        'rounded-lg bg-bg-panel ring-1 ring-line-default',
        anchor && 'ring-line-strong',
        ticket.status === 'snoozed' && 'border-l-2 border-warning-border',
        ticket.status === 'closed' && 'bg-bg-elevated/40',
      )}
    >
      <div
        role={onToggle ? 'button' : undefined}
        tabIndex={onToggle ? 0 : undefined}
        onClick={onToggle}
        onKeyDown={
          onToggle
            ? (event: KeyboardEvent<HTMLDivElement>) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onToggle();
                }
              }
            : undefined
        }
        className={cn(
          'flex w-full items-center gap-3 px-3 py-2 text-left',
          onToggle && 'cursor-pointer hover:bg-bg-elevated',
        )}
      >
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-fg-tertiary">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </span>
        <Avatar size={28}>
          <AvatarFallback>{initialsFromName(customerLabel, customer?.email)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span
              className={cn('h-2 w-2 shrink-0 rounded-full', statusDotClass(ticket.status))}
              aria-hidden="true"
            />
            <WorkbenchLink
              href={`/app/inbox/t/${ticket.id}`}
              source="ticket-row"
              onClick={(event) => event.stopPropagation()}
              title={`Open ${ticketNumber(ticket)}`}
              className="shrink-0 rounded text-[12px] tabular-nums text-fg-tertiary hover:text-fg-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {ticketNumber(ticket)}
            </WorkbenchLink>
            <h2 className="truncate text-[13px] font-medium text-fg-primary">{ticket.title}</h2>
            <Badge variant={statusBadgeVariant(ticket.status)} className="hidden sm:inline-flex">
              {statusLabel(ticket.status)}
            </Badge>
          </div>
          <p className="mt-0.5 truncate text-[12px] text-fg-tertiary">
            {expanded ? customerLabel : collapsedMeta(ticket, messages)}
          </p>
        </div>
        <div className="hidden shrink-0 items-center gap-2 text-[11px] text-fg-tertiary md:flex">
          <MessageSquare className="h-3.5 w-3.5" />
          <span className="tabular-nums">{messages.length}</span>
          <span className="tabular-nums">{relativeTime(ticket.updatedAt)}</span>
        </div>
      </div>

      {expanded ? (
        <div className="border-t border-line-quiet px-3 pb-3">
          {actions ? <div className="flex flex-wrap items-center gap-2 py-2">{actions}</div> : null}
          {ticket.description ? (
            <div className="my-3 rounded-lg bg-bg-elevated px-3 py-2 text-[13px] text-fg-secondary">
              <p className="mb-1 text-[11px] font-medium text-fg-tertiary">Original description</p>
              <p className="whitespace-pre-wrap break-words leading-relaxed [overflow-wrap:anywhere]">
                {ticket.description}
              </p>
            </div>
          ) : null}
          {showEarlier ? <div className="pt-2">{showEarlier}</div> : null}
          {stream.length === 0 ? (
            <div className="my-3 rounded-lg border border-dashed border-line-default bg-bg-canvas px-4 py-6 text-center text-[12px] text-fg-tertiary">
              No messages yet. Write a reply or note below to get started.
            </div>
          ) : (
            <div className="flex flex-col gap-3 py-3">
              {renderStream(stream, currentUserID, deliveryByMessage, inboundAuthByMessageID)}
            </div>
          )}
          {noteComposer ? <div className="pt-1 pb-2">{noteComposer}</div> : null}
          {closed ? (
            <div
              key="closed-pill"
              className="mt-2 flex animate-in items-center justify-between gap-3 rounded-lg bg-bg-elevated px-3 py-2 duration-200 ease-out fade-in slide-in-from-bottom-1"
            >
              <div className="min-w-0">
                <p className="text-[12px] font-medium text-fg-primary">
                  {statusLabel(ticket.status)}{' '}
                  {relativeTime(ticket.closedAt ?? ticket.resolvedAt ?? ticket.updatedAt)}
                </p>
                <p className="text-[11px] text-fg-tertiary">
                  Reopen this conversation before replying.
                </p>
              </div>
              {onReopen ? (
                <Button type="button" size="sm" variant="outline" onClick={onReopen}>
                  <RotateCcw className="h-3.5 w-3.5" />
                  Reopen
                </Button>
              ) : null}
            </div>
          ) : composer ? (
            <div
              key="composer"
              className="animate-in duration-200 ease-out fade-in slide-in-from-bottom-1"
            >
              {composer}
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function collapsedMeta(ticket: TimelineTicket, messages: ReadonlyArray<TimelineMessage>) {
  const messageCount = messages.length;
  const countLabel = `${messageCount} ${messageCount === 1 ? 'message' : 'messages'}`;
  return `${messageSnippet(ticket)} · ${countLabel} · ${timestampLabel(ticket.updatedAt)}`;
}

function buildStream(
  messages: ReadonlyArray<TimelineMessage>,
  activities: ReturnType<typeof groupTicketActivities>,
  notes: ReadonlyArray<TimelineCustomerNote>,
): StreamItem[] {
  return [
    ...messages.map((message) => ({
      type: 'message' as const,
      id: `m:${message.id}`,
      createdAt: message.createdAt,
      message,
    })),
    ...activities.map((group) => ({
      type: 'activity' as const,
      id: `a:${group.id}`,
      createdAt: group.createdAt,
      group,
    })),
    ...notes.map((note) => ({
      type: 'note' as const,
      id: `n:${note.id}`,
      createdAt: note.createdAt,
      note,
    })),
  ].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

function renderStream(
  stream: ReadonlyArray<StreamItem>,
  currentUserID: string,
  deliveryByMessage?: ReadonlyMap<string, TimelineDelivery>,
  inboundAuthByMessageID?: ReadonlyMap<string, InboundAuthResults>,
) {
  let lastDay = '';
  return stream.map((item) => {
    const day = dayDividerLabel(item.createdAt);
    const divider =
      day !== lastDay ? (
        <div key={`${item.id}:day`} className="flex items-center gap-3 py-1">
          <div className="h-px flex-1 bg-line-quiet" />
          <span className="rounded-full bg-bg-elevated px-2 py-0.5 text-[11px] text-fg-tertiary">
            {day}
          </span>
          <div className="h-px flex-1 bg-line-quiet" />
        </div>
      ) : null;
    lastDay = day;

    if (item.type === 'activity') {
      return (
        <div key={item.id}>
          {divider}
          <TicketActivityRow group={item.group} />
        </div>
      );
    }

    if (item.type === 'note') {
      return (
        <div key={item.id} className="-mx-1">
          {divider}
          <NoteCard note={item.note} currentUserID={currentUserID} />
        </div>
      );
    }

    const isAgent = item.message.authorType === 'agent' || item.message.authorType === 'system';
    return (
      <div key={item.id}>
        {divider}
        <MessageBubble
          message={item.message}
          isSelf={item.message.authorUserID === currentUserID}
          delivery={deliveryByMessage?.get(item.message.id) ?? null}
          inboundAuth={!isAgent ? (inboundAuthByMessageID?.get(item.message.id) ?? null) : null}
        />
      </div>
    );
  });
}
