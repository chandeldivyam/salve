// Legacy redirect — Slice 3 moved the canonical list to
// /app/settings/channels/email/domains. Kept for one slice in case any
// external link or backend redirect still points here. Slice 4 should
// delete this file.

import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/app/settings/email/domains/')({
  beforeLoad: () => {
    throw redirect({ to: '/app/settings/channels/email/domains' });
  },
  component: () => null,
});
