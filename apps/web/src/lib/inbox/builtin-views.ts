// Phase 40 — built-in inbox view definitions.
//
// Built-ins are layered client-side rather than seeded into the `view`
// table. Per-agent ordering / hide state lives in `builtin_view_member`.
// Their `viewQuery` shapes are exactly what `ticketsForView` would consume
// for a custom view, so the same code path serves both.

import { ME_TOKEN, type ViewQuery, type ViewSort } from '@opendesk/zero-schema';
import { Inbox, ListChecks, UserMinus, UserRound } from 'lucide-react';
import type { ComponentType } from 'react';

export const BUILTIN_PREFIX = 'builtin:';
export type BuiltinKey = 'all' | 'unassigned' | 'mine' | 'resolved';

export interface BuiltinView {
  id: `${typeof BUILTIN_PREFIX}${BuiltinKey}`;
  builtinKey: BuiltinKey;
  label: string;
  icon: ComponentType<{ className?: string }>;
  query: ViewQuery;
  sort: ViewSort;
}

const OPEN_STATUSES = ['open', 'in_progress', 'snoozed'] as const;
const RESOLVED_STATUSES = ['resolved', 'closed'] as const;

export const BUILTIN_VIEWS: ReadonlyArray<BuiltinView> = [
  {
    id: 'builtin:all',
    builtinKey: 'all',
    label: 'All open',
    icon: Inbox,
    query: {
      filters: [{ field: 'status', operator: 'in', values: [...OPEN_STATUSES] }],
      matchAll: true,
    },
    sort: { field: 'updatedAt', direction: 'desc' },
  },
  {
    id: 'builtin:unassigned',
    builtinKey: 'unassigned',
    label: 'Unassigned',
    icon: UserMinus,
    query: {
      filters: [
        { field: 'status', operator: 'in', values: [...OPEN_STATUSES] },
        { field: 'assignee', operator: 'empty' },
      ],
      matchAll: true,
    },
    sort: { field: 'updatedAt', direction: 'desc' },
  },
  {
    id: 'builtin:mine',
    builtinKey: 'mine',
    label: 'Mine',
    icon: UserRound,
    query: {
      filters: [
        { field: 'status', operator: 'in', values: [...OPEN_STATUSES] },
        { field: 'assignee', operator: 'eq', value: ME_TOKEN },
      ],
      matchAll: true,
    },
    sort: { field: 'updatedAt', direction: 'desc' },
  },
  {
    id: 'builtin:resolved',
    builtinKey: 'resolved',
    label: 'Resolved',
    icon: ListChecks,
    query: {
      filters: [{ field: 'status', operator: 'in', values: [...RESOLVED_STATUSES] }],
      matchAll: true,
    },
    sort: { field: 'updatedAt', direction: 'desc' },
  },
];

export function isBuiltinViewID(id: string): boolean {
  return id.startsWith(BUILTIN_PREFIX);
}

export function builtinViewByID(id: string): BuiltinView | undefined {
  return BUILTIN_VIEWS.find((v) => v.id === id);
}

export const DEFAULT_VIEW_ID = BUILTIN_VIEWS[0]!.id;
