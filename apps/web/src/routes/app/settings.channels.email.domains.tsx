// /app/settings/channels/email/domains — pathless layout. List + detail
// pages render in <Outlet />.

import { createFileRoute, Outlet } from '@tanstack/react-router';

export const Route = createFileRoute('/app/settings/channels/email/domains')({
  component: () => <Outlet />,
});
