// Bulk-action bar — Linear-style overlay pinned to the bottom of the
// inbox list pane when one or more rows are selected. Each action button
// is either a DropdownMenu (status / priority / assign) or fires a
// mutator immediately (snooze 24h, close).
//
// Sits OUTSIDE the virtualized scroll area (positioned absolute) so the
// overlay never pushes rows or triggers re-measurement.

import { useQuery } from '@rocicorp/zero/react';
import {
  Avatar,
  AvatarFallback,
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  initialsFromName,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@salve/ui';
import { queries } from '@salve/zero-schema';
import { AlertTriangle, ChevronDown, Clock, Tag, UserPlus, X } from 'lucide-react';
import {
  type BulkPriority,
  type BulkStatus,
  bulkAssign,
  bulkClose,
  bulkSetPriority,
  bulkSetStatus,
  bulkSnooze24h,
} from '@/components/inbox/bulk-actions';
import { useInboxSelectionStore } from '@/lib/inbox-selection';
import { useZero } from '@/lib/zero';
import { CACHE_FOREVER } from '@/lib/zero-cache';

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

interface BulkActionBarProps {
  currentUserID: string;
}

export function BulkActionBar({ currentUserID }: BulkActionBarProps) {
  const z = useZero();
  const ids = useInboxSelectionStore((s) => s.ids);
  const clear = useInboxSelectionStore((s) => s.clear);
  const [memberRows] = useQuery(queries.workspaceMembers(), CACHE_FOREVER);

  if (ids.length === 0) return null;

  const runOpts = { ids, z, onSuccess: clear } as const;

  const teammates = memberRows;

  return (
    <div
      role="toolbar"
      aria-label="Bulk actions"
      className="pointer-events-auto absolute inset-x-3 bottom-3 z-20 flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 shadow-lg"
    >
      <span className="px-1.5 text-xs font-medium text-foreground tabular-nums">
        {ids.length} selected
      </span>
      <span className="h-5 w-px bg-border" aria-hidden="true" />

      {/* Assign */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2 text-xs">
            <UserPlus className="h-3.5 w-3.5" /> Assign
            <ChevronDown className="h-3 w-3 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
          <DropdownMenuLabel>Assign to…</DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => bulkAssign(runOpts, currentUserID)}>
            Assign to me
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => bulkAssign(runOpts, null)}>Unassign</DropdownMenuItem>
          {teammates.length > 0 ? <DropdownMenuSeparator /> : null}
          {teammates.map((m) => (
            <DropdownMenuItem
              key={m.id}
              onSelect={() => bulkAssign(runOpts, m.userId)}
              className="gap-2"
            >
              <Avatar size={16}>
                <AvatarFallback>{initialsFromName(m.user?.name, m.user?.email)}</AvatarFallback>
              </Avatar>
              <span className="truncate">{m.user?.name ?? m.user?.email ?? m.userId}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Status */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2 text-xs">
            Set status
            <ChevronDown className="h-3 w-3 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>Set status</DropdownMenuLabel>
          {STATUS_OPTIONS.map((s) => (
            <DropdownMenuItem key={s.id} onSelect={() => bulkSetStatus(runOpts, s.id)}>
              {s.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Priority */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2 text-xs">
            <AlertTriangle className="h-3.5 w-3.5" /> Set priority
            <ChevronDown className="h-3 w-3 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>Set priority</DropdownMenuLabel>
          {PRIORITY_OPTIONS.map((p) => (
            <DropdownMenuItem key={p.id} onSelect={() => bulkSetPriority(runOpts, p.id)}>
              {p.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Tag — punted */}
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={-1}>
            <Button
              variant="ghost"
              size="sm"
              disabled
              className={cn('h-8 gap-1.5 px-2 text-xs')}
              aria-disabled="true"
            >
              <Tag className="h-3.5 w-3.5" /> Tag
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>Coming soon</TooltipContent>
      </Tooltip>

      {/* Snooze */}
      <Button
        variant="ghost"
        size="sm"
        className="h-8 gap-1.5 px-2 text-xs"
        onClick={() => bulkSnooze24h(runOpts)}
      >
        <Clock className="h-3.5 w-3.5" /> Snooze 24h
      </Button>

      {/* Close */}
      <Button
        variant="ghost"
        size="sm"
        className="h-8 gap-1.5 px-2 text-xs"
        onClick={() => bulkClose(runOpts)}
      >
        Close
      </Button>

      <span className="ml-auto flex items-center gap-1.5">
        <span className="hidden text-[11px] text-muted-foreground sm:inline">Esc</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={clear}
              aria-label="Clear selection"
              className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-surface-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Clear selection</TooltipContent>
        </Tooltip>
      </span>
    </div>
  );
}
