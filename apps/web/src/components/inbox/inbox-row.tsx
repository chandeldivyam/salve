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
} from '@opendesk/ui';
import type { InboxRow as InboxRowData, Ticket } from '@opendesk/zero-schema';
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
  onToggleSelect: (id: string, opts: { shiftRange?: boolean }) => void;
  /** Called when the row navigates (single click). Used to clear selection. */
  onNavigate: () => void;
}

export function InboxRow({
  ticket,
  isSelected,
  multiSelected,
  showCheckbox,
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
    <WorkbenchLink
      href={`/app/inbox/t/${ticket.id}`}
      source="ticket-row"
      onClick={onNavigate}
      className={cn(
        'group flex h-11 items-center gap-2 border-b border-border px-3 transition-colors',
        multiSelected
          ? 'bg-brand-soft/40 hover:bg-brand-soft/60'
          : isSelected
            ? 'bg-surface-muted'
            : 'hover:bg-surface-muted/50',
      )}
    >
      {/*
       * Leading slot. Two layered children, only one visible at a time:
       *  - status dot (default, hidden when checkbox visible)
       *  - checkbox button (forced visible when `showCheckbox`, otherwise
       *    revealed on row hover)
       * Wrapping <span> reserves the 14px column width so the title doesn't
       * shift when the affordance swaps.
       */}
      <span className="relative grid h-3.5 w-3.5 shrink-0 place-items-center">
        <span
          role="img"
          aria-label={`Status: ${ticket.status}`}
          className={cn(
            'absolute h-2.5 w-2.5 rounded-full transition-opacity duration-200',
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
            'absolute grid h-3.5 w-3.5 place-items-center rounded-[3px] border transition-opacity duration-200',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            multiSelected
              ? 'border-brand bg-brand text-brand-foreground opacity-100'
              : 'border-border bg-surface text-transparent',
            showCheckbox || multiSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
          )}
        >
          <Check
            className={cn(
              'h-2.5 w-2.5 transition-opacity',
              multiSelected ? 'opacity-100' : 'opacity-0',
            )}
            strokeWidth={3}
          />
        </button>
      </span>

      <div className="min-w-0 flex-1 truncate text-[13.5px] leading-tight">
        <span className="font-medium text-foreground">{ticket.title}</span>
        <span className="text-muted-foreground"> · </span>
        <span className="text-muted-foreground" title={customerLabel}>
          {customerLabel}
        </span>
      </div>
      {isHighPriority ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              role="img"
              aria-label={`Priority: ${ticket.priority}`}
              className={cn(
                'inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center',
                ticket.priority === 'urgent' ? 'text-danger' : 'text-warning',
              )}
            >
              <AlertTriangle className="h-3.5 w-3.5" />
            </span>
          </TooltipTrigger>
          <TooltipContent>{ticket.priority === 'urgent' ? 'Urgent' : 'High'}</TooltipContent>
        </Tooltip>
      ) : null}
      <span className="shrink-0">
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
      <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
        {formatDistanceToNowStrict(updated)}
      </span>
    </WorkbenchLink>
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
