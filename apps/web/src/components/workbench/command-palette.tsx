import { cn, Dialog, DialogContent, DialogDescription, DialogTitle } from '@opendesk/ui';
import { useRouter } from '@tanstack/react-router';
import { Command } from 'cmdk';
import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';
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
import { navigateWorkbenchHref } from './navigation';

interface CommandPaletteProps {
  workspaceID: string | null;
}

interface PaletteItem {
  id: string;
  label: string;
  description: string;
  href: string;
  iconId: keyof typeof workbenchIconMap;
  group: 'open-tabs' | 'recent-tickets' | 'apps' | 'settings' | 'actions';
  tabID?: string;
}

const GROUP_LABELS: Record<PaletteItem['group'], string> = {
  'open-tabs': 'Open tabs',
  'recent-tickets': 'Recent tickets',
  apps: 'Apps',
  settings: 'Settings',
  actions: 'Actions',
};

const EMPTY_TABS: never[] = [];
const EMPTY_RECENT_TICKETS: string[] = [];

export function CommandPalette({ workspaceID }: CommandPaletteProps) {
  const router = useRouter();
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

  const items = useMemo<PaletteItem[]>(
    () => [
      ...tabs.map<PaletteItem>((tab) => ({
        id: `tab-${tab.id}`,
        label: tab.customTitle ?? tab.title,
        description: tab.href,
        href: tab.href,
        iconId: tab.iconId as keyof typeof workbenchIconMap,
        group: 'open-tabs',
        tabID: tab.id,
      })),
      ...recentTickets.map<PaletteItem>((ticketID) => ({
        id: `recent-ticket-${ticketID}`,
        label: `Ticket ${ticketID}`,
        description: 'Recent ticket',
        href: makeTicketTabHref(ticketID),
        iconId: 'ticket',
        group: 'recent-tickets',
      })),
      ...appDestinations.map<PaletteItem>((item) => ({ ...item, group: 'apps' })),
      ...settingsDestinations.map<PaletteItem>((item) => ({ ...item, group: 'settings' })),
      ...actionDestinations.map<PaletteItem>((item) => ({ ...item, group: 'actions' })),
    ],
    [recentTickets, tabs],
  );

  const groups = useMemo(() => {
    return Object.entries(
      items.reduce<Record<string, PaletteItem[]>>((acc, item) => {
        acc[item.group] = [...(acc[item.group] ?? []), item];
        return acc;
      }, {}),
    ) as Array<[PaletteItem['group'], PaletteItem[]]>;
  }, [items]);

  function selectItem(item: PaletteItem, fork = false) {
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
            const item = items.find((candidate) => candidate.id === selectedItemID) ?? items[0];
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
              placeholder="Search tabs, tickets, apps, settings..."
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
            {groups.map(([group, items]) => (
              <Command.Group
                key={group}
                heading={GROUP_LABELS[group]}
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
