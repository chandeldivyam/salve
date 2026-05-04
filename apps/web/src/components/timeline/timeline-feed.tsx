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
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@opendesk/ui';
import {
  ALL_TICKET_MESSAGE_LIMIT,
  CUSTOMER_EVENT_LIMIT,
  CUSTOMER_NOTE_LIMIT,
  CUSTOMER_TICKET_LIMIT,
  type Filter,
  INBOX_INITIAL_PAGE,
  queries,
  type ViewQuery,
  type ViewSort,
} from '@opendesk/zero-schema';
import { useQuery } from '@rocicorp/zero/react';
import { Link, useNavigate, useRouteContext, useSearch } from '@tanstack/react-router';
import { formatDistanceToNow } from 'date-fns';
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ChevronDown,
  Equal,
  ExternalLink,
  MoreHorizontal,
  PanelRightOpen,
  StickyNote,
  UserMinus,
  UserPlus,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Composer, type ComposerSendArgs } from '@/components/composer';
import { CustomFieldsBlock } from '@/components/conversation/custom-fields-block';
import { TagsField } from '@/components/conversation/tags-field';
import { NoteCard } from '@/components/customer/note-card';
import { NoteComposer } from '@/components/customer/note-composer';
import { CustomerProfileCard } from '@/components/customer/profile-card';
import { BackToInbox } from '@/components/inbox/back-to-inbox';
import { TicketDetailSkeleton } from '@/components/skeletons';
import { WorkbenchLink } from '@/components/workbench/workbench-link';
import { useCommandRegistry } from '@/lib/commands/registry';
import { BUILTIN_VIEWS, builtinViewByID, DEFAULT_VIEW_ID } from '@/lib/inbox/builtin-views';
import { decodeFilters } from '@/lib/inbox/url-filters';
import { TIMELINE_NEWER_VISIBLE, TIMELINE_OLDER_VISIBLE } from '@/lib/list-constants';
import type { SessionData } from '@/lib/session-loader';
import { useShortcut } from '@/lib/shortcuts';
import { useWorkbenchStore } from '@/lib/workbench';
import { useZero } from '@/lib/zero';
import { CACHE_FOREVER, CACHE_NAV, CACHE_TICKET_DETAIL } from '@/lib/zero-cache';
import { ConversationItem } from './conversation-item';
import { NewMessagesIndicator } from './new-messages-indicator';
import {
  customerName,
  dayDividerLabel,
  priorityBadgeVariant,
  priorityLabel,
  relativeTime,
  statusBadgeVariant,
  statusDotClass,
  statusLabel,
  ticketNumber,
} from './timeline-format';
import type {
  AuthSignal,
  InboundAuthResults,
  TimelineCustomEvent,
  TimelineCustomerNote,
  TimelineEmailAddress,
  TimelineMessage,
  TimelineTicket,
  TimelineTicketPriority,
  TimelineTicketStatus,
} from './types';

interface TimelineFeedProps {
  mode: 'single-ticket' | 'customer';
  anchorTicketID?: string;
  customerID?: string;
}

type SendMessageWithEmailAddress = Parameters<typeof mutators.message.send>[0] & {
  emailAddressID?: string;
};

type TimelineQueryCatalog = typeof queries & {
  ticketAnchor?: (args: {
    id: string;
    messageLimit?: number;
    activityLimit?: number;
  }) => ReturnType<typeof queries.ticketByID>;
};

const timelineQueries = queries as TimelineQueryCatalog;

const STATUS_OPTIONS: Array<{ id: TimelineTicketStatus; label: string }> = [
  { id: 'open', label: 'Open' },
  { id: 'in_progress', label: 'In progress' },
  { id: 'snoozed', label: 'Snoozed' },
  { id: 'resolved', label: 'Resolved' },
  { id: 'closed', label: 'Closed' },
];

const PRIORITY_OPTIONS: Array<{ id: TimelineTicketPriority; label: string }> = [
  { id: 'urgent', label: 'Urgent' },
  { id: 'high', label: 'High' },
  { id: 'normal', label: 'Normal' },
  { id: 'low', label: 'Low' },
];

const HEADER_PILL_CLASS =
  'inline-flex h-6 items-center gap-1 rounded-md border border-transparent px-1.5 text-[12px] text-fg-tertiary transition-colors hover:border-line-default hover:bg-bg-elevated hover:text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export function TimelineFeed({ mode, anchorTicketID, customerID }: TimelineFeedProps) {
  if (mode === 'single-ticket') {
    return anchorTicketID ? <SingleTicketTimeline ticketID={anchorTicketID} /> : null;
  }
  return customerID ? <CustomerTimeline customerID={customerID} /> : null;
}

function SingleTicketTimeline({ ticketID }: { ticketID: string }) {
  const navigate = useNavigate();
  const z = useZero();
  const { session } = useRouteContext({ from: '/app' }) as { session: SessionData };
  const currentUserID = session.user.id;
  const workspaceID = session.session.activeOrganizationId ?? null;
  const setActiveTabTitle = useWorkbenchStore((state) => state.setActiveTabTitle);
  const recordRecentTicket = useWorkbenchStore((state) => state.recordRecentTicket);
  const ticketQuery =
    timelineQueries.ticketAnchor?.({ id: ticketID, messageLimit: 51, activityLimit: 51 }) ??
    queries.ticketByID({ id: ticketID });
  const [rawTicket, ticketStatus] = useQuery(ticketQuery, CACHE_TICKET_DETAIL);
  const ticket = rawTicket as TimelineTicket | undefined;
  const customerID = ticket?.customer?.id ?? ticket?.customerID ?? '';
  const [members] = useQuery(queries.workspaceMembers(), CACHE_FOREVER);
  // j/k navigation in the ticket detail must walk the *same* list the
  // user came from — the active view's `ticketsForView` window. Reading
  // `view` + `f` from the URL keeps that window in sync without a
  // round-trip back through the inbox component. The query shape mirrors
  // `<InboxList>` exactly so Zero reuses the same pipeline, instead of
  // opening a parallel `inboxOpen` subscription (the legacy code did
  // that and it was the source of overlap the audit flagged).
  const inboxSearch = useSearch({ strict: false }) as { view?: string; f?: string };
  const navInboxQuery: {
    viewID: string;
    viewQuery: ViewQuery;
    sort: ViewSort;
    limit: number;
  } = useMemo(() => {
    const viewID = inboxSearch.view ?? DEFAULT_VIEW_ID;
    const builtin = builtinViewByID(viewID) ?? BUILTIN_VIEWS[0];
    const driftFilters = decodeFilters(inboxSearch.f);
    const filters: Filter[] =
      inboxSearch.f !== undefined ? driftFilters : ((builtin?.query.filters as Filter[]) ?? []);
    return {
      viewID,
      viewQuery: { filters, matchAll: true },
      sort: (builtin?.sort as ViewSort) ?? { field: 'updatedAt', direction: 'desc' },
      limit: INBOX_INITIAL_PAGE,
    };
  }, [inboxSearch.view, inboxSearch.f]);
  const [inboxList] = useQuery(
    queries.ticketsForView({
      viewID: navInboxQuery.viewID,
      viewQuery: navInboxQuery.viewQuery as unknown as {
        filters: unknown[];
        matchAll?: boolean;
        search?: string;
      },
      sort: navInboxQuery.sort,
      limit: navInboxQuery.limit,
    }),
    CACHE_FOREVER,
  );
  const [customerTicketRows] = useQuery(
    queries.customerTicketSummaries({ customerID, limit: CUSTOMER_TICKET_LIMIT }),
    CACHE_TICKET_DETAIL,
  );
  const [customerNoteRows] = useQuery(
    queries.customerNotes({ customerID, limit: CUSTOMER_NOTE_LIMIT }),
    CACHE_TICKET_DETAIL,
  );
  const [customerEventRows] = useQuery(
    queries.customerEvents({ customerID, limit: CUSTOMER_EVENT_LIMIT }),
    CACHE_TICKET_DETAIL,
  );
  const [outboundRows] = useQuery(queries.outboundMessagesByTicket({ id: ticketID }), CACHE_NAV);
  const [sendableEmailAddresses] = useQuery(queries.sendableEmailAddresses(), CACHE_FOREVER);
  const [inboundMessageRows] = useQuery(
    queries.inboundMessagesByTicket({ id: ticketID }),
    CACHE_NAV,
  );
  const [profileOpen, setProfileOpen] = useState(false);
  const [olderVisible, setOlderVisible] = useState(TIMELINE_OLDER_VISIBLE);
  const [newerVisible, setNewerVisible] = useState(TIMELINE_NEWER_VISIBLE);
  const [showAllInThread, setShowAllInThread] = useState(false);
  const [allMessageRows] = useQuery(
    queries.ticketMessagesAll({ ticketID, limit: ALL_TICKET_MESSAGE_LIMIT }),
    { ...CACHE_TICKET_DETAIL, enabled: showAllInThread },
  );
  const [allActivityRows] = useQuery(
    queries.ticketActivitiesAll({ ticketID, limit: ALL_TICKET_MESSAGE_LIMIT }),
    { ...CACHE_TICKET_DETAIL, enabled: showAllInThread },
  );

  const ticketsForCustomer = useMemo(() => {
    if (!customerID) return ticket ? [ticket] : [];
    const byID = new Map<string, TimelineTicket>();
    for (const row of customerTicketRows as ReadonlyArray<TimelineTicket>) {
      byID.set(row.id, row);
    }
    if (ticket) byID.set(ticket.id, ticket);
    // Sort by createdAt so a ticket's position in the timeline is anchored
    // to when it was opened, not when it was last touched. Otherwise an
    // assignment / status flip yanks the anchor to the bottom of the rail.
    return [...byID.values()].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  }, [customerID, customerTicketRows, ticket]);

  const anchorIndex = useMemo(
    () => (inboxList as ReadonlyArray<TimelineTicket>).findIndex((row) => row.id === ticketID),
    [inboxList, ticketID],
  );

  useShortcut(['j'], () => {
    const list = inboxList as ReadonlyArray<TimelineTicket>;
    if (list.length === 0) return;
    const next = anchorIndex < 0 ? 0 : Math.min(list.length - 1, anchorIndex + 1);
    const target = list[next];
    if (target && target.id !== ticketID) {
      navigate({ to: '/app/inbox/t/$ticketId', params: { ticketId: target.id } });
    }
  });
  useShortcut(['k'], () => {
    const list = inboxList as ReadonlyArray<TimelineTicket>;
    if (list.length === 0) return;
    const previous = anchorIndex < 0 ? 0 : Math.max(0, anchorIndex - 1);
    const target = list[previous];
    if (target && target.id !== ticketID) {
      navigate({ to: '/app/inbox/t/$ticketId', params: { ticketId: target.id } });
    }
  });

  useEffect(() => {
    if (!ticket) return;
    const title = ticket.shortID > 0 ? `#${ticket.shortID} ${ticket.title}` : ticket.title;
    setActiveTabTitle(workspaceID, title, 'ticket', 'ticket', `/app/inbox/t/${ticketID}`);
    recordRecentTicket(workspaceID, ticketID);
    useCommandRegistry.getState().setUrlTarget({
      pathname: `/app/inbox/t/${ticket.id}`,
      target: { kind: 'ticket', id: ticket.id, label: ticketNumber(ticket) },
    });
  }, [recordRecentTicket, setActiveTabTitle, ticket, ticketID, workspaceID]);

  if (!ticket) {
    if (ticketStatus?.type !== 'complete') return <TicketDetailSkeleton />;
    return (
      <TimelineNotFound title="Ticket not found" backHref="/app/inbox" backLabel="Back to inbox" />
    );
  }

  const deliveryByMessage = buildDeliveryByMessage(outboundRows);
  const inboundAuthByMessageID = buildInboundAuthByMessageID(inboundMessageRows);
  const preferredEmailAddressID = preferredInboundEmailAddressID(
    ticket,
    inboundMessageRows,
    ticket.messages ?? [],
    sendableEmailAddresses as ReadonlyArray<TimelineEmailAddress>,
  );
  const ticketForRender =
    showAllInThread && (allMessageRows.length > 0 || allActivityRows.length > 0)
      ? {
          ...ticket,
          messages: allMessageRows.length > 0 ? allMessageRows : ticket.messages,
          auditEvents: allActivityRows.length > 0 ? allActivityRows : ticket.auditEvents,
        }
      : ticket;
  const hasMoreThread =
    (ticket.messages?.length ?? 0) > 50 || (ticket.auditEvents?.length ?? 0) > 50;
  const activeTicket = ticket;
  const neighbours = splitNeighbours(ticketsForCustomer, ticket.id);
  const visibleOlder = neighbours.older.slice(-olderVisible);
  const visibleNewer = neighbours.newer.slice(0, newerVisible);
  const hiddenOlderCount = Math.max(0, neighbours.older.length - visibleOlder.length);
  const hiddenNewerCount = Math.max(0, neighbours.newer.length - visibleNewer.length);

  async function setStatus(next: TimelineTicketStatus) {
    if (next === 'resolved') {
      await z.mutate(mutators.ticket.close({ id: ticketID }));
    } else if (
      next === 'open' &&
      (activeTicket.status === 'resolved' || activeTicket.status === 'closed')
    ) {
      await z.mutate(mutators.ticket.reopen({ id: ticketID }));
    } else if (next === 'snoozed') {
      await z.mutate(
        mutators.ticket.snooze({ id: ticketID, until: Date.now() + 24 * 60 * 60 * 1000 }),
      );
    } else if (next === 'closed') {
      await z.mutate(mutators.ticket.close({ id: ticketID }));
    } else if (next === 'in_progress') {
      await z.mutate(mutators.ticket.reopen({ id: ticketID }));
    }
  }

  async function setPriority(priority: TimelineTicketPriority) {
    await z.mutate(mutators.ticket.update({ id: ticketID, priority }));
  }

  async function setAssignee(userID: string | null) {
    await z.mutate(mutators.ticket.assign({ id: ticketID, assigneeID: userID }));
  }

  async function onSend(args: ComposerSendArgs) {
    const payload: SendMessageWithEmailAddress = {
      id: crypto.randomUUID(),
      ticketID,
      bodyHTML: args.bodyHTML,
      bodyText: args.bodyText,
      isInternal: args.isInternal,
      attachments: args.attachments,
      ...(!args.isInternal && args.emailAddressID ? { emailAddressID: args.emailAddressID } : {}),
    };
    await z.mutate(mutators.message.send(payload as Parameters<typeof mutators.message.send>[0]));
  }

  const customerNotes = customerNoteRows as ReadonlyArray<TimelineCustomerNote>;
  const customerEvents = customerEventRows as ReadonlyArray<TimelineCustomEvent>;
  const rightRail = (
    <CustomerProfileCard
      customer={ticket.customer ?? null}
      currentUserID={currentUserID}
      tickets={ticketsForCustomer}
      notes={customerNotes}
      events={customerEvents}
    />
  );
  const laterEvents = customerEvents
    .filter((event) => event.occurredAt >= ticket.createdAt)
    .slice(0, 3);

  return (
    <div className="flex h-full flex-1 flex-col bg-bg-canvas">
      <TimelineHeader
        ticket={ticket}
        members={members as ReadonlyArray<WorkspaceMemberRow>}
        currentUserID={currentUserID}
        onStatusChange={setStatus}
        onPriorityChange={setPriority}
        onAssigneeChange={setAssignee}
        onOpenProfile={() => setProfileOpen(true)}
      />
      <div className="flex min-h-0 flex-1">
        <main className="relative min-w-0 flex-1 overflow-y-auto">
          <NewMessagesIndicator messages={ticket.messages ?? []} currentUserID={currentUserID} />
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 py-4 lg:px-6">
            {neighbours.older.length > 0 ? (
              <TimelineSectionLabel label={`Earlier conversations (${neighbours.older.length})`} />
            ) : null}
            {hiddenOlderCount > 0 ? (
              <TimelineShowMoreButton
                label={`Show earlier (${hiddenOlderCount})`}
                onClick={() =>
                  setOlderVisible((count) => Math.min(count + 10, neighbours.older.length))
                }
              />
            ) : null}
            {visibleOlder.map((neighbour) => (
              <ConversationItem
                key={neighbour.id}
                ticket={neighbour}
                expanded={false}
                currentUserID={currentUserID}
                onToggle={() =>
                  navigate({ to: '/app/inbox/t/$ticketId', params: { ticketId: neighbour.id } })
                }
              />
            ))}

            <ConversationItem
              ticket={ticketForRender as TimelineTicket}
              anchor
              expanded
              currentUserID={currentUserID}
              deliveryByMessage={deliveryByMessage}
              inboundAuthByMessageID={inboundAuthByMessageID}
              actions={<TagsField ticketID={ticketID} ticket={ticket} />}
              showEarlier={
                hasMoreThread && !showAllInThread ? (
                  <ShowEarlierButton onClick={() => setShowAllInThread(true)} />
                ) : null
              }
              noteComposer={
                customerID ? <TicketNoteToggle customerID={customerID} ticketID={ticketID} /> : null
              }
              onReopen={() => setStatus('open')}
              composer={
                <Composer
                  ticketID={ticketID}
                  userID={currentUserID}
                  workspaceID={workspaceID}
                  emailAddresses={[
                    ...(sendableEmailAddresses as ReadonlyArray<TimelineEmailAddress>),
                  ]}
                  preferredEmailAddressID={preferredEmailAddressID}
                  onSend={onSend}
                />
              }
            />

            {neighbours.newer.length > 0 ? (
              <TimelineSectionLabel label={`Later conversations (${neighbours.newer.length})`} />
            ) : null}
            {visibleNewer.map((neighbour) => (
              <ConversationItem
                key={neighbour.id}
                ticket={neighbour}
                expanded={false}
                currentUserID={currentUserID}
                onToggle={() =>
                  navigate({ to: '/app/inbox/t/$ticketId', params: { ticketId: neighbour.id } })
                }
              />
            ))}
            {hiddenNewerCount > 0 ? (
              <TimelineShowMoreButton
                label={`Show later (${hiddenNewerCount})`}
                onClick={() =>
                  setNewerVisible((count) => Math.min(count + 10, neighbours.newer.length))
                }
              />
            ) : null}
            {laterEvents.length > 0 ? <TimelineSectionLabel label="Customer events" /> : null}
            {laterEvents.map((event) => (
              <CustomerEventCard key={event.id} event={event} />
            ))}
          </div>
        </main>
        <aside className="hidden w-80 shrink-0 overflow-y-auto border-l border-line-default bg-bg-panel/60 p-3 xl:block">
          <div className="flex flex-col gap-3">
            {rightRail}
            <CustomFieldsBlock entity="ticket" entityID={ticketID} record={ticket} />
          </div>
        </aside>
      </div>
      <Sheet open={profileOpen} onOpenChange={setProfileOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Customer</SheetTitle>
            <SheetDescription>{ticket.customer?.email ?? 'Profile details'}</SheetDescription>
          </SheetHeader>
          <SheetBody>
            {rightRail}
            <CustomFieldsBlock entity="ticket" entityID={ticketID} record={ticket} />
          </SheetBody>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function CustomerTimeline({ customerID }: { customerID: string }) {
  const { session } = useRouteContext({ from: '/app' }) as { session: SessionData };
  const workspaceID = session.session.activeOrganizationId ?? null;
  const setActiveTabTitle = useWorkbenchStore((state) => state.setActiveTabTitle);
  const [rawCustomer, customerStatus] = useQuery(
    queries.customerByID({ id: customerID }),
    CACHE_TICKET_DETAIL,
  );
  const customer = rawCustomer as TimelineTicket['customer'] | undefined;
  const [rows] = useQuery(
    queries.customerTicketSummaries({ customerID, limit: CUSTOMER_TICKET_LIMIT }),
    CACHE_TICKET_DETAIL,
  );
  const [customerNoteRows] = useQuery(
    queries.customerNotes({ customerID, limit: CUSTOMER_NOTE_LIMIT }),
    CACHE_TICKET_DETAIL,
  );
  const [customerEventRows] = useQuery(
    queries.customerEvents({ customerID, limit: CUSTOMER_EVENT_LIMIT }),
    CACHE_TICKET_DETAIL,
  );
  const [expandedIDs, setExpandedIDs] = useState<ReadonlySet<string>>(new Set());
  const [feedVisible, setFeedVisible] = useState(30);
  const tickets = useMemo(
    () =>
      (rows as ReadonlyArray<TimelineTicket>)
        .slice(0, CUSTOMER_TICKET_LIMIT)
        .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id)),
    [rows],
  );
  const notes = customerNoteRows as ReadonlyArray<TimelineCustomerNote>;
  const events = customerEventRows as ReadonlyArray<TimelineCustomEvent>;
  const feedItems = useMemo(
    () => buildCustomerFeed(tickets, notes, events),
    [events, notes, tickets],
  );
  const visibleFeedItems = feedItems.slice(0, feedVisible);
  const hiddenFeedCount = Math.max(0, feedItems.length - visibleFeedItems.length);

  useEffect(() => {
    if (!customer) return;
    setActiveTabTitle(
      workspaceID,
      customerName(customer),
      'customer',
      'customer',
      `/app/customers/${customerID}`,
    );
  }, [customer, customerID, setActiveTabTitle, workspaceID]);

  function toggle(ticketID: string) {
    setExpandedIDs((current) => {
      const next = new Set(current);
      if (next.has(ticketID)) next.delete(ticketID);
      else next.add(ticketID);
      return next;
    });
  }

  if (!customer && customerStatus?.type !== 'complete') return <CustomerTimelineSkeleton />;
  if (!customer) {
    return (
      <TimelineNotFound
        title="Customer not found"
        backHref="/app/customers"
        backLabel="Back to customers"
      />
    );
  }

  return (
    <div className="flex h-full flex-1 flex-col bg-bg-canvas">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-line-default bg-bg-panel px-4 py-3 lg:px-6">
        <div className="min-w-0">
          <p className="text-[11px] text-fg-tertiary">Customer</p>
          <h1 className="truncate text-[18px] font-semibold text-fg-primary">
            {customerName(customer)}
          </h1>
        </div>
        <Button asChild size="sm" variant="outline">
          <Link to="/app/customers">All customers</Link>
        </Button>
      </header>
      <div className="flex min-h-0 flex-1">
        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 py-4 lg:px-6">
            {feedItems.length === 0 ? (
              <div className="rounded-lg bg-bg-panel px-4 py-8 text-center text-[13px] text-fg-tertiary ring-1 ring-line-default">
                No timeline activity for this customer.
              </div>
            ) : (
              <CustomerFeedItems
                items={visibleFeedItems}
                expandedIDs={expandedIDs}
                currentUserID={session.user.id}
                workspaceID={workspaceID}
                onToggle={toggle}
              />
            )}
            {hiddenFeedCount > 0 ? (
              <TimelineShowMoreButton
                label={`Show older timeline items (${hiddenFeedCount})`}
                onClick={() => setFeedVisible((count) => Math.min(count + 30, feedItems.length))}
              />
            ) : null}
          </div>
        </main>
        <aside className="hidden w-80 shrink-0 overflow-y-auto border-l border-line-default bg-bg-panel/60 p-3 xl:block">
          <CustomerProfileCard
            customer={customer}
            currentUserID={session.user.id}
            tickets={tickets}
            notes={notes}
            events={events}
          />
        </aside>
      </div>
    </div>
  );
}

type CustomerFeedItem =
  | { type: 'conversation'; id: string; createdAt: number; ticket: TimelineTicket }
  | { type: 'note'; id: string; createdAt: number; note: TimelineCustomerNote }
  | { type: 'event'; id: string; createdAt: number; event: TimelineCustomEvent };

function CustomerFeedItems({
  items,
  expandedIDs,
  currentUserID,
  workspaceID,
  onToggle,
}: {
  items: ReadonlyArray<CustomerFeedItem>;
  expandedIDs: ReadonlySet<string>;
  currentUserID: string;
  workspaceID: string | null;
  onToggle: (ticketID: string) => void;
}) {
  let lastDay = '';
  return items.map((item) => {
    const day = dayDividerLabel(item.createdAt);
    const divider =
      day !== lastDay ? <TimelineSectionLabel key={`${item.id}:day`} label={day} /> : null;
    lastDay = day;

    return (
      <div key={item.id} className="flex flex-col gap-3">
        {divider}
        {item.type === 'conversation' ? (
          <CustomerTimelineConversation
            ticket={item.ticket}
            expanded={expandedIDs.has(item.ticket.id)}
            currentUserID={currentUserID}
            workspaceID={workspaceID}
            onToggle={() => onToggle(item.ticket.id)}
          />
        ) : item.type === 'note' ? (
          <NoteCard note={item.note} currentUserID={currentUserID} />
        ) : (
          <CustomerEventCard event={item.event} />
        )}
      </div>
    );
  });
}

function CustomerTimelineConversation({
  ticket,
  expanded,
  currentUserID,
  workspaceID,
  onToggle,
}: {
  ticket: TimelineTicket;
  expanded: boolean;
  currentUserID: string;
  workspaceID: string | null;
  onToggle: () => void;
}) {
  if (expanded) {
    return (
      <ExpandedCustomerTimelineConversation
        ticket={ticket}
        currentUserID={currentUserID}
        workspaceID={workspaceID}
        onToggle={onToggle}
      />
    );
  }
  return (
    <ConversationItem
      ticket={ticket}
      expanded={false}
      currentUserID={currentUserID}
      onToggle={onToggle}
    />
  );
}

function ExpandedCustomerTimelineConversation({
  ticket,
  currentUserID,
  workspaceID,
  onToggle,
}: {
  ticket: TimelineTicket;
  currentUserID: string;
  workspaceID: string | null;
  onToggle: () => void;
}) {
  const z = useZero();
  const query =
    timelineQueries.ticketAnchor?.({ id: ticket.id, messageLimit: 51, activityLimit: 51 }) ??
    queries.ticketByID({ id: ticket.id });
  const [detail] = useQuery(query, CACHE_TICKET_DETAIL);
  const [outboundRows] = useQuery(queries.outboundMessagesByTicket({ id: ticket.id }), CACHE_NAV);
  const [sendableEmailAddresses] = useQuery(queries.sendableEmailAddresses(), CACHE_FOREVER);
  const [inboundMessageRows] = useQuery(
    queries.inboundMessagesByTicket({ id: ticket.id }),
    CACHE_NAV,
  );
  const [showAllInThread, setShowAllInThread] = useState(false);
  const [allMessageRows] = useQuery(
    queries.ticketMessagesAll({ ticketID: ticket.id, limit: ALL_TICKET_MESSAGE_LIMIT }),
    { ...CACHE_TICKET_DETAIL, enabled: showAllInThread },
  );
  const [allActivityRows] = useQuery(
    queries.ticketActivitiesAll({ ticketID: ticket.id, limit: ALL_TICKET_MESSAGE_LIMIT }),
    { ...CACHE_TICKET_DETAIL, enabled: showAllInThread },
  );
  const fullTicket = (detail as TimelineTicket | undefined) ?? ticket;
  const deliveryByMessage = buildDeliveryByMessage(outboundRows);
  const inboundAuthByMessageID = buildInboundAuthByMessageID(inboundMessageRows);
  const preferredEmailAddressID = preferredInboundEmailAddressID(
    fullTicket,
    inboundMessageRows,
    fullTicket.messages ?? [],
    sendableEmailAddresses as ReadonlyArray<TimelineEmailAddress>,
  );
  const ticketForRender =
    showAllInThread && (allMessageRows.length > 0 || allActivityRows.length > 0)
      ? {
          ...fullTicket,
          messages: allMessageRows.length > 0 ? allMessageRows : fullTicket.messages,
          auditEvents: allActivityRows.length > 0 ? allActivityRows : fullTicket.auditEvents,
        }
      : fullTicket;
  const hasMoreThread =
    (fullTicket.messages?.length ?? 0) > 50 || (fullTicket.auditEvents?.length ?? 0) > 50;

  async function onSend(args: ComposerSendArgs) {
    const payload: SendMessageWithEmailAddress = {
      id: crypto.randomUUID(),
      ticketID: fullTicket.id,
      bodyHTML: args.bodyHTML,
      bodyText: args.bodyText,
      isInternal: args.isInternal,
      attachments: args.attachments,
      ...(!args.isInternal && args.emailAddressID ? { emailAddressID: args.emailAddressID } : {}),
    };
    await z.mutate(mutators.message.send(payload as Parameters<typeof mutators.message.send>[0]));
  }

  const expandedCustomerID = fullTicket.customer?.id ?? fullTicket.customerID ?? '';

  return (
    <ConversationItem
      ticket={ticketForRender as TimelineTicket}
      expanded
      currentUserID={currentUserID}
      deliveryByMessage={deliveryByMessage}
      inboundAuthByMessageID={inboundAuthByMessageID}
      showEarlier={
        hasMoreThread && !showAllInThread ? (
          <ShowEarlierButton onClick={() => setShowAllInThread(true)} />
        ) : null
      }
      noteComposer={
        expandedCustomerID ? (
          <TicketNoteToggle customerID={expandedCustomerID} ticketID={fullTicket.id} />
        ) : null
      }
      onReopen={() => z.mutate(mutators.ticket.reopen({ id: fullTicket.id }))}
      onToggle={onToggle}
      composer={
        <Composer
          ticketID={fullTicket.id}
          userID={currentUserID}
          workspaceID={workspaceID}
          emailAddresses={[...(sendableEmailAddresses as ReadonlyArray<TimelineEmailAddress>)]}
          preferredEmailAddressID={preferredEmailAddressID}
          onSend={onSend}
        />
      }
    />
  );
}

function TicketNoteToggle({ customerID, ticketID }: { customerID: string; ticketID: string }) {
  const [open, setOpen] = useState(false);
  if (!customerID) return null;
  if (open) {
    return (
      <NoteComposer
        scope="ticket"
        customerID={customerID}
        ticketID={ticketID}
        onClose={() => setOpen(false)}
        onSaved={() => setOpen(false)}
      />
    );
  }
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="inline-flex h-7 items-center gap-1.5 rounded-md border border-dashed border-line-default px-2.5 text-[12px] text-fg-tertiary transition-colors hover:border-line-strong hover:bg-bg-elevated/40 hover:text-fg-primary"
    >
      <StickyNote className="h-3.5 w-3.5" />
      Add conversation note
    </button>
  );
}

function CustomerEventCard({ event }: { event: TimelineCustomEvent }) {
  const properties = eventPropertyChips(event.properties);
  return (
    <article className="rounded-lg bg-bg-panel px-3 py-2.5 ring-1 ring-line-default">
      <div className="flex items-start gap-2">
        <Activity className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-500" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-[12px] font-medium text-fg-primary">{event.eventName}</p>
            <span className="shrink-0 text-[11px] tabular-nums text-fg-tertiary">
              {relativeTime(event.occurredAt)}
            </span>
          </div>
          {properties.length > 0 ? (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {properties.map((property) => (
                <span
                  key={property}
                  className="max-w-full truncate rounded-md bg-bg-elevated px-1.5 py-0.5 text-[10px] text-fg-tertiary"
                >
                  {property}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function buildCustomerFeed(
  tickets: ReadonlyArray<TimelineTicket>,
  notes: ReadonlyArray<TimelineCustomerNote>,
  events: ReadonlyArray<TimelineCustomEvent>,
): CustomerFeedItem[] {
  return [
    ...tickets.map((ticket) => ({
      type: 'conversation' as const,
      id: `conversation:${ticket.id}`,
      createdAt: ticket.updatedAt,
      ticket,
    })),
    ...notes
      .filter((note) => note.objectType === 'customer')
      .map((note) => ({
        type: 'note' as const,
        id: `note:${note.id}`,
        createdAt: note.createdAt,
        note,
      })),
    ...events.map((event) => ({
      type: 'event' as const,
      id: `event:${event.id}`,
      createdAt: event.occurredAt,
      event,
    })),
  ].sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
}

function eventPropertyChips(properties: unknown) {
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return [];
  return Object.entries(properties as Record<string, unknown>)
    .filter(([, value]) => value !== null && value !== undefined)
    .slice(0, 3)
    .map(([key, value]) => `${key}: ${String(value)}`);
}

interface WorkspaceMemberRow {
  readonly id: string;
  readonly userId: string;
  readonly user?: {
    readonly name?: string | null;
    readonly email?: string | null;
  } | null;
}

function TimelineHeader({
  ticket,
  members,
  currentUserID,
  onStatusChange,
  onPriorityChange,
  onAssigneeChange,
  onOpenProfile,
}: {
  ticket: TimelineTicket;
  members: ReadonlyArray<WorkspaceMemberRow>;
  currentUserID: string;
  onStatusChange: (status: TimelineTicketStatus) => void;
  onPriorityChange: (priority: TimelineTicketPriority) => void;
  onAssigneeChange: (userID: string | null) => void;
  onOpenProfile: () => void;
}) {
  const customer = ticket.customer ?? null;
  const customerLabel = customerName(customer);

  return (
    <header className="flex shrink-0 flex-col gap-1.5 border-b border-line-default bg-bg-panel px-4 py-3 lg:px-6">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 text-[12px] text-fg-tertiary">
          <BackToInbox />
          <span aria-hidden="true">·</span>
          {customer?.id ? (
            <WorkbenchLink
              href={`/app/customers/${customer.id}`}
              source="ticket-row"
              className="truncate hover:text-fg-primary hover:underline"
              title={customerLabel}
            >
              {customerLabel}
            </WorkbenchLink>
          ) : (
            <span className="truncate" title={customerLabel}>
              {customerLabel}
            </span>
          )}
          <span aria-hidden="true">·</span>
          <span className="tabular-nums">{ticketNumber(ticket)}</span>
        </div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 px-2 xl:hidden"
          onClick={onOpenProfile}
        >
          <PanelRightOpen className="h-3.5 w-3.5" />
          Customer
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Ticket actions"
              className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-fg-tertiary hover:bg-bg-elevated hover:text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => onStatusChange('snoozed')}>
              Snooze 24h
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onStatusChange('resolved')}>Close</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => window.open(window.location.href, '_blank')}>
              <ExternalLink className="h-3.5 w-3.5" /> Open in new tab
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <h1 className="truncate text-[18px] font-semibold text-fg-primary" title={ticket.title}>
        {ticket.title}
      </h1>

      <div className="flex flex-wrap items-center gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className={HEADER_PILL_CLASS}>
              <span
                className={cn('h-2 w-2 shrink-0 rounded-full', statusDotClass(ticket.status))}
              />
              <span className="text-fg-primary">{statusLabel(ticket.status)}</span>
              <ChevronDown className="h-3 w-3 opacity-60" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel>Set status</DropdownMenuLabel>
            {STATUS_OPTIONS.map((status) => (
              <DropdownMenuItem key={status.id} onSelect={() => onStatusChange(status.id)}>
                <Badge variant={statusBadgeVariant(status.id)}>{status.label}</Badge>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className={HEADER_PILL_CLASS}>
              <PriorityIcon priority={ticket.priority} />
              <span className="text-fg-primary">{priorityLabel(ticket.priority)}</span>
              <ChevronDown className="h-3 w-3 opacity-60" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel>Set priority</DropdownMenuLabel>
            {PRIORITY_OPTIONS.map((priority) => (
              <DropdownMenuItem key={priority.id} onSelect={() => onPriorityChange(priority.id)}>
                <Badge variant={priorityBadgeVariant(priority.id)}>{priority.label}</Badge>
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
                  <span className="text-fg-primary">
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
            <DropdownMenuItem onSelect={() => onAssigneeChange(currentUserID)}>
              <UserPlus className="h-3.5 w-3.5" /> Assign to me
            </DropdownMenuItem>
            {ticket.assigneeID ? (
              <DropdownMenuItem onSelect={() => onAssigneeChange(null)}>
                <UserMinus className="h-3.5 w-3.5" /> Unassign
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
            {members.length === 0 ? (
              <DropdownMenuItem disabled>No teammates</DropdownMenuItem>
            ) : (
              members.map((member) => (
                <DropdownMenuItem key={member.id} onSelect={() => onAssigneeChange(member.userId)}>
                  <Avatar size={18}>
                    <AvatarFallback>
                      {initialsFromName(member.user?.name, member.user?.email)}
                    </AvatarFallback>
                  </Avatar>
                  <span>{member.user?.name ?? member.user?.email ?? member.userId}</span>
                </DropdownMenuItem>
              ))
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="ml-auto text-[11px] tabular-nums text-fg-tertiary">
          Updated {formatDistanceToNow(new Date(ticket.updatedAt), { addSuffix: true })}
        </div>
      </div>
    </header>
  );
}

function PriorityIcon({ priority }: { priority: TimelineTicketPriority }) {
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

function TimelineSectionLabel({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 py-1">
      <div className="h-px flex-1 bg-line-quiet" />
      <span className="rounded-full bg-bg-elevated px-2 py-0.5 text-[11px] text-fg-tertiary">
        {label}
      </span>
      <div className="h-px flex-1 bg-line-quiet" />
    </div>
  );
}

function TimelineShowMoreButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <div className="flex justify-center py-1">
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-7 rounded-md px-2.5 text-[12px]"
        onClick={onClick}
      >
        {label}
      </Button>
    </div>
  );
}

function ShowEarlierButton({ onClick }: { onClick: () => void }) {
  return (
    <div className="flex justify-center">
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-7 rounded-md px-2.5 text-[11px] font-medium text-fg-tertiary hover:text-fg-primary"
        onClick={onClick}
      >
        Show earlier in this conversation
      </Button>
    </div>
  );
}

function TimelineNotFound({
  title,
  backHref,
  backLabel,
}: {
  title: string;
  backHref: string;
  backLabel: string;
}) {
  return (
    <div className="flex flex-1 items-center justify-center px-6">
      <div className="max-w-sm rounded-lg bg-bg-panel p-6 text-center ring-1 ring-line-default">
        <p className="text-[13px] font-semibold text-fg-primary">{title}</p>
        <p className="mt-1 text-[12px] text-fg-tertiary">
          It does not exist or is not available in this workspace.
        </p>
        <Button asChild className="mt-4" variant="outline" size="sm">
          <Link to={backHref}>{backLabel}</Link>
        </Button>
      </div>
    </div>
  );
}

function CustomerTimelineSkeleton() {
  return (
    <div className="flex h-full flex-1 bg-bg-canvas">
      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 py-4 lg:px-6">
          {[0, 1, 2].map((row) => (
            <div key={row} className="h-[76px] rounded-lg bg-bg-panel ring-1 ring-line-default">
              <div className="m-3 h-3 w-2/3 rounded bg-bg-elevated" />
              <div className="mx-3 mt-2 h-3 w-1/2 rounded bg-bg-elevated" />
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}

function splitNeighbours(tickets: ReadonlyArray<TimelineTicket>, anchorID: string) {
  const anchor = tickets.find((ticket) => ticket.id === anchorID);
  if (!anchor) return { older: [], newer: [] };
  return {
    older: tickets.filter(
      (ticket) => ticket.id !== anchorID && ticket.createdAt < anchor.createdAt,
    ),
    newer: tickets.filter(
      (ticket) => ticket.id !== anchorID && ticket.createdAt >= anchor.createdAt,
    ),
  };
}

function buildDeliveryByMessage(rows: ReadonlyArray<unknown>) {
  const map = new Map<string, { status: string; error?: string | null }>();
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const record = row as Record<string, unknown>;
    const messageID = record.messageID;
    const status = record.status;
    if (typeof messageID !== 'string' || typeof status !== 'string') continue;
    map.set(messageID, {
      status,
      error: typeof record.error === 'string' ? record.error : null,
    });
  }
  return map;
}

interface InboundRowReader {
  readonly id: string;
  readonly messageID?: string | null;
  readonly messageId?: string | null;
  readonly processedMessageID?: string | null;
  readonly processedMessageId?: string | null;
  readonly message?: { readonly id?: string | null } | null;
  readonly processedMessage?: { readonly id?: string | null } | null;
  readonly emailAddressID?: string | null;
  readonly emailAddressId?: string | null;
  readonly addressID?: string | null;
  readonly addressId?: string | null;
  readonly emailAddress?: {
    readonly id?: string | null;
    readonly fullAddress?: string | null;
  } | null;
  readonly destinationAddress?: string | null;
  readonly envelopeTo?: string | null;
  readonly recipientAddress?: string | null;
  readonly headers?: unknown;
  readonly authenticationResults?: unknown;
  readonly authResults?: unknown;
  readonly providerMeta?: unknown;
  readonly receivedAt?: number | null;
  readonly createdAt?: number | null;
}

function buildInboundAuthByMessageID(
  rows: ReadonlyArray<unknown>,
): Map<string, InboundAuthResults> {
  const byMessageID = new Map<string, InboundAuthResults>();
  for (const row of rows as ReadonlyArray<InboundRowReader>) {
    const messageID = inboundRowMessageID(row);
    if (!messageID) continue;
    byMessageID.set(messageID, authResultsFromInboundRow(row));
  }
  return byMessageID;
}

function preferredInboundEmailAddressID(
  ticket: TimelineTicket,
  inboundRows: ReadonlyArray<unknown>,
  messages: ReadonlyArray<TimelineMessage>,
  sendableAddresses: ReadonlyArray<TimelineEmailAddress>,
): string | null {
  const sendableIDs = new Set(sendableAddresses.map((address) => address.id));
  const sendableByAddress = new Map(
    sendableAddresses.map((address) => [address.fullAddress.toLowerCase(), address.id]),
  );
  const sortedInboundRows = [...(inboundRows as ReadonlyArray<InboundRowReader>)].sort(
    (a, b) => inboundRowTimestamp(b) - inboundRowTimestamp(a),
  );
  const candidates = [
    ...sortedInboundRows.map(inboundRowAddressID),
    ...[...messages].reverse().map((message) => stringProperty(message, 'emailAddressID')),
    ...[...messages].reverse().map((message) => stringProperty(message, 'emailAddressId')),
    stringProperty(ticket, 'emailAddressID'),
    stringProperty(ticket, 'emailAddressId'),
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
