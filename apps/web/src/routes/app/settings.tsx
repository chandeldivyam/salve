// /app/settings — single workbench tab with a horizontal section strip.

import { createFileRoute, Outlet } from '@tanstack/react-router';
import { ListChecks, Mail, Settings2, Tags } from 'lucide-react';
import { SectionStrip, type SectionStripItem } from '@/components/workbench/section-strip';

export const Route = createFileRoute('/app/settings')({
  component: SettingsLayout,
});

const SETTINGS_SECTIONS: readonly SectionStripItem[] = [
  {
    to: '/app/settings/setup',
    label: 'Setup',
    icon: ListChecks,
    match: (pathname) => pathname.startsWith('/app/settings/setup'),
  },
  {
    to: '/app/settings/channels/email',
    label: 'Email',
    icon: Mail,
    match: (pathname) =>
      pathname.startsWith('/app/settings/channels/email') ||
      pathname.startsWith('/app/settings/email/domains'),
  },
  {
    to: '/app/settings/tags',
    label: 'Tags',
    icon: Tags,
    match: (pathname) => pathname.startsWith('/app/settings/tags'),
  },
  {
    to: '/app/settings/custom-fields',
    label: 'Custom fields',
    icon: Settings2,
    match: (pathname) => pathname.startsWith('/app/settings/custom-fields'),
  },
];

function SettingsLayout() {
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <header className="flex shrink-0 flex-col gap-1 border-b border-border bg-surface px-4 py-4 sm:px-8">
        <h1 className="text-lg font-semibold text-foreground">Settings</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Configure workspace setup, channels, routing, tags, and customer metadata.
        </p>
      </header>
      <SectionStrip label="Settings sections" items={SETTINGS_SECTIONS} />
      <main className="flex min-w-0 flex-1 flex-col bg-background">
        <Outlet />
      </main>
    </div>
  );
}
