// /app/inbox/t/$ticketId — customer-anchored ticket timeline.

import { createFileRoute } from '@tanstack/react-router';
import { TimelineFeed } from '@/components/timeline/timeline-feed';
import { useScope } from '@/lib/commands/use-scope';

export const Route = createFileRoute('/app/inbox/t/$ticketId')({
  component: TicketTimelineRoute,
});

function TicketTimelineRoute() {
  useScope('conversation');
  const { ticketId } = Route.useParams();
  return <TimelineFeed mode="single-ticket" anchorTicketID={ticketId} />;
}
