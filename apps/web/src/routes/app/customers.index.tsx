// /app/customers — minimal customer index for Phase 20.

import { Avatar, AvatarFallback, Button, Input, initialsFromName } from '@opendesk/ui';
import { queries } from '@opendesk/zero-schema';
import { useQuery } from '@rocicorp/zero/react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { customerName, relativeTime } from '@/components/timeline/timeline-format';
import type { TimelineCustomer } from '@/components/timeline/types';
import { WorkbenchLink } from '@/components/workbench/workbench-link';
import { CACHE_TICKET_DETAIL } from '@/lib/zero-cache';

export const Route = createFileRoute('/app/customers/')({
  component: CustomersIndexRoute,
});

function CustomersIndexRoute() {
  const [query, setQuery] = useState('');
  const [rows, status] = useQuery(
    queries.customerList({ search: query.trim() || undefined, limit: 50 }),
    CACHE_TICKET_DETAIL,
  );
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const customers = rows as ReadonlyArray<TimelineCustomer>;
    if (!needle) return customers.slice(0, 50);
    return customers
      .filter((row) => {
        const name = customerName(row).toLowerCase();
        return name.includes(needle) || row.email.toLowerCase().includes(needle);
      })
      .slice(0, 50);
  }, [query, rows]);

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-bg-canvas">
      <header className="shrink-0 border-b border-line-default bg-bg-panel px-4 py-3 lg:px-6">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-[18px] font-semibold text-fg-primary">Customers</h1>
            <p className="text-[12px] text-fg-tertiary">
              Most recently active customer profiles and timelines.
            </p>
          </div>
          <Button asChild size="sm" variant="outline">
            <Link to="/app/inbox">Inbox</Link>
          </Button>
        </div>
        <div className="relative mt-3 max-w-md">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-tertiary" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="h-9 pl-8 text-[13px]"
            placeholder="Search customer email or name"
          />
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-4 py-4 lg:px-6">
        <div className="mx-auto max-w-4xl rounded-lg bg-bg-panel ring-1 ring-line-default">
          {filtered.length === 0 && status?.type !== 'complete' ? (
            <CustomerListSkeleton />
          ) : filtered.length === 0 ? (
            <div className="px-4 py-10 text-center text-[13px] text-fg-tertiary">
              No customers match this view yet.
            </div>
          ) : (
            <div className="divide-y divide-line-quiet">
              {filtered.map((row) => (
                <CustomerRow key={row.id} customer={row} />
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function CustomerRow({ customer }: { customer: TimelineCustomer }) {
  const lastSeenAt = customer.lastSeenAt ?? customer.updatedAt ?? customer.createdAt ?? null;

  return (
    <WorkbenchLink
      href={`/app/customers/${customer.id}`}
      source="ticket-row"
      className="flex h-12 items-center gap-3 px-3 transition-colors hover:bg-bg-elevated"
    >
      <Avatar size={28}>
        <AvatarFallback>{initialsFromName(customerName(customer), customer.email)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-fg-primary">{customerName(customer)}</p>
        <p className="truncate text-[12px] text-fg-tertiary">{customer.email}</p>
      </div>
      <div className="hidden min-w-[120px] text-right text-[11px] tabular-nums text-fg-tertiary sm:block">
        <p>{customer.phone ?? 'No phone'}</p>
        <p>{customer.location ?? 'No location'}</p>
      </div>
      <span className="hidden w-24 shrink-0 text-right text-[11px] tabular-nums text-fg-tertiary md:block">
        {lastSeenAt ? relativeTime(lastSeenAt) : 'never'}
      </span>
    </WorkbenchLink>
  );
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
