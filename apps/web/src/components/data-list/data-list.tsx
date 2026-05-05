// Shared list primitive for paginated lists with a "Show more" button.
//
// Scope: only `customers.index` uses this today. The inbox (virtualized,
// infinite scroll, bulk selection) keeps its bespoke shell — DataList will
// grow infinite-scroll and keyboard nav when a second non-inbox consumer
// drives those features. Until then, callers wire their own keyboard nav
// (e.g. `useShortcut(['j'], ...)`).

import { Button, cn } from '@salve/ui';
import type { ReactNode } from 'react';

export interface DataListProps<T> {
  rows: ReadonlyArray<T>;
  isLoading: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  loadMoreLabel?: string;
  renderRow: (row: T, index: number) => ReactNode;
  renderHeader?: ReactNode;
  empty?: ReactNode;
  skeleton?: ReactNode;
  className?: string;
  containerClassName?: string;
}

export function DataList<T>({
  rows,
  isLoading,
  hasMore,
  onLoadMore,
  loadMoreLabel = 'Show more',
  renderRow,
  renderHeader,
  empty,
  skeleton,
  className,
  containerClassName,
}: DataListProps<T>) {
  const showEmpty = !isLoading && rows.length === 0;

  return (
    <div className={cn('flex flex-col', className)}>
      {renderHeader}
      <div className={cn('rounded-lg bg-bg-panel ring-1 ring-line-default', containerClassName)}>
        {isLoading && rows.length === 0 ? (
          (skeleton ?? <DefaultSkeleton />)
        ) : showEmpty ? (
          (empty ?? <DefaultEmpty />)
        ) : (
          <div className="divide-y divide-line-quiet">
            {rows.map((row, index) => renderRow(row, index))}
          </div>
        )}
        {hasMore ? (
          <div className="flex justify-center border-t border-line-quiet p-3">
            <Button type="button" size="sm" variant="outline" onClick={onLoadMore}>
              {loadMoreLabel}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function DefaultEmpty() {
  return <div className="px-4 py-10 text-center text-[13px] text-fg-tertiary">No items.</div>;
}

function DefaultSkeleton() {
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
