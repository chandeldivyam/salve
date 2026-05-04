// /app/inbox — push-navigation single pane.
//
// When there's no `ticketId`, the inbox-list fills the pane. When a ticket
// is open, the list is hidden and the detail (`<Outlet />`) takes over.
// Linear-style push-nav: one thing on screen at a time, back-button returns.
//
// Phase 40: `?view=<id>` selects the active saved view. UUID for custom,
// `builtin:<key>` for built-ins. Validated structurally only — unknown ids
// fall back to the default builtin client-side.

import { createFileRoute, Outlet, useParams } from '@tanstack/react-router';
import { z } from 'zod';
import { InboxList } from '@/components/inbox-list';
import { useScope } from '@/lib/commands/use-scope';

const inboxSearchSchema = z.object({
  view: z.string().min(1).max(80).optional().catch(undefined),
  // Encoded chip filters (see lib/inbox/url-filters). Capped so a buggy
  // encoder can't blow up the router.
  f: z.string().max(4096).optional().catch(undefined),
  // Free-text search. Currently consumed only by the inbox-list local
  // state (will graduate to URL when FTS intersection lands — T-4006).
  // Validated up front so router redirects preserve the param instead
  // of treating it as unknown and stripping it.
  q: z.string().trim().max(500).optional().catch(undefined),
  // Group axis + sort. Reserved for the display-options popover
  // (T-4007); validated here so the URL contract is forward-compatible
  // and the params survive nav.
  group: z
    .enum(['assignee', 'priority', 'status', 'channel', 'mailbox', 'tag'])
    .optional()
    .catch(undefined),
  sort: z
    .string()
    .regex(/^[a-zA-Z][a-zA-Z0-9_]{0,40}:(asc|desc)$/)
    .optional()
    .catch(undefined),
});

export const Route = createFileRoute('/app/inbox')({
  component: InboxLayout,
  validateSearch: inboxSearchSchema,
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
