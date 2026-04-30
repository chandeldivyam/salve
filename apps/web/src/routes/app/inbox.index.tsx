// /app/inbox empty-state — the right pane when no ticket is selected.

import { createFileRoute } from '@tanstack/react-router';
import { Inbox } from 'lucide-react';

export const Route = createFileRoute('/app/inbox/')({
  component: InboxEmpty,
});

function InboxEmpty() {
  return (
    <div className="flex h-full flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
      <div className="grid h-14 w-14 place-items-center rounded-full bg-surface text-brand-soft-foreground ring-1 ring-border">
        <Inbox className="h-7 w-7" />
      </div>
      <div className="max-w-sm space-y-1">
        <p className="text-sm font-medium text-foreground">Select a ticket</p>
        <p className="text-xs text-muted-foreground">
          Use the inbox on the left to triage. Press{' '}
          <kbd className="rounded bg-surface px-1 py-0.5 text-[10px] font-medium text-foreground ring-1 ring-border">
            J
          </kbd>
          /
          <kbd className="rounded bg-surface px-1 py-0.5 text-[10px] font-medium text-foreground ring-1 ring-border">
            K
          </kbd>{' '}
          to move between rows,{' '}
          <kbd className="rounded bg-surface px-1 py-0.5 text-[10px] font-medium text-foreground ring-1 ring-border">
            Enter
          </kbd>{' '}
          to open,{' '}
          <kbd className="rounded bg-surface px-1 py-0.5 text-[10px] font-medium text-foreground ring-1 ring-border">
            E
          </kbd>{' '}
          to resolve.
        </p>
      </div>
    </div>
  );
}
