import { cn, Dialog, DialogContent, DialogDescription, DialogTitle } from '@opendesk/ui';
import { queries } from '@opendesk/zero-schema';
import { useQuery } from '@rocicorp/zero/react';
import { useRouteContext, useRouter } from '@tanstack/react-router';
import { Command } from 'cmdk';
import { AlertTriangle, Clock, type LucideIcon, Search, UserPlus, X as XIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  type BulkPriority,
  type BulkStatus,
  bulkAssign,
  bulkClose,
  bulkSetPriority,
  bulkSetStatus,
  bulkSnooze24h,
} from '@/components/inbox/bulk-actions';
import { useInboxSelectionStore } from '@/lib/inbox-selection';
import { isMod, useShortcut } from '@/lib/shortcuts';
import {
  actionDestinations,
  appDestinations,
  makeTicketTabHref,
  settingsDestinations,
  useWorkbenchStore,
  workbenchIconMap,
  workspaceKey,
} from '@/lib/workbench';
import { useZero } from '@/lib/zero';
import { CACHE_FOREVER } from '@/lib/zero-cache';
import { navigateWorkbenchHref } from './navigation';

interface CommandPaletteProps {
  workspaceID: string | null;
}

interface NavPaletteItem {
  kind: 'nav';
  id: string;
  label: string;
  description: string;
  href: string;
  iconId: keyof typeof workbenchIconMap;
  group: 'open-tabs' | 'recent-tickets' | 'apps' | 'settings' | 'actions';
  tabID?: string;
}

interface BulkPaletteItem {
  kind: 'bulk';
  id: string;
  label: string;
  description: string;
  group: 'bulk';
  Icon: LucideIcon;
  run: () => void | Promise<void>;
}

type PaletteItem = NavPaletteItem | BulkPaletteItem;

const NAV_GROUP_LABELS: Record<NavPaletteItem['group'], string> = {
  'open-tabs': 'Open tabs',
  'recent-tickets': 'Recent tickets',
  apps: 'Apps',
  settings: 'Settings',
  actions: 'Actions',
};

const NAV_GROUP_ORDER: ReadonlyArray<NavPaletteItem['group']> = [
  'open-tabs',
  'recent-tickets',
  'apps',
  'settings',
  'actions',
];

const EMPTY_TABS: never[] = [];
const EMPTY_RECENT_TICKETS: string[] = [];

const STATUS_LABELS: ReadonlyArray<{ id: BulkStatus; label: string }> = [
  { id: 'open', label: 'Open' },
  { id: 'in_progress', label: 'In progress' },
  { id: 'snoozed', label: 'Snoozed' },
  { id: 'resolved', label: 'Resolved' },
  { id: 'closed', label: 'Closed' },
];

const PRIORITY_LABELS: ReadonlyArray<{ id: BulkPriority; label: string }> = [
  { id: 'urgent', label: 'Urgent' },
  { id: 'high', label: 'High' },
  { id: 'normal', label: 'Normal' },
  { id: 'low', label: 'Low' },
];

export function CommandPalette({ workspaceID }: CommandPaletteProps) {
  const router = useRouter();
  const z = useZero();
  const ctx = useRouteContext({ from: '/app' }) as { session: { user: { id: string } } };
  const currentUserID = ctx.session.user.id;
  const key = workspaceKey(workspaceID);
  const open = useWorkbenchStore((state) => state.commandOpen);
  const setOpen = useWorkbenchStore((state) => state.setCommandOpen);
  const tabs = useWorkbenchStore((state) => state.tabsByWorkspace[key] ?? EMPTY_TABS);
  const recentTickets = useWorkbenchStore(
    (state) => state.recentTicketsByWorkspace[key] ?? EMPTY_RECENT_TICKETS,
  );
  const openOrReuseTab = useWorkbenchStore((state) => state.openOrReuseTab);
  const forkTab = useWorkbenchStore((state) => state.forkTab);
  const activateTab = useWorkbenchStore((state) => state.activateTab);

  // Bulk-action selection — drives the conditional first section.
  const selectionIds = useInboxSelectionStore((s) => s.ids);
  const clearSelection = useInboxSelectionStore((s) => s.clear);
  const bulkRunOpts = useMemo(
    () => ({ ids: selectionIds, z, onSuccess: clearSelection }),
    [selectionIds, z, clearSelection],
  );

  const [memberRows] = useQuery(queries.workspaceMembers(), CACHE_FOREVER);
  const [selectedItemID, setSelectedItemID] = useState('');

  useShortcut(
    'k',
    (event) => {
      if (!isMod(event)) return;
      event.preventDefault();
      setOpen(true);
    },
    { allowInInputs: true, preventDefault: false },
  );

  // Bulk items — only emitted when there's a selection. Each item closes
  // the palette and fires the corresponding bulk-actions helper.
  const bulkItems = useMemo<BulkPaletteItem[]>(() => {
    if (selectionIds.length === 0) return [];
    const items: BulkPaletteItem[] = [];

    items.push({
      kind: 'bulk',
      id: 'bulk-assign-me',
      label: 'Assign to me',
      description: `Assign ${selectionIds.length} tickets to yourself`,
      group: 'bulk',
      Icon: UserPlus,
      run: () => bulkAssign(bulkRunOpts, currentUserID),
    });

    items.push({
      kind: 'bulk',
      id: 'bulk-unassign',
      label: 'Unassign',
      description: 'Remove the assignee from selected tickets',
      group: 'bulk',
      Icon: UserPlus,
      run: () => bulkAssign(bulkRunOpts, null),
    });

    for (const m of memberRows) {
      const userID = m.userId;
      if (!userID || userID === currentUserID) continue;
      const label = m.user?.name ?? m.user?.email ?? userID;
      items.push({
        kind: 'bulk',
        id: `bulk-assign-${m.id}`,
        label: `Assign to ${label}`,
        description: m.user?.email ?? '',
        group: 'bulk',
        Icon: UserPlus,
        run: () => bulkAssign(bulkRunOpts, userID),
      });
    }

    for (const s of STATUS_LABELS) {
      items.push({
        kind: 'bulk',
        id: `bulk-status-${s.id}`,
        label: `Set status: ${s.label}`,
        description: `Move ${selectionIds.length} tickets to ${s.label.toLowerCase()}`,
        group: 'bulk',
        Icon: AlertTriangle,
        run: () => bulkSetStatus(bulkRunOpts, s.id),
      });
    }

    for (const p of PRIORITY_LABELS) {
      items.push({
        kind: 'bulk',
        id: `bulk-priority-${p.id}`,
        label: `Set priority: ${p.label}`,
        description: `Set ${selectionIds.length} tickets to ${p.label.toLowerCase()}`,
        group: 'bulk',
        Icon: AlertTriangle,
        run: () => bulkSetPriority(bulkRunOpts, p.id),
      });
    }

    items.push({
      kind: 'bulk',
      id: 'bulk-snooze-24h',
      label: 'Snooze 24h',
      description: `Snooze ${selectionIds.length} tickets for 24 hours`,
      group: 'bulk',
      Icon: Clock,
      run: () => bulkSnooze24h(bulkRunOpts),
    });

    items.push({
      kind: 'bulk',
      id: 'bulk-close',
      label: 'Close',
      description: `Close ${selectionIds.length} tickets`,
      group: 'bulk',
      Icon: XIcon,
      run: () => bulkClose(bulkRunOpts),
    });

    return items;
  }, [bulkRunOpts, currentUserID, memberRows, selectionIds.length]);

  const navItems = useMemo<NavPaletteItem[]>(
    () => [
      ...tabs.map<NavPaletteItem>((tab) => ({
        kind: 'nav',
        id: `tab-${tab.id}`,
        label: tab.customTitle ?? tab.title,
        description: tab.href,
        href: tab.href,
        iconId: tab.iconId as keyof typeof workbenchIconMap,
        group: 'open-tabs',
        tabID: tab.id,
      })),
      ...recentTickets.map<NavPaletteItem>((ticketID) => ({
        kind: 'nav',
        id: `recent-ticket-${ticketID}`,
        label: `Ticket ${ticketID}`,
        description: 'Recent ticket',
        href: makeTicketTabHref(ticketID),
        iconId: 'ticket',
        group: 'recent-tickets',
      })),
      ...appDestinations.map<NavPaletteItem>((item) => ({ kind: 'nav', ...item, group: 'apps' })),
      ...settingsDestinations.map<NavPaletteItem>((item) => ({
        kind: 'nav',
        ...item,
        group: 'settings',
      })),
      ...actionDestinations.map<NavPaletteItem>((item) => ({
        kind: 'nav',
        ...item,
        group: 'actions',
      })),
    ],
    [recentTickets, tabs],
  );

  const navGroups = useMemo(() => {
    const grouped = navItems.reduce<Record<string, NavPaletteItem[]>>((acc, item) => {
      acc[item.group] = [...(acc[item.group] ?? []), item];
      return acc;
    }, {});
    return NAV_GROUP_ORDER.flatMap((group) => {
      const groupItems = grouped[group];
      return groupItems && groupItems.length > 0
        ? ([[group, groupItems]] as Array<[NavPaletteItem['group'], NavPaletteItem[]]>)
        : [];
    });
  }, [navItems]);

  const allItems = useMemo<PaletteItem[]>(() => [...bulkItems, ...navItems], [bulkItems, navItems]);

  function selectItem(item: PaletteItem, fork = false) {
    if (item.kind === 'bulk') {
      setOpen(false);
      void item.run();
      return;
    }
    setOpen(false);
    if (item.tabID && !fork) {
      activateTab(key, item.tabID);
      navigateWorkbenchHref(router, item.href);
      return;
    }
    const tab = fork
      ? forkTab(key, item.href, 'command')
      : openOrReuseTab(key, item.href, 'command');
    navigateWorkbenchHref(router, tab.href);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent hideClose className="top-[10vh] overflow-hidden p-0">
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <DialogDescription className="sr-only">
          Search open tabs, recent tickets, apps, settings, and actions.
        </DialogDescription>
        <Command
          value={selectedItemID}
          onValueChange={setSelectedItemID}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || !isMod(event)) return;
            const item =
              allItems.find((candidate) => candidate.id === selectedItemID) ?? allItems[0];
            if (!item) return;
            event.preventDefault();
            selectItem(item, true);
          }}
          className="flex max-h-[min(680px,80vh)] flex-col overflow-hidden bg-popover text-popover-foreground"
        >
          <div className="flex h-12 items-center gap-2 border-b border-border px-3">
            <Search className="h-4 w-4 text-muted-foreground" />
            <Command.Input
              autoFocus
              placeholder={
                bulkItems.length > 0
                  ? `Run a bulk action on ${selectionIds.length} tickets…`
                  : 'Search tabs, tickets, apps, settings...'
              }
              className="h-full flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
              Esc
            </kbd>
          </div>
          <Command.List className="max-h-[560px] overflow-y-auto p-2">
            <Command.Empty className="px-3 py-8 text-center text-sm text-muted-foreground">
              No results
            </Command.Empty>
            {bulkItems.length > 0 ? (
              <Command.Group
                heading={`Bulk actions on ${selectionIds.length} ${
                  selectionIds.length === 1 ? 'ticket' : 'tickets'
                }`}
                className="pb-2 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-brand-soft-foreground"
              >
                {bulkItems.map((item) => {
                  const Icon = item.Icon;
                  return (
                    <Command.Item
                      key={item.id}
                      value={item.id}
                      keywords={[item.label, item.description]}
                      onSelect={() => selectItem(item)}
                      className={cn(
                        'flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm outline-none',
                        'aria-selected:bg-brand-soft aria-selected:text-brand-soft-foreground',
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{item.label}</span>
                        {item.description ? (
                          <span className="block truncate text-xs text-muted-foreground">
                            {item.description}
                          </span>
                        ) : null}
                      </span>
                    </Command.Item>
                  );
                })}
              </Command.Group>
            ) : null}
            {navGroups.map(([group, items]) => (
              <Command.Group
                key={group}
                heading={NAV_GROUP_LABELS[group]}
                className="pb-2 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-muted-foreground"
              >
                {items.map((item) => {
                  const Icon = workbenchIconMap[item.iconId] ?? workbenchIconMap.ticket;
                  return (
                    <Command.Item
                      key={item.id}
                      value={item.id}
                      keywords={[item.label, item.description, item.href]}
                      onSelect={() => selectItem(item)}
                      className={cn(
                        'flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm outline-none',
                        'aria-selected:bg-brand-soft aria-selected:text-brand-soft-foreground',
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{item.label}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {item.description}
                        </span>
                      </span>
                    </Command.Item>
                  );
                })}
              </Command.Group>
            ))}
          </Command.List>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
