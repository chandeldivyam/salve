// Standard settings page header — title, optional description, optional
// trailing actions (CTA + secondary buttons). Every settings sub-page should
// render exactly one of these.

import { cn } from '@salve/ui';
import type { ReactNode } from 'react';

export function SettingsHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        'flex flex-col gap-3 border-b border-line-quiet px-6 py-5 sm:flex-row sm:items-start sm:justify-between sm:gap-6',
        className,
      )}
    >
      <div className="min-w-0">
        <h1 className="text-[15px] font-semibold tracking-[-0.011em] text-fg-primary">{title}</h1>
        {description ? (
          <p className="mt-1 max-w-[60ch] text-[13px] text-fg-tertiary">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}
