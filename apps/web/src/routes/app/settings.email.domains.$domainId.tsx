// Legacy redirect — Slice 3 moved the canonical detail page to
// /app/settings/channels/email/domains/$domainId. Kept for one slice in
// case any deep-link still references the old path. Slice 4 deletes this.

import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/app/settings/email/domains/$domainId')({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/app/settings/channels/email/domains/$domainId',
      params: { domainId: params.domainId },
    });
  },
  component: () => null,
});
