import { cn } from '@opendesk/ui';
import {
  Bell,
  BellOff,
  CheckCircle2,
  Circle,
  Flag,
  Inbox,
  type LucideIcon,
  SlidersHorizontal,
  Tag,
  UserMinus,
  UserPlus,
} from 'lucide-react';
import { compactRelativeTime, priorityLabel, statusLabel, userName } from './timeline-format';
import type { TimelineAuditEvent, TimelineTicketPriority, TimelineTicketStatus } from './types';

export interface TicketActivityGroup {
  readonly id: string;
  readonly actorID: string | null;
  readonly actorName: string;
  readonly createdAt: number;
  readonly events: ReadonlyArray<TimelineAuditEvent>;
}

export function groupTicketActivities(
  events: ReadonlyArray<TimelineAuditEvent>,
): TicketActivityGroup[] {
  const sorted = [...events].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  const groups: TicketActivityGroup[] = [];

  for (const event of sorted) {
    const actorID = event.actorID ?? null;
    const actor = userName(event.actor);
    const previous = groups[groups.length - 1];
    if (
      previous &&
      previous.actorID === actorID &&
      Math.abs(event.createdAt - previous.createdAt) <= 60_000
    ) {
      groups[groups.length - 1] = {
        ...previous,
        createdAt: event.createdAt,
        events: [...previous.events, event],
      };
      continue;
    }
    groups.push({
      id: event.id,
      actorID,
      actorName: actor,
      createdAt: event.createdAt,
      events: [event],
    });
  }

  return groups;
}

export function TicketActivityRow({ group }: { group: TicketActivityGroup }) {
  const first = group.events[0];
  if (!first) return null;
  const Icon = group.events.length > 1 ? SlidersHorizontal : iconForKind(first);
  const label = group.events.length > 1 ? groupedLabel(group) : singleLabel(group.actorName, first);

  return (
    <div className="flex items-center gap-2 px-1 py-1.5 text-[12px] text-fg-tertiary">
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-bg-elevated text-fg-tertiary ring-1 ring-line-quiet">
        <Icon className={cn('h-3.5 w-3.5', first.kind === 'ticket.resolved' && 'text-success')} />
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="shrink-0 tabular-nums">{compactRelativeTime(group.createdAt)}</span>
    </div>
  );
}

function groupedLabel(group: TicketActivityGroup) {
  const actions = group.events.map((event) => actionNoun(event.kind));
  const unique = [...new Set(actions)].filter(Boolean);
  if (unique.length === 0) return `${group.actorName} updated this conversation`;
  return `${group.actorName} changed ${listFormat(unique)}`;
}

function singleLabel(actorName: string, event: TimelineAuditEvent) {
  switch (event.kind) {
    case 'ticket.assigned': {
      const assignee = payloadString(event.payload, ['assigneeName', 'assignee', 'toName', 'to']);
      return assignee ? `${actorName} assigned to ${assignee}` : `${actorName} assigned this`;
    }
    case 'ticket.unassigned':
      return `${actorName} unassigned this`;
    case 'ticket.status_changed': {
      const status = payloadString(event.payload, ['status', 'toStatus', 'nextStatus']);
      if (status === 'resolved') return `${actorName} resolved this conversation`;
      if (isTicketStatus(status)) return `${actorName} marked as ${statusLabel(status)}`;
      return `${actorName} changed status`;
    }
    case 'ticket.priority_changed': {
      const priority = payloadString(event.payload, ['priority', 'toPriority', 'nextPriority']);
      if (isTicketPriority(priority))
        return `${actorName} set priority to ${priorityLabel(priority)}`;
      return `${actorName} changed priority`;
    }
    case 'ticket.tag_added': {
      const tag = payloadString(event.payload, ['tagLabel', 'tag', 'label']);
      return tag ? `${actorName} added ${tag}` : `${actorName} added a tag`;
    }
    case 'ticket.tag_removed': {
      const tag = payloadString(event.payload, ['tagLabel', 'tag', 'label']);
      return tag ? `${actorName} removed ${tag}` : `${actorName} removed a tag`;
    }
    case 'ticket.snoozed': {
      const until = payloadString(event.payload, ['until', 'snoozedUntil']);
      return until ? `${actorName} snoozed until ${until}` : `${actorName} snoozed this`;
    }
    case 'ticket.unsnoozed':
      return `${actorName} woke this up`;
    case 'ticket.custom_field_changed': {
      const field = payloadString(event.payload, ['fieldName', 'field', 'displayName']);
      const value = payloadString(event.payload, ['value', 'nextValue', 'to']);
      if (field && value) return `${actorName} set ${field} to ${value}`;
      if (field) return `${actorName} updated ${field}`;
      return `${actorName} updated a field`;
    }
    default:
      return `${actorName} updated this conversation`;
  }
}

function iconForKind(event: TimelineAuditEvent): LucideIcon {
  switch (event.kind) {
    case 'ticket.assigned':
      return UserPlus;
    case 'ticket.unassigned':
      return UserMinus;
    case 'ticket.status_changed': {
      const status = payloadString(event.payload, ['status', 'toStatus', 'nextStatus']);
      if (status === 'resolved') return CheckCircle2;
      if (status === 'open') return Inbox;
      return Circle;
    }
    case 'ticket.priority_changed':
      return Flag;
    case 'ticket.tag_added':
    case 'ticket.tag_removed':
      return Tag;
    case 'ticket.snoozed':
      return BellOff;
    case 'ticket.unsnoozed':
      return Bell;
    case 'ticket.custom_field_changed':
      return SlidersHorizontal;
    default:
      return Circle;
  }
}

function actionNoun(kind: string) {
  switch (kind) {
    case 'ticket.assigned':
    case 'ticket.unassigned':
      return 'assignee';
    case 'ticket.status_changed':
      return 'status';
    case 'ticket.priority_changed':
      return 'priority';
    case 'ticket.tag_added':
    case 'ticket.tag_removed':
      return 'tags';
    case 'ticket.snoozed':
    case 'ticket.unsnoozed':
      return 'snooze';
    case 'ticket.custom_field_changed':
      return 'fields';
    default:
      return 'conversation';
  }
}

function payloadString(payload: unknown, keys: ReadonlyArray<string>) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  }
  return null;
}

function isTicketStatus(value: string | null): value is TimelineTicketStatus {
  return (
    value === 'open' ||
    value === 'in_progress' ||
    value === 'snoozed' ||
    value === 'resolved' ||
    value === 'closed'
  );
}

function isTicketPriority(value: string | null): value is TimelineTicketPriority {
  return value === 'low' || value === 'normal' || value === 'high' || value === 'urgent';
}

function listFormat(items: ReadonlyArray<string>) {
  if (items.length <= 1) return items[0] ?? '';
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}
