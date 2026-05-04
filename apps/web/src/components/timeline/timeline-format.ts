import { format, formatDistanceToNowStrict, isSameYear } from 'date-fns';
import type {
  TimelineCustomer,
  TimelineTicket,
  TimelineTicketPriority,
  TimelineTicketStatus,
  TimelineUser,
} from './types';

export function customerName(customer?: TimelineCustomer | null) {
  return customer?.displayName ?? customer?.name ?? customer?.email ?? 'Unknown customer';
}

export function userName(user?: TimelineUser | null) {
  return user?.name ?? user?.email ?? 'Unknown';
}

export function ticketNumber(ticket: Pick<TimelineTicket, 'shortID'>) {
  return ticket.shortID > 0 ? `#${ticket.shortID}` : 'new';
}

export function statusLabel(status: TimelineTicketStatus) {
  switch (status) {
    case 'in_progress':
      return 'In progress';
    case 'open':
      return 'Open';
    case 'snoozed':
      return 'Snoozed';
    case 'resolved':
      return 'Resolved';
    case 'closed':
      return 'Closed';
  }
}

export function priorityLabel(priority: TimelineTicketPriority) {
  switch (priority) {
    case 'urgent':
      return 'Urgent';
    case 'high':
      return 'High';
    case 'normal':
      return 'Normal';
    case 'low':
      return 'Low';
  }
}

export function statusDotClass(status: TimelineTicketStatus) {
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

export function statusBadgeVariant(
  status: TimelineTicketStatus,
): 'default' | 'success' | 'warning' | 'muted' {
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

export function priorityBadgeVariant(
  priority: TimelineTicketPriority,
): 'default' | 'warning' | 'danger' | 'muted' {
  switch (priority) {
    case 'urgent':
      return 'danger';
    case 'high':
      return 'warning';
    case 'low':
      return 'muted';
    case 'normal':
      return 'default';
  }
}

export function relativeTime(ms?: number | null) {
  if (!ms) return 'never';
  return formatDistanceToNowStrict(new Date(ms), { addSuffix: true });
}

export function compactRelativeTime(ms?: number | null) {
  if (!ms) return 'never';
  return formatDistanceToNowStrict(new Date(ms));
}

export function dayDividerLabel(ms: number) {
  const date = new Date(ms);
  return isSameYear(date, new Date()) ? format(date, 'MMM d') : format(date, 'MMM d, yyyy');
}

export function timestampLabel(ms: number) {
  return format(new Date(ms), 'MMM d, h:mm a');
}

export function stripHtml(html: string) {
  if (typeof document === 'undefined') return html.replace(/<[^>]+>/g, ' ');
  const node = document.createElement('div');
  node.innerHTML = html;
  return node.textContent ?? node.innerText ?? '';
}

export function messageSnippet(ticket: TimelineTicket) {
  const last = [...(ticket.messages ?? [])].sort((a, b) => b.createdAt - a.createdAt)[0];
  const source = last?.bodyText || (last?.bodyHtml ? stripHtml(last.bodyHtml) : ticket.description);
  const text = source?.replace(/\s+/g, ' ').trim();
  if (!text) return 'No messages';
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

export function openConversationCount(tickets: ReadonlyArray<TimelineTicket>) {
  return tickets.filter(
    (ticket) =>
      ticket.status === 'open' || ticket.status === 'in_progress' || ticket.status === 'snoozed',
  ).length;
}

export function lastContactAt(tickets: ReadonlyArray<TimelineTicket>) {
  const stamps = tickets.flatMap((ticket) => [
    ticket.updatedAt,
    ...(ticket.messages ?? []).map((message) => message.createdAt),
  ]);
  return stamps.length > 0 ? Math.max(...stamps) : null;
}

export function firstContactAt(
  customer: TimelineCustomer | null,
  tickets: ReadonlyArray<TimelineTicket>,
) {
  const stamps = [
    customer?.firstSeenAt,
    customer?.createdAt,
    ...tickets.map((ticket) => ticket.createdAt),
  ].filter((value): value is number => typeof value === 'number');
  return stamps.length > 0 ? Math.min(...stamps) : null;
}
