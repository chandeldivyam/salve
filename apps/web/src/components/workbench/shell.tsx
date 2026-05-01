import { useLocation } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { CommandPalette } from '@/components/workbench/command-palette';
import { WorkbenchLeftRail } from '@/components/workbench/left-rail';
import { WorkbenchTabStrip } from '@/components/workbench/tab-strip';
import { useComposerDraftsStore } from '@/lib/composer-drafts';
import type { SessionData } from '@/lib/session-loader';
import { selectActiveWorkspaceTab, useWorkbenchStore, workspaceKey } from '@/lib/workbench';

interface WorkbenchShellProps {
  session: SessionData;
  children: ReactNode;
}

export function WorkbenchShell({ session, children }: WorkbenchShellProps) {
  const location = useLocation();
  const workspaceID = session.session.activeOrganizationId ?? null;
  const key = workspaceKey(workspaceID);
  const initialize = useWorkbenchStore((state) => state.initialize);
  const syncLocation = useWorkbenchStore((state) => state.syncLocation);
  const initializeDrafts = useComposerDraftsStore((state) => state.initializeDrafts);
  const activeTabID = useWorkbenchStore((state) => state.activeTabIdByWorkspace[key]);
  const activeTab = selectActiveWorkspaceTab(key);

  useEffect(() => {
    initialize(session.user.id, workspaceID);
    initializeDrafts(session.user.id);
  }, [initialize, initializeDrafts, session.user.id, workspaceID]);

  useEffect(() => {
    syncLocation(workspaceID, {
      pathname: location.pathname,
      search: location.searchStr,
      hash: location.hash,
    });
  }, [location.hash, location.pathname, location.searchStr, syncLocation, workspaceID]);

  return (
    <div className="grid h-dvh grid-cols-[240px_minmax(0,1fr)] grid-rows-[40px_minmax(0,1fr)] bg-background text-foreground">
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
      <CommandPalette workspaceID={workspaceID} />
    </div>
  );
}
