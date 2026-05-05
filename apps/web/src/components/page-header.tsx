import { cn } from '@salve/ui';
import type { ReactNode } from 'react';

export function PageHeader({
  title,
  description,
  actions,
  search,
  className,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  search?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        'shrink-0 border-b border-line-default bg-bg-panel px-4 py-3 lg:px-6',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-[18px] font-semibold text-fg-primary">{title}</h1>
          {description ? <p className="text-[12px] text-fg-tertiary">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      {search ? <div className="mt-3 max-w-md">{search}</div> : null}
    </header>
  );
}
