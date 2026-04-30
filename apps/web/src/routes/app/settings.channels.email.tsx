// /app/settings/channels/email — pathless layout for the email channel
// settings. Renders the tab strip and an <Outlet /> for the tab content.
// Each tab is its own route file under settings.channels.email.*.

import { createFileRoute, Outlet } from '@tanstack/react-router';
import { EmailChannelTabs } from '@/components/email-settings/nav-tabs';

export const Route = createFileRoute('/app/settings/channels/email')({
  component: EmailChannelLayout,
});

function EmailChannelLayout() {
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="flex flex-col gap-1 border-b border-border bg-surface px-4 py-4 sm:px-8">
        <h1 className="text-lg font-semibold text-foreground">Email channel</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Manage outbound domains, receiving addresses, routing, and suppressed recipients for this
          workspace.
        </p>
      </header>
      <EmailChannelTabs />
      <div className="min-w-0 flex-1">
        <Outlet />
      </div>
    </div>
  );
}
