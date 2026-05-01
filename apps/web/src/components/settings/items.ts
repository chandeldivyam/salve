// Central registry of settings sidebar items. Keep this list authoritative —
// every settings sub-route should appear here exactly once. Grouping mirrors
// docs/port/05-settings-ux-plan.md §3.
//
// Custom fields stays one item for now; the in-page pill switches Ticket /
// Customer until we have enough categories to justify two sidebar entries.

import {
  Inbox,
  LayoutDashboard,
  ListChecks,
  Mail,
  Route as RouteIcon,
  Settings2,
  ShieldOff,
  Tags,
} from 'lucide-react';
import type { SettingsSidebarGroup } from './sidebar';

export function buildSettingsSidebarGroups({
  setupVisible,
  setupBadge,
}: {
  setupVisible: boolean;
  setupBadge?: string;
}): SettingsSidebarGroup[] {
  const workspaceItems = [];
  if (setupVisible) {
    workspaceItems.push({
      to: '/app/settings/setup',
      label: 'Setup',
      icon: ListChecks,
      badge: setupBadge,
    });
  }

  return [
    {
      label: 'Workspace',
      items: workspaceItems,
    },
    {
      label: 'Channels',
      items: [
        {
          to: '/app/settings/channels/email',
          label: 'Email overview',
          icon: LayoutDashboard,
          match: (p: string) =>
            p === '/app/settings/channels/email' || p === '/app/settings/channels/email/',
        },
        {
          to: '/app/settings/channels/email/domains',
          label: 'Domains',
          icon: Mail,
        },
        {
          to: '/app/settings/channels/email/addresses',
          label: 'Addresses',
          icon: Inbox,
        },
        {
          to: '/app/settings/channels/email/routing',
          label: 'Routing',
          icon: RouteIcon,
        },
        {
          to: '/app/settings/channels/email/suppressions',
          label: 'Suppressions',
          icon: ShieldOff,
        },
      ],
    },
    {
      label: 'Customization',
      items: [
        { to: '/app/settings/tags', label: 'Tags', icon: Tags },
        { to: '/app/settings/custom-fields', label: 'Custom fields', icon: Settings2 },
      ],
    },
  ].filter((group) => group.items.length > 0);
}
