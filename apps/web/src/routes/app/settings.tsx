// /app/settings — passthrough layout. The workbench left-rail detects the
// settings path and swaps its nav to the settings sidebar (single-rail
// takeover, Linear-shape). See docs/port/05-settings-ux-plan.md.

import { createFileRoute, Outlet } from '@tanstack/react-router';

export const Route = createFileRoute('/app/settings')({
  component: SettingsLayout,
});

function SettingsLayout() {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
      <Outlet />
    </div>
  );
}
