import { mutators } from '@salve/mutators';
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  Clock,
  Copy,
  HelpCircle,
  Inbox,
  Settings,
  UserMinus,
  UserPlus,
  Users,
} from 'lucide-react';
import type { BulkPriority, BulkStatus } from '@/components/inbox/bulk-actions';
import {
  bulkAssign,
  bulkClose,
  bulkSetPriority,
  bulkSetStatus,
  bulkSnooze24h,
} from '@/components/inbox/bulk-actions';
import type { Command, CommandContext, Target } from './registry';

type ZeroMutate = {
  mutate: (mutation: unknown) => unknown;
};

const SNOOZE_24H_MS = 24 * 60 * 60 * 1000;

const STATUS_OPTIONS: ReadonlyArray<{ id: BulkStatus; label: string }> = [
  { id: 'open', label: 'Open' },
  { id: 'in_progress', label: 'In progress' },
  { id: 'snoozed', label: 'Snoozed' },
  { id: 'resolved', label: 'Resolved' },
  { id: 'closed', label: 'Closed' },
];

const PRIORITY_OPTIONS: ReadonlyArray<{ id: BulkPriority; label: string }> = [
  { id: 'urgent', label: 'Urgent' },
  { id: 'high', label: 'High' },
  { id: 'normal', label: 'Normal' },
  { id: 'low', label: 'Low' },
];

export const commandCatalog: ReadonlyArray<Command> = [
  {
    id: 'nav.inbox',
    label: 'Go to inbox',
    group: 'Navigation',
    description: 'Open the inbox',
    icon: Inbox,
    accepts: acceptsAny,
    run: (_target, ctx) => ctx.navigateHref('/app/inbox'),
    order: 10,
  },
  {
    id: 'nav.customers',
    label: 'Go to customers',
    group: 'Navigation',
    description: 'Open customer profiles',
    icon: Users,
    accepts: acceptsAny,
    run: (_target, ctx) => ctx.navigateHref('/app/customers'),
    order: 20,
  },
  {
    id: 'nav.settings',
    label: 'Go to settings',
    group: 'Settings',
    description: 'Open workspace settings',
    icon: Settings,
    accepts: acceptsAny,
    run: (_target, ctx) => ctx.navigateHref('/app/settings/setup'),
    order: 30,
  },
  {
    id: 'help.shortcuts',
    label: 'Show keyboard shortcuts',
    group: 'Help',
    description: 'Open the shortcut cheatsheet',
    icon: HelpCircle,
    accepts: acceptsAny,
    run: (_target, ctx) => ctx.openHelp(),
    order: 40,
  },
  {
    id: 'ticket.assign.me',
    label: 'Assign to me',
    group: 'Ticket',
    description: 'Make yourself the assignee',
    icon: UserPlus,
    accepts: acceptsTicketOrBulk,
    run: (target, ctx) => assignTicketTarget(target, ctx, ctx.userID),
    order: 100,
  },
  {
    id: 'ticket.unassign',
    label: 'Unassign',
    group: 'Ticket',
    description: 'Remove the current assignee',
    icon: UserMinus,
    accepts: acceptsTicketOrBulk,
    run: (target, ctx) => assignTicketTarget(target, ctx, null),
    order: 110,
  },
  {
    id: 'ticket.close',
    label: 'Close ticket',
    group: 'Ticket',
    description: 'Resolve the target ticket',
    icon: Archive,
    accepts: acceptsTicketOrBulk,
    run: (target, ctx) => closeTicketTarget(target, ctx),
    order: 120,
  },
  {
    id: 'ticket.reopen',
    label: 'Reopen ticket',
    group: 'Ticket',
    description: 'Move the ticket back to open',
    icon: CheckCircle2,
    accepts: acceptsTicketOrBulk,
    run: (target, ctx) => setStatusTarget(target, ctx, 'open'),
    order: 130,
  },
  {
    id: 'ticket.snooze.24h',
    label: 'Snooze 24h',
    group: 'Ticket',
    description: 'Hide the ticket until tomorrow',
    icon: Clock,
    accepts: acceptsTicketOrBulk,
    run: (target, ctx) => snoozeTarget(target, ctx),
    order: 140,
  },
  {
    id: 'ticket.priority',
    label: 'Set priority…',
    group: 'Ticket',
    description: 'Choose a priority',
    icon: AlertTriangle,
    accepts: acceptsTicketOrBulk,
    run: () => undefined,
    subPage: (_target, ctx) => ({
      id: 'ticket.priority',
      title: 'Set priority to…',
      bindParentTarget: true,
      commands: PRIORITY_OPTIONS.map((option, index) => ({
        id: `ticket.priority.${option.id}`,
        label: option.label,
        group: 'Ticket',
        accepts: acceptsTicketOrBulk,
        run: (subTarget) => setPriorityTarget(subTarget, ctx, option.id),
        order: index,
      })),
    }),
    order: 150,
  },
  {
    id: 'ticket.status',
    label: 'Set status…',
    group: 'Ticket',
    description: 'Choose a status',
    icon: CheckCircle2,
    accepts: acceptsTicketOrBulk,
    run: () => undefined,
    subPage: (_target, ctx) => ({
      id: 'ticket.status',
      title: 'Set status to…',
      bindParentTarget: true,
      commands: STATUS_OPTIONS.map((option, index) => ({
        id: `ticket.status.${option.id}`,
        label: option.label,
        group: 'Ticket',
        accepts: acceptsTicketOrBulk,
        run: (subTarget) => setStatusTarget(subTarget, ctx, option.id),
        order: index,
      })),
    }),
    order: 160,
  },
  {
    id: 'ticket.copy.id',
    label: 'Copy ticket ID',
    group: 'Ticket',
    description: 'Copy the target ticket identifier',
    icon: Copy,
    accepts: acceptsTicket,
    run: (target) => {
      if (!acceptsTicket(target)) return;
      void navigator.clipboard?.writeText(target.id);
    },
    order: 170,
  },
  {
    id: 'ticket.copy.url',
    label: 'Copy ticket URL',
    group: 'Ticket',
    description: 'Copy a link to the ticket',
    icon: Copy,
    accepts: acceptsTicket,
    run: (target) => {
      if (!acceptsTicket(target)) return;
      void navigator.clipboard?.writeText(`${window.location.origin}/app/inbox/t/${target.id}`);
    },
    order: 180,
  },
];

export function acceptsAny(target: Target): boolean {
  return (
    target.kind === 'none' ||
    target.kind === 'ticket' ||
    target.kind === 'customer' ||
    target.kind === 'bulk'
  );
}

export function acceptsTicket(target: Target): target is Extract<Target, { kind: 'ticket' }> {
  return target.kind === 'ticket';
}

export function acceptsTicketOrBulk(
  target: Target,
): target is Extract<Target, { kind: 'ticket' | 'bulk' }> {
  return target.kind === 'ticket' || target.kind === 'bulk';
}

function zero(ctx: CommandContext): ZeroMutate {
  return ctx.z as ZeroMutate;
}

function bulkOpts(target: Extract<Target, { kind: 'bulk' }>, ctx: CommandContext) {
  return { ids: target.ids, z: zero(ctx) as never };
}

function assignTicketTarget(target: Target, ctx: CommandContext, assigneeID: string | null) {
  if (!acceptsTicketOrBulk(target)) return;
  if (target.kind === 'bulk') return bulkAssign(bulkOpts(target, ctx), assigneeID);
  void zero(ctx).mutate(mutators.ticket.assign({ id: target.id, assigneeID }));
}

function closeTicketTarget(target: Target, ctx: CommandContext) {
  if (!acceptsTicketOrBulk(target)) return;
  if (target.kind === 'bulk') return bulkClose(bulkOpts(target, ctx));
  void zero(ctx).mutate(mutators.ticket.close({ id: target.id }));
}

function snoozeTarget(target: Target, ctx: CommandContext) {
  if (!acceptsTicketOrBulk(target)) return;
  if (target.kind === 'bulk') return bulkSnooze24h(bulkOpts(target, ctx));
  void zero(ctx).mutate(
    mutators.ticket.snooze({ id: target.id, until: Date.now() + SNOOZE_24H_MS }),
  );
}

function setPriorityTarget(target: Target, ctx: CommandContext, priority: BulkPriority) {
  if (!acceptsTicketOrBulk(target)) return;
  if (target.kind === 'bulk') return bulkSetPriority(bulkOpts(target, ctx), priority);
  void zero(ctx).mutate(mutators.ticket.update({ id: target.id, priority }));
}

function setStatusTarget(target: Target, ctx: CommandContext, status: BulkStatus) {
  if (!acceptsTicketOrBulk(target)) return;
  if (target.kind === 'bulk') return bulkSetStatus(bulkOpts(target, ctx), status);
  if (status === 'closed' || status === 'resolved') {
    void zero(ctx).mutate(mutators.ticket.close({ id: target.id }));
    return;
  }
  if (status === 'snoozed') {
    void zero(ctx).mutate(
      mutators.ticket.snooze({ id: target.id, until: Date.now() + SNOOZE_24H_MS }),
    );
    return;
  }
  void zero(ctx).mutate(mutators.ticket.reopen({ id: target.id }));
}
