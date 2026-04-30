// EmptyState — used by every email-channel sub-tab when there is nothing
// to show yet. Sits inside a Card on the surface so it reads as part of
// the tab content rather than a full-page state.

import { Card, CardContent } from '@opendesk/ui';
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
    <Card className="bg-surface">
      <CardContent className="flex flex-col items-center gap-3 px-6 py-10 text-center">
        <span className="grid h-10 w-10 place-items-center rounded-full bg-brand-soft text-brand-soft-foreground ring-1 ring-brand-border">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">{title}</p>
          <p className="max-w-sm text-xs text-muted-foreground">{description}</p>
        </div>
        {action}
      </CardContent>
    </Card>
  );
}
