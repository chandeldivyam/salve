// /app/inbox — two-pane shell: header + (left list, right detail).
//
// The left pane is the inbox-list (`InboxList`) which loads via Zero
// `inboxOpen()`. The right pane is an `<Outlet>` which renders either the
// inbox-empty placeholder (`./inbox.index.tsx`) or the ticket detail
// (`./inbox.t.$ticketId.tsx`).

import { createFileRoute, Outlet, useParams } from '@tanstack/react-router';
import { AppHeader } from '@/components/app-header';
import { InboxList } from '@/components/inbox-list';

export const Route = createFileRoute('/app/inbox')({
  component: InboxLayout,
});

function InboxLayout() {
  // Read the ticketId param if we're on /app/inbox/t/:ticketId. Outside that
  // sub-route this returns undefined; the list uses it only for highlight.
  const params = useParams({ strict: false }) as { ticketId?: string };
  const { session } = Route.useRouteContext() as {
    session: { user: { id: string } };
  };
  const userID = session.user.id;

  return (
    <div className="flex h-dvh flex-col">
      <AppHeader />
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[360px] shrink-0 border-r border-border bg-surface">
          <InboxList selectedTicketID={params.ticketId ?? null} currentUserID={userID} />
        </aside>
        <main className="flex min-w-0 flex-1 bg-background">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
