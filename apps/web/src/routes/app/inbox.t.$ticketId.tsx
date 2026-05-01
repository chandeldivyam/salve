// /app/inbox/t/$ticketId — customer-anchored ticket timeline.

import { createFileRoute } from '@tanstack/react-router';
import { TimelineFeed } from '@/components/timeline/timeline-feed';

export const Route = createFileRoute('/app/inbox/t/$ticketId')({
  component: TicketTimelineRoute,
});

function TicketTimelineRoute() {
  const { ticketId } = Route.useParams();
  return <TimelineFeed mode="single-ticket" anchorTicketID={ticketId} />;
}
