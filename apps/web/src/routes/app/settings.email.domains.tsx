// /app/settings/email/domains — pathless layout; child routes render in the
// Outlet. The actual list lives in `./settings.email.domains.index.tsx`; the
// detail page is `./settings.email.domains.$domainId.tsx`.

import { createFileRoute, Outlet } from '@tanstack/react-router';

export const Route = createFileRoute('/app/settings/email/domains')({
  component: () => <Outlet />,
});
