import { cn } from '@opendesk/ui';
import { Link, useLocation } from '@tanstack/react-router';
import type { LucideIcon } from 'lucide-react';
import { useEffect, useRef } from 'react';

export interface SectionStripItem {
  to: string;
  label: string;
  icon: LucideIcon;
  match: (pathname: string) => boolean;
}

export function SectionStrip({
  label,
  items,
}: {
  label: string;
  items: readonly SectionStripItem[];
}) {
  const location = useLocation();
  const activeRef = useRef<HTMLLIElement | null>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  });

  return (
    <nav aria-label={label} className="border-b border-border bg-surface px-3 sm:px-6">
      <ul className="-mb-px flex flex-nowrap gap-1 overflow-x-auto">
        {items.map((item) => {
          const active = item.match(location.pathname);
          const Icon = item.icon;
          return (
            <li key={item.to} ref={active ? activeRef : undefined} className="shrink-0">
              <Link
                to={item.to}
                className={cn(
                  'inline-flex h-10 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 text-xs font-medium transition-colors',
                  active
                    ? 'border-brand-600 text-foreground'
                    : 'border-transparent text-muted-foreground hover:border-border-strong hover:text-foreground',
                )}
                aria-current={active ? 'page' : undefined}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
