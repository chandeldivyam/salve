// Linear-tight inbox row — one-line, ~40-44px tall.
// The status dot encodes status; priority shows only as an icon for
// urgent/high; tags + status badge live on the detail view, not in the row.
//
// Phase 2 — multi-select: the leading slot doubles as a checkbox affordance.
// Hidden by default, fades in on hover, and is forced-visible when there's
// already a selection so users can extend by clicking neighbours.

import {
  Avatar,
  AvatarFallback,
  cn,
  initialsFromName,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@salve/ui';
import type { InboxRow as InboxRowData, Ticket } from '@salve/zero-schema';
import { formatDistanceToNowStrict } from 'date-fns';
import { AlertTriangle, Check } from 'lucide-react';
import type { MouseEvent } from 'react';
import { WorkbenchLink } from '@/components/workbench/workbench-link';

interface InboxRowProps {
  ticket: InboxRowData;
  isSelected: boolean;
  /** Multi-select state: row is in the bulk-action selection set. */
  multiSelected: boolean;
  /** Force the leading slot to render the checkbox unconditionally. */
  showCheckbox: boolean;
  /**
   * Keyboard cursor position. Renders a hover-equivalent highlight so the
   * user can see which row `x` / `Enter` will act on after `j`/`k`.
   */
  isCursor: boolean;
  /**
   * Pre-encoded query string (with leading `?`) to append to the ticket
   * detail href. Carries `view` + `f` from the inbox URL so the saved view
   * and chip filters survive the ticket detail round-trip — without this,
   * `BackToInbox` lands on the bare `/app/inbox` and the user loses their
   * filtered context.
   */
  inboxSearchQS: string;
  onToggleSelect: (id: string, opts: { shiftRange?: boolean }) => void;
  /** Called when the row navigates (single click). Used to clear selection. */
  onNavigate: () => void;
}

export function InboxRow({
  ticket,
  isSelected,
  multiSelected,
  showCheckbox,
  isCursor,
  inboxSearchQS,
  onToggleSelect,
  onNavigate,
}: InboxRowProps) {
  const customerLabel = ticket.customer?.name ?? ticket.customer?.email ?? 'No customer';
  const updated = new Date(ticket.updatedAt);
  const isHighPriority = ticket.priority === 'urgent' || ticket.priority === 'high';

  function handleCheckboxClick(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    onToggleSelect(ticket.id, { shiftRange: event.shiftKey });
  }

  return (
    <div
      data-ticket-id={ticket.id}
      data-ticket-label={ticket.shortID > 0 ? `#${ticket.shortID}` : ticket.title}
      className={cn(
        'group relative flex h-9 items-center gap-2.5 px-3',
        multiSelected
          ? 'bg-brand-soft/40 transition-none hover:bg-brand-soft/60'
          : isSelected
            ? 'bg-bg-elevated transition-none'
            : isCursor
              ? 'bg-bg-elevated transition-none'
              : 'transition-colors duration-150 hover:bg-bg-elevated',
      )}
    >
      {/*
       * Full-row navigation overlay. Stretches across the row so any click
       * inside the row navigates — no dead zones between fields. Sub-elements
       * that need their own click target (checkbox, customer link, tooltip
       * triggers) sit on a higher z-index so they intercept first.
       */}
      <WorkbenchLink
        href={`/app/inbox/t/${ticket.id}${inboxSearchQS}`}
        source="ticket-row"
        onClick={onNavigate}
        aria-label={ticket.title}
        className="absolute inset-0 z-0"
      >
        <span className="sr-only">{ticket.title}</span>
      </WorkbenchLink>

      {/*
       * Leading slot. Two layered children, only one visible at a time:
       *  - status dot (default, hidden when checkbox visible)
       *  - checkbox button (forced visible when `showCheckbox`, otherwise
       *    revealed on row hover)
       * The wrapping <span> reserves a 14px visual column so the title doesn't
       * shift when affordances swap. The button itself extends BEYOND the span
       * via negative insets so the click target is generous (full row height
       * vertically, ~half the gap to the title horizontally) — Linear-style.
       * pointer-events-none when invisible so clicks on the dot fall through
       * to the row overlay link (navigate), not the hidden checkbox.
       */}
      <span className="relative z-10 h-3.5 w-3.5 shrink-0">
        <span
          role="img"
          aria-label={`Status: ${ticket.status}`}
          className={cn(
            'pointer-events-none absolute inset-0 m-auto h-2 w-2 rounded-full transition-opacity duration-150',
            statusDotClass(ticket.status),
            showCheckbox ? 'opacity-0' : 'opacity-100 group-hover:opacity-0',
          )}
        />
        <button
          type="button"
          onClick={handleCheckboxClick}
          aria-label={multiSelected ? 'Deselect ticket' : 'Select ticket'}
          aria-pressed={multiSelected}
          className={cn(
            'absolute -inset-y-3 -left-3 -right-1.5 grid place-items-center rounded-[3px] transition-opacity duration-150',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            showCheckbox || multiSelected
              ? 'pointer-events-auto opacity-100'
              : 'pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100',
          )}
        >
          <span
            className={cn(
              'grid h-3.5 w-3.5 place-items-center rounded-[3px] border',
              multiSelected
                ? 'border-brand bg-brand text-brand-foreground'
                : 'border-border bg-surface text-transparent',
            )}
          >
            <Check
              className={cn(
                'h-2.5 w-2.5 transition-opacity',
                multiSelected ? 'opacity-100' : 'opacity-0',
              )}
              strokeWidth={3}
            />
          </span>
        </button>
      </span>

      <span className="pointer-events-none relative z-0 min-w-0 flex-1 truncate text-[14px] font-medium leading-tight tracking-[-0.011em] text-fg-primary">
        {ticket.title}
      </span>
      <span className="pointer-events-none relative z-0 text-[13px] text-fg-tertiary">·</span>
      {ticket.customer?.id ? (
        <WorkbenchLink
          href={`/app/customers/${ticket.customer.id}`}
          source="ticket-row"
          className="relative z-10 max-w-[140px] truncate text-[13px] text-fg-tertiary transition-colors hover:text-fg-primary hover:underline"
          title={customerLabel}
        >
          {customerLabel}
        </WorkbenchLink>
      ) : (
        <span
          className="pointer-events-none relative z-0 max-w-[140px] truncate text-[13px] text-fg-tertiary"
          title={customerLabel}
        >
          {customerLabel}
        </span>
      )}
      {isHighPriority ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              role="img"
              aria-label={`Priority: ${ticket.priority}`}
              className={cn(
                'relative z-10 inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center',
                ticket.priority === 'urgent' ? 'text-danger' : 'text-warning',
              )}
            >
              <AlertTriangle className="h-3.5 w-3.5" data-stroke="bold" />
            </span>
          </TooltipTrigger>
          <TooltipContent>{ticket.priority === 'urgent' ? 'Urgent' : 'High'}</TooltipContent>
        </Tooltip>
      ) : null}
      <span className="relative z-10 shrink-0">
        {ticket.assignee ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Avatar size={16}>
                <AvatarFallback>
                  {initialsFromName(ticket.assignee.name, ticket.assignee.email)}
                </AvatarFallback>
              </Avatar>
            </TooltipTrigger>
            <TooltipContent>{ticket.assignee.name ?? ticket.assignee.email}</TooltipContent>
          </Tooltip>
        ) : null}
      </span>
      <span className="pointer-events-none relative z-0 shrink-0 text-[11px] tabular-nums text-fg-tertiary">
        {formatDistanceToNowStrict(updated)}
      </span>
    </div>
  );
}

function statusDotClass(status: Ticket['status']): string {
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
  }
}
