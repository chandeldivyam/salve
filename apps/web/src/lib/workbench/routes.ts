import {
  Inbox,
  ListChecks,
  type LucideIcon,
  Mail,
  Settings,
  Tags,
  TextCursorInput,
} from 'lucide-react';

export type WorkbenchRouteKind = 'app' | 'record' | 'utility';

export interface WorkbenchLocation {
  pathname: string;
  search?: string;
  hash?: string;
}

export interface WorkbenchRouteMatch {
  route: WorkbenchRouteDef;
  params: Record<string, string>;
  href: string;
  tabKey: string;
  title: string;
}

export interface WorkbenchRouteDef {
  id: string;
  kind: WorkbenchRouteKind;
  match: (pathname: string, search: URLSearchParams) => Record<string, string> | null;
  tabKey: (params: Record<string, string>, search: URLSearchParams) => string;
  defaultHref: string;
  title: (params: Record<string, string>, search: URLSearchParams) => string;
  iconId: WorkbenchIconId;
  pinnedByDefault?: boolean;
  closable?: boolean;
  searchable?: boolean;
  transientSearchParams?: readonly string[];
}

export type WorkbenchIconId =
  | 'inbox'
  | 'ticket'
  | 'settings'
  | 'setup'
  | 'email'
  | 'tags'
  | 'custom-fields'
  | 'workspace';

export interface WorkbenchSearchDestination {
  id: string;
  label: string;
  description: string;
  href: string;
  iconId: WorkbenchIconId;
  group: 'apps' | 'settings' | 'actions';
}

const TRANSIENT_SETTINGS_PARAMS = ['action'] as const;

function exact(path: string) {
  return (pathname: string) => pathname === path || pathname === `${path}/`;
}

function startsWith(path: string) {
  return (pathname: string) => pathname === path || pathname.startsWith(`${path}/`);
}

function ticketParams(pathname: string): Record<string, string> | null {
  const match = /^\/app\/inbox\/t\/([^/]+)\/?$/.exec(pathname);
  return match?.[1] ? { ticketId: decodeURIComponent(match[1]) } : null;
}

export const workbenchRoutes: readonly WorkbenchRouteDef[] = [
  {
    id: 'ticket',
    kind: 'record',
    match: (pathname, search) => {
      if (search.get('fullDetail') !== '1') return null;
      return ticketParams(pathname);
    },
    tabKey: (params) => `ticket:${params.ticketId ?? 'unknown'}`,
    defaultHref: '/app/inbox',
    title: (params) => `Ticket ${params.ticketId ?? ''}`.trim(),
    iconId: 'ticket',
    closable: true,
    transientSearchParams: ['action'],
  },
  {
    id: 'inbox',
    kind: 'app',
    match: (pathname) => (startsWith('/app/inbox')(pathname) ? {} : null),
    tabKey: () => 'inbox',
    defaultHref: '/app/inbox',
    title: () => 'Inbox',
    iconId: 'inbox',
    pinnedByDefault: true,
    closable: false,
    searchable: true,
    transientSearchParams: ['action', 'fullDetail'],
  },
  {
    id: 'settings',
    kind: 'utility',
    match: (pathname) => (startsWith('/app/settings')(pathname) ? {} : null),
    tabKey: () => 'settings',
    defaultHref: '/app/settings/setup',
    title: () => 'Settings',
    iconId: 'settings',
    closable: true,
    searchable: true,
    transientSearchParams: TRANSIENT_SETTINGS_PARAMS,
  },
  {
    id: 'workspaces-new',
    kind: 'utility',
    match: (pathname) => (exact('/app/workspaces/new')(pathname) ? {} : null),
    tabKey: () => 'workspaces-new',
    defaultHref: '/app/workspaces/new',
    title: () => 'New workspace',
    iconId: 'workspace',
    closable: true,
    searchable: false,
    transientSearchParams: ['action'],
  },
];

export const settingsDestinations: readonly WorkbenchSearchDestination[] = [
  {
    id: 'settings-setup',
    label: 'Setup',
    description: 'Workspace checklist',
    href: '/app/settings/setup',
    iconId: 'setup',
    group: 'settings',
  },
  {
    id: 'settings-email',
    label: 'Email channel',
    description: 'Domains, addresses, routing, suppressions',
    href: '/app/settings/channels/email',
    iconId: 'email',
    group: 'settings',
  },
  {
    id: 'settings-tags',
    label: 'Tags',
    description: 'Ticket tag groups and labels',
    href: '/app/settings/tags',
    iconId: 'tags',
    group: 'settings',
  },
  {
    id: 'settings-custom-fields',
    label: 'Custom fields',
    description: 'Ticket and customer metadata',
    href: '/app/settings/custom-fields',
    iconId: 'custom-fields',
    group: 'settings',
  },
];

export const appDestinations: readonly WorkbenchSearchDestination[] = [
  {
    id: 'app-inbox',
    label: 'Inbox',
    description: 'Triage customer conversations',
    href: '/app/inbox',
    iconId: 'inbox',
    group: 'apps',
  },
];

export const actionDestinations: readonly WorkbenchSearchDestination[] = [
  {
    id: 'action-new-workspace',
    label: 'Create workspace',
    description: 'Add another workspace',
    href: '/app/workspaces/new',
    iconId: 'workspace',
    group: 'actions',
  },
];

export const workbenchIconMap: Record<WorkbenchIconId, LucideIcon> = {
  inbox: Inbox,
  ticket: Mail,
  settings: Settings,
  setup: ListChecks,
  email: Mail,
  tags: Tags,
  'custom-fields': TextCursorInput,
  workspace: Settings,
};
