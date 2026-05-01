// /app/settings/channels/email — passthrough layout. The settings sidebar
// owns navigation between Email overview/domains/addresses/routing/
// suppressions, so this layout no longer renders its own header or tab strip.
// Each child route declares its own SettingsHeader.

import { createFileRoute, Outlet } from '@tanstack/react-router';

export const Route = createFileRoute('/app/settings/channels/email')({
  component: EmailChannelLayout,
});

function EmailChannelLayout() {
  return <Outlet />;
}
