// /app/customers — workspace customer index. Server-side ILIKE search,
// state-driven pagination via the +1 sentinel, client-side sort, j/k/Enter
// keyboard navigation.

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
  initialsFromName,
  Input,
} from '@opendesk/ui';
import { queries } from '@opendesk/zero-schema';
import { useQuery } from '@rocicorp/zero/react';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { ArrowDownAZ, ArrowDownWideNarrow, Calendar, ChevronDown, Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { customerName, relativeTime } from '@/components/timeline/timeline-format';
import type { TimelineCustomer, TimelineTag, TimelineTagRelation } from '@/components/timeline/types';
import { useShortcut } from '@/lib/shortcuts';
import { CACHE_TICKET_DETAIL } from '@/lib/zero-cache';

export const Route = createFileRoute('/app/customers/')({
  component: CustomersIndexRoute,
});

const PAGE = 50;

type SortKey = 'recent' | 'name' | 'first-seen';

const SORT_OPTIONS: Array<{ id: SortKey; label: string; icon: typeof ArrowDownWideNarrow }> = [
  { id: 'recent', label: 'Recently active', icon: ArrowDownWideNarrow },
  { id: 'name', label: 'Name (A → Z)', icon: ArrowDownAZ },
  { id: 'first-seen', label: 'First seen', icon: Calendar },
];

function CustomersIndexRoute() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [sort, setSort] = useState<SortKey>('recent');
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // Reset paging when the search query changes — otherwise growing limit
  // accumulates state from a stale query.
  useEffect(() => {
    setLimit(PAGE);
    setSelectedIndex(-1);
  }, [query]);

  const [rawRows, status] = useQuery(
    queries.customerList({ search: query.trim() || undefined, limit: limit + 1 }),
    CACHE_TICKET_DETAIL,
  );
  const rows = rawRows as ReadonlyArray<TimelineCustomer>;
  const hasMore = rows.length > limit;
  const visible = useMemo(() => rows.slice(0, limit), [rows, limit]);
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
      <header className="shrink-0 border-b border-line-default bg-bg-panel px-4 py-3 lg:px-6">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-[18px] font-semibold text-fg-primary">Customers</h1>
            <p className="text-[12px] text-fg-tertiary">
              {showSkeleton ? 'Loading…' : `${totalShownLabel} in this workspace`}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <SortMenu sort={sort} onChange={setSort} />
            <Button asChild size="sm" variant="outline">
              <Link to="/app/inbox">Inbox</Link>
            </Button>
          </div>
        </div>
        <div className="relative mt-3 max-w-md">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-tertiary" />
          <Input
            ref={searchInputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="h-9 pl-8 text-[13px]"
            placeholder="Search customer email or name (/ to focus)"
          />
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-4 py-4 lg:px-6">
        <div className="mx-auto flex max-w-4xl flex-col">
          <ColumnHeader />
          <div className="rounded-lg bg-bg-panel ring-1 ring-line-default">
            {showSkeleton ? (
              <CustomerListSkeleton />
            ) : sorted.length === 0 ? (
              <div className="px-4 py-10 text-center text-[13px] text-fg-tertiary">
                No customers match this view yet.
              </div>
            ) : (
              <div className="divide-y divide-line-quiet">
                {sorted.map((customer, index) => (
                  <CustomerRow
                    key={customer.id}
                    customer={customer}
                    selected={index === selectedIndex}
                    onMouseEnter={() => setSelectedIndex(index)}
                  />
                ))}
              </div>
            )}
            {hasMore ? (
              <div className="flex justify-center border-t border-line-quiet p-3">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setLimit((current) => current + PAGE)}
                >
                  Show more
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      </main>
    </div>
  );
}

function SortMenu({ sort, onChange }: { sort: SortKey; onChange: (next: SortKey) => void }) {
  const current: (typeof SORT_OPTIONS)[number] =
    SORT_OPTIONS.find((option) => option.id === sort) ?? SORT_OPTIONS[0]!;
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
