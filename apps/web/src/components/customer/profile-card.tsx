import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  cn,
  initialsFromName,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@salve/ui';
import {
  Activity,
  Copy,
  Mail,
  MapPin,
  MessageSquare,
  Phone,
  Plus,
  Ticket,
  UserRound,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { CustomFieldsBlock } from '@/components/conversation/custom-fields-block';
import { NoteCard } from '@/components/customer/note-card';
import { NoteComposer } from '@/components/customer/note-composer';
import {
  firstContactAt,
  lastContactAt,
  openConversationCount,
  relativeTime,
} from '@/components/timeline/timeline-format';
import type {
  TimelineCustomEvent,
  TimelineCustomer,
  TimelineCustomerNote,
  TimelineTicket,
} from '@/components/timeline/types';

interface CustomerProfileCardProps {
  customer: TimelineCustomer | null;
  currentUserID: string;
  tickets?: ReadonlyArray<TimelineTicket>;
  notes?: ReadonlyArray<TimelineCustomerNote>;
  events?: ReadonlyArray<TimelineCustomEvent>;
  className?: string;
  compact?: boolean;
}

export function CustomerProfileCard({
  customer,
  currentUserID,
  tickets = [],
  notes: customerNotes = [],
  events = [],
  className,
  compact,
}: CustomerProfileCardProps) {
  const [copied, setCopied] = useState(false);
  const [adding, setAdding] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const notes = useMemo(
    () =>
      [...customerNotes]
        .filter((note) => note.objectType === 'customer')
        .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt - a.createdAt),
    [customerNotes],
  );
  const visibleNotes = showAll ? notes : notes.slice(0, 3);
  const firstContact = firstContactAt(customer, tickets);
  const latestEventAt = events.reduce<number | null>(
    (latest, event) => Math.max(latest ?? 0, event.occurredAt),
    null,
  );
  const lastContact =
    maxTimestamp(
      lastContactAt(tickets),
      latestEventAt,
      customer?.lastSeenAt,
      customer?.updatedAt,
    ) ?? null;
  const recentEventCount = useMemo(() => events.filter(isRecentEvent).length, [events]);

  if (!customer) {
    return <CustomerProfileSkeleton className={className} />;
  }

  async function copyEmail() {
    await navigator.clipboard?.writeText(customer?.email ?? '');
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <section className={cn('flex flex-col gap-3', className)}>
      <div className="rounded-lg bg-bg-panel p-3 ring-1 ring-line-default">
        <div className="flex items-start gap-3">
          <Avatar size={36}>
            {customer.avatarUrl ? <AvatarImage src={customer.avatarUrl} alt="" /> : null}
            <AvatarFallback>
              {initialsFromName(customer.displayName ?? customer.name, customer.email)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[14px] font-semibold text-fg-primary">
              {customer.displayName ?? customer.name ?? customer.email}
            </h2>
            <div className="mt-1 flex min-w-0 items-center gap-1 text-[12px] text-fg-tertiary">
              <Mail className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{customer.email}</span>
            </div>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 w-7 shrink-0 p-0"
                onClick={copyEmail}
                aria-label="Copy email"
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{copied ? 'Copied' : 'Copy email'}</TooltipContent>
          </Tooltip>
        </div>

        <div className="mt-3 grid gap-1.5 text-[12px] text-fg-tertiary">
          <ProfileFact icon={Phone} label={customer.phone ?? 'No phone'} />
          <ProfileFact icon={MapPin} label={customer.location ?? 'No location'} />
          <ProfileFact icon={UserRound} label={`Customer since ${relativeTime(firstContact)}`} />
        </div>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(96px,1fr))] gap-2">
        <Metric label="Open" value={openConversationCount(tickets)} />
        <Metric label="Total" value={tickets.length} />
        <Metric label="First contact" value={firstContact ? relativeTime(firstContact) : 'never'} />
        <Metric label="Last contact" value={lastContact ? relativeTime(lastContact) : 'never'} />
        <Metric label="Events 30d" value={recentEventCount} />
      </div>

      {compact ? null : (
        <>
          <CustomFieldsBlock
            entity="customer"
            entityID={customer.id}
            record={customer}
            title="Customer fields"
          />
          <div className="rounded-lg bg-bg-panel ring-1 ring-line-default">
            <div className="flex items-center justify-between gap-2 px-3 py-2">
              <h3 className="text-[12px] font-semibold text-fg-primary">Customer notes</h3>
              <div className="flex items-center gap-2">
                <span className="text-[11px] tabular-nums text-fg-tertiary">{notes.length}</span>
                <button
                  type="button"
                  onClick={() => setAdding((open) => !open)}
                  aria-label="Add customer note"
                  className="grid h-6 w-6 place-items-center rounded-md text-fg-tertiary hover:bg-bg-elevated hover:text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            <div className="flex flex-col gap-2 border-t border-line-quiet px-3 py-2">
              {adding ? (
                <NoteComposer
                  scope="customer"
                  customerID={customer.id}
                  onClose={() => setAdding(false)}
                  onSaved={() => setAdding(false)}
                />
              ) : null}
              {notes.length === 0 && !adding ? (
                <p className="text-[12px] text-fg-tertiary">No customer notes yet.</p>
              ) : null}
              {visibleNotes.map((note) => (
                <NoteCard key={note.id} note={note} currentUserID={currentUserID} />
              ))}
              {notes.length > 3 ? (
                <button
                  type="button"
                  onClick={() => setShowAll((value) => !value)}
                  className="self-start text-[11px] font-medium text-fg-tertiary hover:text-fg-primary"
                >
                  {showAll ? 'Show fewer' : `Show all ${notes.length}`}
                </button>
              ) : null}
            </div>
          </div>

          <div className="rounded-lg bg-bg-panel ring-1 ring-line-default">
            <div className="flex items-center justify-between gap-2 px-3 py-2">
              <h3 className="text-[12px] font-semibold text-fg-primary">Recent activity</h3>
              <MessageSquare className="h-3.5 w-3.5 text-fg-tertiary" />
            </div>
            <div className="border-t border-line-quiet">
              {events.slice(0, 3).map((event) => (
                <EventRow key={event.id} event={event} />
              ))}
              {tickets.slice(0, 3).map((ticket) => (
                <div key={ticket.id} className="flex items-center gap-2 px-3 py-2">
                  <Ticket className="h-3.5 w-3.5 shrink-0 text-fg-tertiary" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] text-fg-secondary">{ticket.title}</p>
                    <p className="text-[11px] tabular-nums text-fg-tertiary">
                      {relativeTime(ticket.updatedAt)}
                    </p>
                  </div>
                </div>
              ))}
              {tickets.length === 0 && events.length === 0 ? (
                <p className="px-3 py-3 text-[12px] text-fg-tertiary">No conversations.</p>
              ) : null}
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function EventRow({ event }: { event: TimelineCustomEvent }) {
  const properties = eventPropertyChips(event.properties);
  return (
    <div className="flex items-start gap-2 px-3 py-2">
      <Activity className="mt-0.5 h-3.5 w-3.5 shrink-0 text-fg-tertiary" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12px] text-fg-secondary">{event.eventName}</p>
        {properties.length > 0 ? (
          <div className="mt-1 flex flex-wrap gap-1">
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
        <p className="mt-1 text-[11px] tabular-nums text-fg-tertiary">
          {relativeTime(event.occurredAt)}
        </p>
      </div>
    </div>
  );
}

function ProfileFact({ icon: Icon, label }: { icon: typeof Mail; label: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Icon className="h-3.5 w-3.5 shrink-0 text-fg-tertiary" />
      <span className="truncate">{label}</span>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg bg-bg-panel px-3 py-2 ring-1 ring-line-default">
      <p className="text-[11px] text-fg-tertiary">{label}</p>
      <p className="mt-1 truncate text-[13px] font-medium tabular-nums text-fg-primary">{value}</p>
    </div>
  );
}

function CustomerProfileSkeleton({ className }: { className?: string }) {
  return (
    <section className={cn('flex flex-col gap-3', className)}>
      <div className="rounded-lg bg-bg-panel p-3 ring-1 ring-line-default">
        <div className="flex items-start gap-3">
          <div className="h-9 w-9 rounded-full bg-bg-elevated" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-4 w-2/3 rounded bg-bg-elevated" />
            <div className="h-3 w-full rounded bg-bg-elevated" />
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {['open', 'total', 'first', 'last'].map((key) => (
          <div key={key} className="h-[58px] rounded-lg bg-bg-panel ring-1 ring-line-default">
            <div className="m-3 h-3 w-16 rounded bg-bg-elevated" />
          </div>
        ))}
      </div>
    </section>
  );
}

function maxTimestamp(...values: Array<number | null | undefined>) {
  const stamps = values.filter((value): value is number => typeof value === 'number');
  return stamps.length > 0 ? Math.max(...stamps) : null;
}

function isRecentEvent(event: TimelineCustomEvent) {
  return event.occurredAt >= Date.now() - 30 * 24 * 60 * 60 * 1000;
}

function eventPropertyChips(properties: unknown) {
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return [];
  return Object.entries(properties as Record<string, unknown>)
    .filter(([, value]) => value !== null && value !== undefined)
    .slice(0, 3)
    .map(([key, value]) => `${key}: ${String(value)}`);
}
