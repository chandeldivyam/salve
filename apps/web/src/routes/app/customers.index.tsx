// /app/customers — workspace customer index. Server-side ILIKE search,
// state-driven pagination via the +1 sentinel, client-side sort, j/k/Enter
// keyboard navigation.

import { useQuery } from '@rocicorp/zero/react';
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
  DropdownMenuTrigger,
  Input,
  initialsFromName,
} from '@salve/ui';
import { MAX_LIST_LIMIT, PAGE, queries } from '@salve/zero-schema';
import { createFileRoute, Link, useNavigate, useSearch } from '@tanstack/react-router';
import { ArrowDownAZ, ArrowDownWideNarrow, Calendar, ChevronDown, Search } from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import { DataList } from '@/components/data-list/data-list';
import { PageHeader } from '@/components/page-header';
import { customerName, relativeTime } from '@/components/timeline/timeline-format';
import type {
  TimelineCustomer,
  TimelineTag,
  TimelineTagRelation,
} from '@/components/timeline/types';
import { useScope } from '@/lib/commands/use-scope';
import { paginate } from '@/lib/paginate';
import { useShortcut } from '@/lib/shortcuts';
import { CACHE_TICKET_DETAIL } from '@/lib/zero-cache';

type SortKey = 'recent' | 'name' | 'first-seen';

// Display ceiling stops below the query schema's MAX_LIST_LIMIT_QUERY so the
// `+ 1` sentinel (limit + 1 = MAX_LIST_LIMIT + 1) still validates.
const customersSearchSchema = z.object({
  q: z.string().optional().catch(undefined),
  sort: z.enum(['recent', 'name', 'first-seen']).optional().catch(undefined),
  limit: z.coerce.number().int().positive().max(MAX_LIST_LIMIT).optional().catch(undefined),
});

export const Route = createFileRoute('/app/customers/')({
  component: CustomersIndexRoute,
  validateSearch: customersSearchSchema,
});

type SortOption = { id: SortKey; label: string; icon: typeof ArrowDownWideNarrow };

const RECENT_SORT: SortOption = {
  id: 'recent',
  label: 'Recently active',
  icon: ArrowDownWideNarrow,
};
const SORT_OPTIONS: ReadonlyArray<SortOption> = [
  RECENT_SORT,
  { id: 'name', label: 'Name (A → Z)', icon: ArrowDownAZ },
  { id: 'first-seen', label: 'First seen', icon: Calendar },
];

function CustomersIndexRoute() {
  useScope('customer');
  const navigate = useNavigate({ from: Route.fullPath });
  const search = useSearch({ from: Route.fullPath });
  const query = search.q ?? '';
  const sort: SortKey = search.sort ?? 'recent';
  const limit: number = search.limit ?? PAGE;
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const setQuery = useCallback(
    (next: string) => {
      // Reset paging on query change. Use replace so each keystroke doesn't
      // create a history entry.
      navigate({
        search: (prev) => ({ ...prev, q: next || undefined, limit: PAGE }),
        replace: true,
      });
      setSelectedIndex(-1);
    },
    [navigate],
  );

  const setSort = useCallback(
    (next: SortKey) => {
      navigate({ search: (prev) => ({ ...prev, sort: next }) });
    },
    [navigate],
  );

  const setLimit = useCallback(
    (updater: (current: number) => number) => {
      navigate({
        search: (prev) => ({
          ...prev,
          limit: Math.min(MAX_LIST_LIMIT, updater(prev.limit ?? PAGE)),
        }),
      });
    },
    [navigate],
  );

  const [rawRows, status] = useQuery(
    queries.customerList({ search: query.trim() || undefined, limit: limit + 1 }),
    CACHE_TICKET_DETAIL,
  );
  const rows = rawRows as ReadonlyArray<TimelineCustomer>;
  const { visible, hasMore } = useMemo(() => paginate(rows, limit), [rows, limit]);
  const sorted = useMemo(() => sortCustomers(visible, sort), [visible, sort]);
  const totalShownLabel = `${sorted.length}${hasMore ? '+' : ''}`;

  const goToIndex = useCallback(
    (index: number) => {
      if (sorted.length === 0) return;
      const clamped = Math.max(0, Math.min(sorted.length - 1, index));
      setSelectedIndex(clamped);
      const target = sorted[clamped];
      if (target) {
        navigate({ to: '/app/customers/$customerId', params: { customerId: target.id } });
      }
    },
    [navigate, sorted],
  );

  const cursor = selectedIndex < 0 ? 0 : selectedIndex;
  useShortcut(['j'], () => {
    if (sorted.length === 0) return;
    goToIndex(Math.min(sorted.length - 1, cursor + 1));
  });
  useShortcut(['k'], () => {
    if (sorted.length === 0) return;
    goToIndex(Math.max(0, cursor - 1));
  });
  useShortcut('Enter', () => {
    if (sorted.length > 0) goToIndex(cursor);
  });
  useShortcut(['/'], (event) => {
    event.preventDefault();
    searchInputRef.current?.focus();
    searchInputRef.current?.select();
  });

  const showSkeleton = sorted.length === 0 && status?.type !== 'complete';

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-bg-canvas">
      <PageHeader
        title="Customers"
        description={showSkeleton ? 'Loading…' : `${totalShownLabel} in this workspace`}
        actions={
          <>
            <SortMenu sort={sort} onChange={setSort} />
            <Button asChild size="sm" variant="outline">
              <Link to="/app/inbox">Inbox</Link>
            </Button>
          </>
        }
        search={
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-tertiary" />
            <Input
              ref={searchInputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="h-9 pl-8 text-[13px]"
              placeholder="Search customer email or name (/ to focus)"
            />
          </div>
        }
      />

      <main className="min-h-0 flex-1 overflow-y-auto px-4 py-4 lg:px-6">
        <div className="mx-auto max-w-4xl">
          <DataList
            rows={sorted}
            isLoading={showSkeleton}
            hasMore={hasMore}
            onLoadMore={() => setLimit((current) => current + PAGE)}
            renderHeader={<ColumnHeader />}
            renderRow={(customer, index) => (
              <CustomerRow
                key={customer.id}
                customer={customer}
                selected={index === selectedIndex}
                onMouseEnter={() => setSelectedIndex(index)}
              />
            )}
            empty={
              <div className="px-4 py-10 text-center text-[13px] text-fg-tertiary">
                No customers match this view.
              </div>
            }
            skeleton={<CustomerListSkeleton />}
          />
        </div>
      </main>
    </div>
  );
}

function SortMenu({ sort, onChange }: { sort: SortKey; onChange: (next: SortKey) => void }) {
  const current = SORT_OPTIONS.find((option) => option.id === sort) ?? RECENT_SORT;
  const Icon = current.icon;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" size="sm" variant="ghost" className="h-8 gap-1.5 px-2">
          <Icon className="h-3.5 w-3.5" />
          <span className="text-[12px]">{current.label}</span>
          <ChevronDown className="h-3 w-3 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Sort by</DropdownMenuLabel>
        {SORT_OPTIONS.map((option) => (
          <DropdownMenuItem key={option.id} onSelect={() => onChange(option.id)}>
            <option.icon className="h-3.5 w-3.5" />
            {option.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ColumnHeader() {
  return (
    <div className="grid grid-cols-[1fr_minmax(80px,120px)] items-center gap-3 px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-fg-quaternary md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(80px,120px)]">
      <span>Customer</span>
      <span className="hidden md:block">Tags</span>
      <span className="text-right">Last seen</span>
    </div>
  );
}

function CustomerRow({
  customer,
  selected,
  onMouseEnter,
}: {
  customer: TimelineCustomer;
  selected: boolean;
  onMouseEnter: () => void;
}) {
  const lastSeenAt = customer.lastSeenAt ?? customer.updatedAt ?? customer.createdAt ?? null;
  const tags = renderableTags(customer.tags);
  return (
    <Link
      to="/app/customers/$customerId"
      params={{ customerId: customer.id }}
      onMouseEnter={onMouseEnter}
      className={cn(
        'grid h-12 grid-cols-[1fr_minmax(80px,120px)] items-center gap-3 px-3 transition-colors hover:bg-bg-elevated md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(80px,120px)]',
        selected && 'bg-bg-elevated',
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <Avatar size={28}>
          <AvatarFallback>
            {initialsFromName(customerName(customer), customer.email)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium text-fg-primary">
            {customerName(customer)}
          </p>
          <p className="truncate text-[12px] text-fg-tertiary">{customer.email}</p>
        </div>
      </div>
      <div className="hidden min-w-0 md:block">
        <TagList tags={tags} />
      </div>
      <span className="shrink-0 text-right text-[11px] tabular-nums text-fg-tertiary">
        {lastSeenAt ? relativeTime(lastSeenAt) : 'never'}
      </span>
    </Link>
  );
}

function TagList({ tags }: { tags: ReadonlyArray<TimelineTag> }) {
  if (tags.length === 0) {
    return <span className="text-[11px] text-fg-quaternary">—</span>;
  }
  const visible = tags.slice(0, 3);
  const overflow = tags.length - visible.length;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1">
      {visible.map((tag) => (
        <span
          key={tag.id}
          className="max-w-[80px] truncate rounded-full border px-1.5 py-0.5 text-[10px] font-medium"
          style={tagPillStyle(tag)}
        >
          {tag.label}
        </span>
      ))}
      {overflow > 0 ? (
        <Badge variant="muted" className="px-1.5 py-0">
          +{overflow}
        </Badge>
      ) : null}
    </div>
  );
}

function tagPillStyle(tag: TimelineTag) {
  const color = normalizeHex(tag.color ?? tag.group?.color ?? '#0f766e');
  return {
    backgroundColor: `${color}1f`,
    borderColor: `${color}66`,
    color,
  };
}

function normalizeHex(value: string) {
  if (/^#([\da-fA-F]{3}|[\da-fA-F]{6})$/.test(value)) return value;
  return '#0f766e';
}

function CustomerListSkeleton() {
  return (
    <div>
      {[0, 1, 2, 3, 4].map((row) => (
        <div key={row} className="flex h-12 items-center gap-3 px-3">
          <div className="h-7 w-7 rounded-full bg-bg-elevated" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="h-3 w-40 rounded bg-bg-elevated" />
            <div className="h-3 w-56 rounded bg-bg-elevated" />
          </div>
        </div>
      ))}
    </div>
  );
}

function renderableTags(relations?: ReadonlyArray<TimelineTagRelation>): TimelineTag[] {
  if (!relations) return [];
  const out: TimelineTag[] = [];
  for (const relation of relations) {
    if (relation.tag) out.push(relation.tag);
  }
  return out;
}

function sortCustomers(
  customers: ReadonlyArray<TimelineCustomer>,
  sort: SortKey,
): ReadonlyArray<TimelineCustomer> {
  if (sort === 'name') {
    return [...customers].sort((a, b) => customerName(a).localeCompare(customerName(b)));
  }
  if (sort === 'first-seen') {
    return [...customers].sort((a, b) => {
      const at = a.firstSeenAt ?? a.createdAt ?? 0;
      const bt = b.firstSeenAt ?? b.createdAt ?? 0;
      return bt - at;
    });
  }
  return customers; // server already orders by lastSeenAt desc
}
