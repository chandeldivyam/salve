// /app/inbox — two-pane shell: header + (left list, right detail).
//
// The left pane is the inbox-list (`InboxList`) which loads via Zero
// `inboxOpen()`. The right pane is an `<Outlet>` which renders either the
// inbox-empty placeholder (`./inbox.index.tsx`) or the ticket detail
// (`./inbox.t.$ticketId.tsx`).

import { createFileRoute, Outlet, useParams } from '@tanstack/react-router';
import { InboxList } from '@/components/inbox-list';

export const Route = createFileRoute('/app/inbox')({
  component: InboxLayout,
});

function InboxLayout() {
  // Read the ticketId param if we're on /app/inbox/t/:ticketId. Outside that
  // sub-route this returns undefined; the list uses it only for highlight.
  // The app chrome (header) lives in `routes/app.tsx`; this layout owns
  // only the inbox-specific two-pane content.
  const params = useParams({ strict: false }) as { ticketId?: string };
  const { session } = Route.useRouteContext() as {
    session: { user: { id: string } };
  };
  const userID = session.user.id;

  return (
    <>
      <aside className="flex w-[360px] shrink-0 border-r border-border bg-surface">
        <InboxList selectedTicketID={params.ticketId ?? null} currentUserID={userID} />
      </aside>
      <main className="flex min-w-0 flex-1 bg-background">
        <Outlet />
      </main>
    </>
  );
}
