// /app/customers/$customerId — customer profile timeline shell.

import { createFileRoute } from '@tanstack/react-router';
import { TimelineFeed } from '@/components/timeline/timeline-feed';

export const Route = createFileRoute('/app/customers/$customerId')({
  component: CustomerTimelineRoute,
});

function CustomerTimelineRoute() {
  const { customerId } = Route.useParams();
  return <TimelineFeed mode="customer" customerID={customerId} />;
}
