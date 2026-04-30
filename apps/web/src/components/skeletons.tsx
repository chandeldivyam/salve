// Layout-shape skeletons. Each one renders at the *exact* dimensions of
// its real counterpart so swapping skeleton → data does not shift layout
// (CLS budget = 0). Used while a Zero query is still hydrating IndexedDB
// or syncing with the server. Never reach for a centered spinner; show a
// skeleton at the right shape — it feels twice as fast.

import { cn } from '@opendesk/ui';

const SHIMMER = 'animate-pulse bg-muted/70';

export function InboxRowSkeleton() {
  return (
    <div className="border-b border-border border-l-4 border-l-transparent px-4 py-3">
      <div className="flex items-start gap-3">
        <span className={cn('mt-1 h-2 w-2 shrink-0 rounded-full', SHIMMER)} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className={cn('block h-3 w-28 rounded', SHIMMER)} />
            <span className={cn('block h-3 w-10 shrink-0 rounded', SHIMMER)} />
          </div>
          <span className={cn('mt-1.5 block h-3.5 w-3/4 rounded', SHIMMER)} />
          <div className="mt-2 flex items-center gap-1.5">
            <span className={cn('block h-4 w-12 rounded-full', SHIMMER)} />
            <span className="ml-auto block h-5 w-5 rounded-full bg-muted/70" />
          </div>
        </div>
      </div>
    </div>
  );
}

export function InboxListSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div aria-hidden="true" className="select-none">
      {Array.from({ length: rows }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholder
        <InboxRowSkeleton key={i} />
      ))}
    </div>
  );
}

export function TicketDetailSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-1 flex-col">
      {/* Header row */}
      <div className="flex items-center gap-3 border-b border-border px-6 py-4">
        <span className={cn('h-9 w-9 rounded-full', SHIMMER)} />
        <div className="min-w-0 flex-1 space-y-2">
          <span className={cn('block h-4 w-2/5 rounded', SHIMMER)} />
          <span className={cn('block h-3 w-1/4 rounded', SHIMMER)} />
        </div>
        <span className={cn('h-7 w-20 rounded-md', SHIMMER)} />
        <span className={cn('h-7 w-20 rounded-md', SHIMMER)} />
      </div>

      {/* Two-column body: thread + sidebar */}
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col gap-4 px-6 py-4">
          {[64, 96, 80, 112].map((h, i) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholder
              key={i}
              className={cn('rounded-lg border border-border bg-surface p-4')}
            >
              <div className="flex items-center gap-2">
                <span className={cn('h-6 w-6 rounded-full', SHIMMER)} />
                <span className={cn('h-3 w-32 rounded', SHIMMER)} />
                <span className={cn('ml-auto h-3 w-16 rounded', SHIMMER)} />
              </div>
              <span
                className={cn('mt-3 block w-full rounded', SHIMMER)}
                style={{ height: h }}
              />
            </div>
          ))}
        </div>
        <aside className="hidden w-72 shrink-0 border-l border-border px-5 py-4 lg:block">
          <span className={cn('block h-3 w-20 rounded', SHIMMER)} />
          <div className="mt-4 space-y-3">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="space-y-1.5">
                <span className={cn('block h-3 w-16 rounded', SHIMMER)} />
                <span className={cn('block h-4 w-full rounded', SHIMMER)} />
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
