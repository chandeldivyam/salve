import {
  Avatar,
  AvatarFallback,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  initialsFromName,
  Logo,
} from '@opendesk/ui';
import { useNavigate, useRouteContext } from '@tanstack/react-router';
import { Inbox, ListChecks, LogOut, type LucideIcon, Plus, Settings } from 'lucide-react';
import { useState } from 'react';
import { ThemeSwitcher } from '@/components/theme-switcher';
import { authClient, switchWorkspace } from '@/lib/auth-client';
import { resetDraftsForSignOut } from '@/lib/composer-drafts';
import { showError } from '@/lib/feedback';
import { clearSessionCache, getCachedOrgs, type SessionData } from '@/lib/session-loader';
import { useSetupProgress } from '@/lib/setup-progress';
import { useWorkbenchStore } from '@/lib/workbench';
import { WorkbenchLink } from './workbench-link';

export function WorkbenchLeftRail({ workspaceID }: { workspaceID: string | null }) {
  const navigate = useNavigate();
  const { session } = useRouteContext({ from: '/app' }) as { session: SessionData };
  const orgs = getCachedOrgs();
  const progress = useSetupProgress(workspaceID);
  const resetWorkbench = useWorkbenchStore((state) => state.resetWorkbench);
  const [switchingWorkspace, setSwitchingWorkspace] = useState(false);

  async function onSwitch(nextWorkspaceID: string) {
    setSwitchingWorkspace(true);
    try {
      await switchWorkspace(nextWorkspaceID);
      window.location.reload();
    } catch (err) {
      setSwitchingWorkspace(false);
      showError(err, 'Could not switch workspace.');
    }
  }

  async function onSignOut() {
    try {
      await authClient.signOut();
      clearSessionCache();
      resetWorkbench();
      resetDraftsForSignOut();
      await navigate({ to: '/auth/sign-in' });
    } catch (err) {
      showError(err, 'Could not sign out.');
    }
  }

  return (
    <aside className="flex min-h-0 w-[240px] shrink-0 flex-col border-r border-border bg-surface">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
        <WorkbenchLink
          href="/app/inbox"
          source="left-rail"
          className="inline-flex min-w-0 items-center rounded-md outline-none hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Salve home"
        >
          <Logo withWordmark size={19} />
        </WorkbenchLink>
      </div>

      <nav className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-2 py-3">
        <div className="space-y-1">
          <RailItem href="/app/inbox" icon={Inbox} label="Inbox" />
          <RailItem href="/app/settings/setup" icon={Settings} label="Settings" />
          <RailItem href="/app/workspaces/new" icon={Plus} label="New workspace" />
        </div>

        {progress.ready && !(progress.dismissed && progress.isComplete) ? (
          <WorkbenchLink
            href="/app/settings/setup"
            source="left-rail"
            className={cn(
              'rounded-md border border-brand-border bg-brand-soft px-3 py-2 text-xs text-brand-soft-foreground',
              'hover:bg-brand-soft/80',
            )}
          >
            <span className="flex items-center gap-2 font-medium">
              <ListChecks className="h-3.5 w-3.5" />
              Setup
              {!progress.isComplete ? (
                <span className="ml-auto tabular-nums">
                  {progress.completedCount}/{progress.total}
                </span>
              ) : null}
            </span>
            <span className="mt-1 block text-[11px] opacity-80">
              {progress.isComplete ? 'Workspace ready' : 'Finish workspace setup'}
            </span>
          </WorkbenchLink>
        ) : null}
      </nav>

      <div className="shrink-0 space-y-2 border-t border-border p-2">
        <select
          aria-label="Active workspace"
          className="h-8 w-full rounded-md border border-border bg-surface px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={workspaceID ?? ''}
          disabled={switchingWorkspace}
          onChange={(event) => {
            const value = event.target.value;
            if (value === '__new__') {
              navigate({ to: '/app/workspaces/new' });
              return;
            }
            if (value) onSwitch(value);
          }}
        >
          <option value="" disabled>
            {orgs.length === 0 ? 'No workspace' : 'Choose workspace'}
          </option>
          {orgs.map((org) => (
            <option key={org.id} value={org.id}>
              {org.name}
            </option>
          ))}
          <option value="__new__">Create new workspace...</option>
        </select>

        <div className="flex items-center justify-between gap-2">
          <ThemeSwitcher />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-surface-muted"
              >
                <Avatar size={22}>
                  <AvatarFallback>
                    {initialsFromName(session.user.name, session.user.email)}
                  </AvatarFallback>
                </Avatar>
                <span className="min-w-0 flex-1 truncate">{session.user.email}</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Account</DropdownMenuLabel>
              <DropdownMenuItem disabled>{session.user.email}</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onSignOut}>
                <LogOut className="h-3.5 w-3.5" /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </aside>
  );
}

function RailItem({ href, icon: Icon, label }: { href: string; icon: LucideIcon; label: string }) {
  return (
    <WorkbenchLink
      href={href}
      source="left-rail"
      className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-muted-foreground hover:bg-surface-muted hover:text-foreground"
    >
      <Icon className="h-4 w-4" />
      <span>{label}</span>
    </WorkbenchLink>
  );
}
