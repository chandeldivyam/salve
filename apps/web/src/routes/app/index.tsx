// Phase 2c: `/app` no longer renders standalone — it just bounces to the
// inbox. The full shell (header + two-pane layout) lives at `/app/inbox`.
//
// We resolve here so that direct visits to `/app` from URL bar / sign-in
// redirect / browser bookmarks always land on the canonical inbox URL
// instead of an empty layout.

import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/app/')({
  beforeLoad: () => {
    throw redirect({ to: '/app/inbox' });
  },
});
