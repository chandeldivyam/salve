// /app/inbox — push-navigation single pane.
//
// When there's no `ticketId`, the inbox-list fills the pane. When a ticket
// is open, the list is hidden and the detail (`<Outlet />`) takes over.
// Linear-style push-nav: one thing on screen at a time, back-button returns.

import { createFileRoute, Outlet, useParams } from '@tanstack/react-router';
import { InboxList } from '@/components/inbox-list';
import { useScope } from '@/lib/commands/use-scope';

export const Route = createFileRoute('/app/inbox')({
  component: InboxLayout,
});

function InboxLayout() {
  useScope('inbox');
  const params = useParams({ strict: false }) as { ticketId?: string };
  const { session } = Route.useRouteContext() as {
    session: { user: { id: string } };
  };
  const userID = session.user.id;

  if (params.ticketId) {
    return (
      <div className="flex h-full min-w-0 flex-1 bg-background">
        <Outlet />
      </div>
    );
  }

  return (
    <div className="flex h-full min-w-0 flex-1 bg-surface">
      <InboxList selectedTicketID={null} currentUserID={userID} />
    </div>
  );
}
