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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@opendesk/ui';
import { useLocation, useNavigate, useRouteContext } from '@tanstack/react-router';
import {
  Check,
  ChevronDown,
  Inbox,
  Laptop,
  ListChecks,
  LogOut,
  type LucideIcon,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Settings,
  Sun,
} from 'lucide-react';
import { useCallback, useState } from 'react';
import { ThemeSwitcher } from '@/components/theme-switcher';
import { authClient, switchWorkspace } from '@/lib/auth-client';
import { resetDraftsForSignOut } from '@/lib/composer-drafts';
import { showError } from '@/lib/feedback';
import { clearSessionCache, getCachedOrgs, type SessionData } from '@/lib/session-loader';
import { useSetupProgress } from '@/lib/setup-progress';
import { useShortcut } from '@/lib/shortcuts';
import { setThemeMode, type ThemeMode, useTheme } from '@/lib/theme';
import { useWorkbenchStore } from '@/lib/workbench';
import { WorkbenchLink } from './workbench-link';

export function WorkbenchLeftRail({ workspaceID }: { workspaceID: string | null }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { session } = useRouteContext({ from: '/app' }) as { session: SessionData };
  const orgs = getCachedOrgs();
  const progress = useSetupProgress(workspaceID);
  const resetWorkbench = useWorkbenchStore((state) => state.resetWorkbench);
  const collapsed = useWorkbenchStore((state) => state.leftRailCollapsed);
  const setCollapsed = useWorkbenchStore((state) => state.setLeftRailCollapsed);
  const [switchingWorkspace, setSwitchingWorkspace] = useState(false);

  const activeOrg = orgs.find((org) => org.id === workspaceID);

  const toggleCollapsed = useCallback(() => {
    setCollapsed(!useWorkbenchStore.getState().leftRailCollapsed);
  }, [setCollapsed]);

  useShortcut(
    '\\',
    (event) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      toggleCollapsed();
    },
    { allowInInputs: false },
  );

  async function onSwitch(nextWorkspaceID: string) {
    if (nextWorkspaceID === workspaceID) return;
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

  const pathname = location.pathname;

  return (
    <aside
      className={cn(
        'flex min-h-0 shrink-0 flex-col border-r border-border bg-surface',
        collapsed ? 'w-[52px]' : 'w-[240px]',
      )}
    >
      <div
        className={cn(
          'flex h-10 shrink-0 items-center border-b border-border',
          collapsed ? 'justify-center px-0' : 'justify-between gap-2 px-3',
        )}
      >
        {collapsed ? (
          <CollapseToggle collapsed={collapsed} onToggle={toggleCollapsed} />
        ) : (
          <>
            <WorkbenchLink
              href="/app/inbox"
              source="left-rail"
              className="inline-flex min-w-0 items-center rounded-md outline-none hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Salve home"
            >
              <Logo withWordmark size={19} />
            </WorkbenchLink>
            <CollapseToggle collapsed={collapsed} onToggle={toggleCollapsed} />
          </>
        )}
      </div>

      <div
        className={cn(
          'shrink-0 border-b border-border',
          collapsed ? 'flex justify-center px-1 py-2' : 'px-2 py-2',
        )}
      >
        <WorkspaceSwitcher
          orgs={orgs}
          activeOrg={activeOrg}
          collapsed={collapsed}
          switching={switchingWorkspace}
          onSwitch={onSwitch}
          onCreateNew={() => navigate({ to: '/app/workspaces/new' })}
        />
      </div>

      <nav
        className={cn(
          'flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto',
          collapsed ? 'items-center px-1 py-2' : 'px-2 py-3',
        )}
      >
        <div className={cn('w-full space-y-0.5', collapsed && 'flex flex-col items-center')}>
          <RailItem
            href="/app/inbox"
            icon={Inbox}
            label="Inbox"
            collapsed={collapsed}
            active={isActiveHref(pathname, '/app/inbox')}
          />
          <RailItem
            href="/app/settings/setup"
            icon={Settings}
            label="Settings"
            collapsed={collapsed}
            active={isActiveHref(pathname, '/app/settings')}
          />
          <RailItem
            href="/app/workspaces/new"
            icon={Plus}
            label="New workspace"
            collapsed={collapsed}
            active={isActiveHref(pathname, '/app/workspaces/new')}
          />
        </div>

        {!collapsed && progress.ready && !(progress.dismissed && progress.isComplete) ? (
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

      <div
        className={cn(
          'shrink-0 border-t border-border',
          collapsed ? 'flex justify-center px-1 py-2' : 'p-2',
        )}
      >
        {collapsed ? (
          <AccountMenu session={session} collapsed onSignOut={onSignOut} />
        ) : (
          <div className="flex items-center justify-between gap-2">
            <ThemeSwitcher />
            <AccountMenu session={session} collapsed={false} onSignOut={onSignOut} />
          </div>
        )}
      </div>
    </aside>
  );
}

function CollapseToggle({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const Icon = collapsed ? PanelLeftOpen : PanelLeftClose;
  const label = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onToggle}
          aria-label={label}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Icon className="h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

interface OrgLike {
  id: string;
  name: string;
}

function WorkspaceSwitcher({
  orgs,
  activeOrg,
  collapsed,
  switching,
  onSwitch,
  onCreateNew,
}: {
  orgs: OrgLike[];
  activeOrg: OrgLike | undefined;
  collapsed: boolean;
  switching: boolean;
  onSwitch: (id: string) => void;
  onCreateNew: () => void;
}) {
  const label = activeOrg?.name ?? (orgs.length === 0 ? 'No workspace' : 'Choose workspace');
  const initials = initialsFromName(activeOrg?.name ?? '', activeOrg?.id ?? 'W');

  const trigger = (
    <DropdownMenuTrigger asChild>
      <button
        type="button"
        disabled={switching}
        aria-label="Active workspace"
        className={cn(
          'group inline-flex items-center gap-2 rounded-md text-left text-[13px] font-medium text-foreground transition-colors',
          'hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          'disabled:cursor-not-allowed disabled:opacity-60',
          collapsed ? 'h-8 w-8 justify-center' : 'h-8 w-full px-2',
        )}
      >
        <Avatar size={20}>
          <AvatarFallback className="text-[10px]">{initials}</AvatarFallback>
        </Avatar>
        {!collapsed ? (
          <>
            <span className="min-w-0 flex-1 truncate">{switching ? 'Switching…' : label}</span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          </>
        ) : null}
      </button>
    </DropdownMenuTrigger>
  );

  return (
    <DropdownMenu>
      {collapsed ? (
        <Tooltip>
          <TooltipTrigger asChild>{trigger}</TooltipTrigger>
          <TooltipContent side="right">{label}</TooltipContent>
        </Tooltip>
      ) : (
        trigger
      )}
      <DropdownMenuContent
        align={collapsed ? 'start' : 'end'}
        side={collapsed ? 'right' : 'bottom'}
        className="w-60"
      >
        <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
        {orgs.length === 0 ? (
          <DropdownMenuItem disabled>No workspaces yet</DropdownMenuItem>
        ) : (
          orgs.map((org) => {
            const isActive = activeOrg?.id === org.id;
            return (
              <DropdownMenuItem key={org.id} onSelect={() => onSwitch(org.id)}>
                <Avatar size={18}>
                  <AvatarFallback className="text-[10px]">
                    {initialsFromName(org.name, org.id)}
                  </AvatarFallback>
                </Avatar>
                <span className="flex-1 truncate">{org.name}</span>
                {isActive ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : null}
              </DropdownMenuItem>
            );
          })
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onCreateNew}>
          <Plus className="h-3.5 w-3.5" /> Create new workspace…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AccountMenu({
  session,
  collapsed,
  onSignOut,
}: {
  session: SessionData;
  collapsed: boolean;
  onSignOut: () => void;
}) {
  const { mode } = useTheme();

  const trigger = (
    <DropdownMenuTrigger asChild>
      <button
        type="button"
        aria-label="Account"
        className={cn(
          'flex items-center gap-2 rounded-md text-left text-xs hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          collapsed ? 'h-8 w-8 justify-center' : 'min-w-0 flex-1 px-2 py-1',
        )}
      >
        <Avatar size={22}>
          <AvatarFallback>{initialsFromName(session.user.name, session.user.email)}</AvatarFallback>
        </Avatar>
        {!collapsed ? <span className="min-w-0 flex-1 truncate">{session.user.email}</span> : null}
      </button>
    </DropdownMenuTrigger>
  );

  return (
    <DropdownMenu>
      {collapsed ? (
        <Tooltip>
          <TooltipTrigger asChild>{trigger}</TooltipTrigger>
          <TooltipContent side="right">{session.user.email}</TooltipContent>
        </Tooltip>
      ) : (
        trigger
      )}
      <DropdownMenuContent align="end" side={collapsed ? 'right' : 'top'} className="w-56">
        <DropdownMenuLabel>Account</DropdownMenuLabel>
        <DropdownMenuItem disabled>{session.user.email}</DropdownMenuItem>
        {collapsed ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Theme</DropdownMenuLabel>
            <ThemeMenuItem id="system" current={mode} />
            <ThemeMenuItem id="light" current={mode} />
            <ThemeMenuItem id="dark" current={mode} />
          </>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onSignOut}>
          <LogOut className="h-3.5 w-3.5" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const THEME_LABELS: Record<ThemeMode, { label: string; icon: LucideIcon }> = {
  system: { label: 'System', icon: Laptop },
  light: { label: 'Light', icon: Sun },
  dark: { label: 'Dark', icon: Moon },
};

function ThemeMenuItem({ id, current }: { id: ThemeMode; current: ThemeMode }) {
  const { label, icon: Icon } = THEME_LABELS[id];
  const isActive = id === current;
  return (
    <DropdownMenuItem onSelect={() => setThemeMode(id)}>
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      <span className="flex-1">{label}</span>
      {isActive ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : null}
    </DropdownMenuItem>
  );
}

function RailItem({
  href,
  icon: Icon,
  label,
  collapsed,
  active,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  collapsed: boolean;
  active: boolean;
}) {
  const link = (
    <WorkbenchLink
      href={href}
      source="left-rail"
      aria-label={collapsed ? label : undefined}
      className={cn(
        'flex items-center rounded-md text-[13px] font-medium transition-colors',
        active
          ? 'bg-surface-muted text-foreground'
          : 'text-muted-foreground hover:bg-surface-muted hover:text-foreground',
        collapsed ? 'h-8 w-8 justify-center' : 'gap-2 px-2 py-1',
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {!collapsed ? <span className="truncate">{label}</span> : null}
    </WorkbenchLink>
  );

  if (!collapsed) return link;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

function isActiveHref(pathname: string, prefix: string): boolean {
  if (prefix === '/app/inbox') {
    return pathname === '/app/inbox' || pathname.startsWith('/app/inbox/');
  }
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}
