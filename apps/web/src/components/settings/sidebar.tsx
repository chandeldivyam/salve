// Settings sidebar — renders just the grouped item list. The caller owns
// the outer chrome (workbench rail provides border, padding, scroll).
//
// Used inside `WorkbenchLeftRail` when the route is under `/app/settings/*`.

import { cn } from '@salve/ui';
import { Link, useLocation } from '@tanstack/react-router';
import type { LucideIcon } from 'lucide-react';

export interface SettingsSidebarItem {
  to: string;
  label: string;
  icon: LucideIcon;
  badge?: string | number;
  match?: (pathname: string) => boolean;
}

export interface SettingsSidebarGroup {
  label?: string;
  items: SettingsSidebarItem[];
}

export function SettingsSidebar({
  groups,
  className,
  collapsed = false,
}: {
  groups: readonly SettingsSidebarGroup[];
  className?: string;
  collapsed?: boolean;
}) {
  const location = useLocation();
  const pathname = location.pathname;

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {groups.map((group) => (
        <div key={group.label ?? group.items.map((item) => item.to).join('|')}>
          {group.label && !collapsed ? (
            <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-fg-quaternary">
              {group.label}
            </p>
          ) : null}
          <ul className={cn('flex flex-col gap-px', collapsed && 'items-center')}>
            {group.items.map((item) => {
              const active = item.match
                ? item.match(pathname)
                : pathname === item.to || pathname.startsWith(`${item.to}/`);
              const Icon = item.icon;
              return (
                <li key={item.to} className="w-full">
                  <Link
                    to={item.to}
                    aria-label={collapsed ? item.label : undefined}
                    className={cn(
                      'flex items-center rounded-md text-[13px] transition-colors',
                      active
                        ? 'bg-bg-elevated text-fg-primary'
                        : 'text-fg-secondary hover:bg-bg-elevated/60 hover:text-fg-primary',
                      collapsed ? 'h-8 w-8 justify-center' : 'h-7 gap-2 px-2',
                    )}
                    aria-current={active ? 'page' : undefined}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0" />
                    {!collapsed ? (
                      <>
                        <span className="min-w-0 flex-1 truncate">{item.label}</span>
                        {item.badge !== undefined ? (
                          <span className="shrink-0 tabular-nums text-[11px] text-fg-quaternary">
                            {item.badge}
                          </span>
                        ) : null}
                      </>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
