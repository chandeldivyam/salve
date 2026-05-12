// /app/settings/migrations/atlas — passthrough layout. Children declare
// their own SettingsHeader; this file only exists so TanStack's file-based
// routes nest `atlas/webhooks` under `atlas/index` correctly.

import { createFileRoute, Outlet } from '@tanstack/react-router';

export const Route = createFileRoute('/app/settings/migrations/atlas')({
  component: AtlasMigrationsLayout,
});

function AtlasMigrationsLayout() {
  return <Outlet />;
}
