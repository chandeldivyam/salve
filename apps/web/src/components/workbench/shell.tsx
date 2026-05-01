import { useLocation, useRouter } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { CommandPalette } from '@/components/command/command-palette';
import { HelpModal } from '@/components/command/help-modal';
import { WorkbenchLeftRail } from '@/components/workbench/left-rail';
import { WorkbenchTabStrip } from '@/components/workbench/tab-strip';
import { commandCatalog } from '@/lib/commands/catalog';
import { ChordHud } from '@/lib/commands/chord-hud';
import { HotkeyDispatcher } from '@/lib/commands/dispatcher';
import { useCommandRegistry } from '@/lib/commands/registry';
import { useRouteTarget } from '@/lib/commands/route-target';
import { useKeyBinding } from '@/lib/commands/use-key-binding';
import { useScope } from '@/lib/commands/use-scope';
import { useComposerDraftsStore } from '@/lib/composer-drafts';
import type { SessionData } from '@/lib/session-loader';
import { selectActiveWorkspaceTab, useWorkbenchStore, workspaceKey } from '@/lib/workbench';
import { useZero } from '@/lib/zero';
import { navigateWorkbenchHref } from './navigation';

interface WorkbenchShellProps {
  session: SessionData;
  children: ReactNode;
}

export function WorkbenchShell({ session, children }: WorkbenchShellProps) {
  const location = useLocation();
  const router = useRouter();
  const z = useZero();
  const workspaceID = session.session.activeOrganizationId ?? null;
  const key = workspaceKey(workspaceID);
  const initialize = useWorkbenchStore((state) => state.initialize);
  const syncLocation = useWorkbenchStore((state) => state.syncLocation);
  const initializeDrafts = useComposerDraftsStore((state) => state.initializeDrafts);
  const activeTabID = useWorkbenchStore((state) => state.activeTabIdByWorkspace[key]);
  const activeTab = selectActiveWorkspaceTab(key);
  const leftRailCollapsed = useWorkbenchStore((state) => state.leftRailCollapsed);
  const setCommandOpen = useWorkbenchStore((state) => state.setCommandOpen);

  useScope('app');
  useRouteTarget(location.pathname);

  useEffect(() => {
    initialize(session.user.id, workspaceID);
    initializeDrafts(session.user.id);
  }, [initialize, initializeDrafts, session.user.id, workspaceID]);

  useEffect(() => {
    useCommandRegistry.getState().setCommands(commandCatalog);
  }, []);

  useEffect(() => {
    useCommandRegistry.getState().setCommandContext({
      workspaceID,
      userID: session.user.id,
      z,
      routePathname: location.pathname,
      openPalette: () => setCommandOpen(true),
      closePalette: () => setCommandOpen(false),
      openHelp: () => useCommandRegistry.getState().setHelpOpen(true),
      closeHelp: () => useCommandRegistry.getState().setHelpOpen(false),
      navigateHref: (href) => navigateWorkbenchHref(router, href),
    });
    return () => useCommandRegistry.getState().setCommandContext(null);
  }, [location.pathname, router, session.user.id, setCommandOpen, workspaceID, z]);

  useEffect(() => {
    syncLocation(workspaceID, {
      pathname: location.pathname,
      search: location.searchStr,
      hash: location.hash,
    });
  }, [location.hash, location.pathname, location.searchStr, syncLocation, workspaceID]);

  useKeyBinding('$mod+k', () => setCommandOpen(!useWorkbenchStore.getState().commandOpen), {
    scopes: ['global'],
    allowInInputs: true,
    preventDefault: true,
    label: 'Open command palette',
    group: 'Navigation',
  });
  useKeyBinding('?', () => useCommandRegistry.getState().setHelpOpen(true), {
    scopes: ['global'],
    label: 'Open keyboard shortcuts',
    group: 'Help',
  });
  useKeyBinding('$mod+/', () => useCommandRegistry.getState().setHelpOpen(true), {
    scopes: ['global'],
    allowInInputs: true,
    label: 'Open keyboard shortcuts',
    group: 'Help',
  });
  useKeyBinding('g i', () => navigateWorkbenchHref(router, '/app/inbox'), {
    scopes: ['app'],
    label: 'Go to inbox',
    group: 'Navigation',
    commandId: 'nav.inbox',
  });
  useKeyBinding('g s', () => navigateWorkbenchHref(router, '/app/settings/setup'), {
    scopes: ['app'],
    label: 'Go to settings',
    group: 'Navigation',
    commandId: 'nav.settings',
  });
  useKeyBinding('g c', () => navigateWorkbenchHref(router, '/app/customers'), {
    scopes: ['app'],
    label: 'Go to customers',
    group: 'Navigation',
    commandId: 'nav.customers',
  });
  useKeyBinding(
    'p',
    { type: 'command', commandId: 'ticket.priority' },
    {
      scopes: ['inbox', 'conversation'],
      label: 'Set priority',
      group: 'Ticket',
      commandId: 'ticket.priority',
    },
  );
  useKeyBinding(
    's',
    { type: 'command', commandId: 'ticket.snooze.24h' },
    {
      scopes: ['inbox', 'conversation'],
      label: 'Snooze ticket',
      group: 'Ticket',
      commandId: 'ticket.snooze.24h',
    },
  );
  useKeyBinding(
    'a',
    { type: 'command', commandId: 'ticket.assign.me' },
    {
      scopes: ['inbox', 'conversation'],
      label: 'Assign to me',
      group: 'Ticket',
      commandId: 'ticket.assign.me',
    },
  );
  useKeyBinding(
    'e',
    { type: 'command', commandId: 'ticket.close' },
    {
      scopes: ['conversation'],
      label: 'Close ticket',
      group: 'Ticket',
      commandId: 'ticket.close',
    },
  );

  return (
    <div
      className="grid h-dvh grid-rows-[40px_minmax(0,1fr)] bg-background text-foreground transition-[grid-template-columns] duration-200 ease-out"
      style={{
        gridTemplateColumns: `${leftRailCollapsed ? '52px' : '240px'} minmax(0,1fr)`,
      }}
    >
      <div className="row-span-2 min-h-0">
        <WorkbenchLeftRail workspaceID={workspaceID} />
      </div>
      <WorkbenchTabStrip workspaceID={workspaceID} />
      <main
        key={`tab-${activeTabID ?? activeTab?.id ?? 'initial'}`}
        className="flex min-h-0 min-w-0 overflow-hidden bg-background"
      >
        {children}
      </main>
      <HotkeyDispatcher />
      <ChordHud />
      <CommandPalette workspaceID={workspaceID} />
      <HelpModal />
    </div>
  );
}
