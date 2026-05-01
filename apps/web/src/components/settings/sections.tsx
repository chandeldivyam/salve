// Body containers — exactly one body shape per page.
//
// FormSection: editing one entity's fields. 720px max width, label-on-top.
// ListSection: collections. Header row (count + filters + CTA), then dense rows.
// EmptyState: centered icon/title/description/CTA.

import { cn } from '@opendesk/ui';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export function SettingsBody({
  children,
  className,
  maxWidth = 'narrow',
}: {
  children: ReactNode;
  className?: string;
  maxWidth?: 'narrow' | 'wide';
}) {
  return (
    <div className={cn('flex min-h-0 flex-1 flex-col overflow-y-auto', className)}>
      <div
        className={cn(
          'mx-auto w-full px-6 py-6',
          maxWidth === 'narrow' ? 'max-w-[720px]' : 'max-w-[1100px]',
        )}
      >
        {children}
      </div>
    </div>
  );
}

export function FormSection({
  title,
  description,
  children,
  className,
}: {
  title?: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('flex flex-col gap-5 pt-2', className)}>
      {title || description ? (
        <div className="border-b border-line-quiet pb-3">
          {title ? (
            <h2 className="text-[15px] font-semibold tracking-[-0.011em] text-fg-primary">
              {title}
            </h2>
          ) : null}
          {description ? (
            <p className="mt-1 text-[12px] text-fg-tertiary">{description}</p>
          ) : null}
        </div>
      ) : null}
      <div className="flex flex-col gap-6">{children}</div>
    </section>
  );
}

export function ListSection({
  title,
  count,
  trailing,
  children,
  empty,
  className,
}: {
  title?: string;
  count?: number;
  trailing?: ReactNode;
  children?: ReactNode;
  empty?: ReactNode;
  className?: string;
}) {
  const hasChildren = children !== undefined && children !== null;
  const hasHeader = title || trailing || count !== undefined;
  return (
    <section className={cn('flex flex-col', className)}>
      {hasHeader ? (
        <header className="flex h-7 items-center justify-between gap-3 px-1 pb-1">
          <div className="flex min-w-0 items-center gap-1.5">
            {title ? (
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-fg-quaternary">
                {title}
              </h3>
            ) : null}
            {count !== undefined ? (
              <span className="tabular-nums text-[11px] text-fg-quaternary">{count}</span>
            ) : null}
          </div>
          {trailing ? <div className="flex items-center gap-1.5">{trailing}</div> : null}
        </header>
      ) : null}
      {hasChildren ? <div className="flex flex-col">{children}</div> : empty}
    </section>
  );
}

export function ListRow({
  className,
  children,
  onClick,
  asChild,
}: {
  className?: string;
  children: ReactNode;
  onClick?: () => void;
  asChild?: boolean;
}) {
  const base = 'flex h-9 items-center gap-2 rounded-md px-2 text-[13px] text-fg-primary';
  if (asChild || onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(base, 'text-left transition-colors hover:bg-bg-elevated/60', className)}
      >
        {children}
      </button>
    );
  }
  return <div className={cn(base, className)}>{children}</div>;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-3 rounded-md bg-surface px-6 py-14 text-center',
        className,
      )}
    >
      <div className="grid h-10 w-10 place-items-center rounded-md bg-bg-elevated text-fg-tertiary">
        <Icon className="h-4 w-4" />
      </div>
      <div className="flex max-w-[50ch] flex-col gap-1">
        <p className="text-[14px] font-medium text-fg-primary">{title}</p>
        {description ? <p className="text-[12px] text-fg-tertiary">{description}</p> : null}
      </div>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
