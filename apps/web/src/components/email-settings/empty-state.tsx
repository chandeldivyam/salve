// EmptyState — used by every email-channel sub-tab when there is nothing
// to show yet. Variant C: flat surface, single hairline ring, no card chrome.

import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

interface Props {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
}

export function EmptyState({ icon: Icon, title, description, action }: Props) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-md bg-surface px-6 py-14 text-center">
      <div className="grid h-10 w-10 place-items-center rounded-md bg-bg-elevated text-fg-tertiary">
        <Icon className="h-4 w-4" aria-hidden="true" />
      </div>
      <div className="flex max-w-[50ch] flex-col gap-1">
        <p className="text-[14px] font-medium text-fg-primary">{title}</p>
        <p className="text-[12px] text-fg-tertiary">{description}</p>
      </div>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
