import { z } from 'zod';
import { create } from 'zustand';
import { resolveWorkbenchHref, resolveWorkbenchLocation } from './url';

export type TabOpenSource =
  | 'location'
  | 'left-rail'
  | 'tab'
  | 'ticket-row'
  | 'command'
  | 'context-menu'
  | 'shortcut';

export interface WorkbenchTab {
  id: string;
  routeId: string;
  tabKey: string;
  href: string;
  title: string;
  customTitle?: string;
  iconId: string;
  pinned: boolean;
  workspaceID: string;
  lastActiveAt: number;
}

interface WorkbenchPersistedState {
  tabsByWorkspace: Record<string, WorkbenchTab[]>;
  activeTabIdByWorkspace: Record<string, string>;
  recentClosedTabsByWorkspace: Record<string, WorkbenchTab[]>;
  recentTicketsByWorkspace: Record<string, string[]>;
  leftRailCollapsed: boolean;
}

interface WorkbenchStore extends WorkbenchPersistedState {
  userID: string | null;
  workspaceID: string | null;
  commandOpen: boolean;
  hydrated: boolean;
  initialize: (userID: string, workspaceID: string | null) => void;
  resetWorkbench: () => void;
  syncLocation: (
    workspaceID: string | null,
    location: { pathname: string; search?: string; hash?: string },
  ) => void;
  openOrReuseTab: (
    workspaceID: string | null,
    href: string,
    source?: TabOpenSource,
  ) => WorkbenchTab;
  forkTab: (workspaceID: string | null, href: string, source?: TabOpenSource) => WorkbenchTab;
  activateTab: (workspaceID: string | null, tabID: string) => void;
  closeTab: (workspaceID: string | null, tabID: string) => void;
  closeLeft: (workspaceID: string | null, tabID: string) => void;
  closeRight: (workspaceID: string | null, tabID: string) => void;
  duplicateTab: (workspaceID: string | null, tabID: string) => WorkbenchTab | null;
  renameTab: (workspaceID: string | null, tabID: string, title: string) => void;
  pinTab: (workspaceID: string | null, tabID: string) => void;
  unpinTab: (workspaceID: string | null, tabID: string) => void;
  reorderTabs: (workspaceID: string | null, activeID: string, overID: string) => void;
  reopenLastClosed: (workspaceID: string | null) => WorkbenchTab | null;
  setActiveTabTitle: (
    workspaceID: string | null,
    title: string,
    iconId?: string,
    forRouteId?: string,
    expectedHref?: string,
  ) => void;
  setCommandOpen: (open: boolean) => void;
  setLeftRailCollapsed: (collapsed: boolean) => void;
  recordRecentTicket: (workspaceID: string | null, ticketID: string) => void;
}

const MAX_UNPINNED_TABS = 20;
const STORAGE_PREFIX = 'opendesk.workbench.v1';

/**
 * The canonical inbox tab — the always-pinned home surface that ships with
 * every workspace and can't be closed. Forked inbox-view tabs share the
 * same `routeId` ('inbox') but have a `tabKey` of `inbox:fork:<id>`, so
 * `routeId` alone is the wrong discriminator: every check that means
 * "the inbox shell tab" must read `tabKey === 'inbox'`.
 *
 * Without this guard, forks inherited the canonical's "uncloseable" and
 * "scrubbed-on-any-close" behaviours and effectively could not be removed.
 */
export function isCanonicalInbox(tab: { routeId: string; tabKey: string }): boolean {
  return tab.routeId === 'inbox' && tab.tabKey === 'inbox';
}

const workbenchTabSchema = z.object({
  id: z.string(),
  routeId: z.string(),
  tabKey: z.string(),
  href: z.string(),
  title: z.string(),
  customTitle: z.string().optional(),
  iconId: z.string(),
  pinned: z.boolean(),
  workspaceID: z.string(),
  lastActiveAt: z.number(),
});

const persistedSchema = z.object({
  tabsByWorkspace: z.record(z.string(), z.array(workbenchTabSchema)).default({}),
  activeTabIdByWorkspace: z.record(z.string(), z.string()).default({}),
  recentClosedTabsByWorkspace: z.record(z.string(), z.array(workbenchTabSchema)).default({}),
  recentTicketsByWorkspace: z.record(z.string(), z.array(z.string())).default({}),
  leftRailCollapsed: z.boolean().default(false),
});

const emptyPersistedState: WorkbenchPersistedState = {
  tabsByWorkspace: {},
  activeTabIdByWorkspace: {},
  recentClosedTabsByWorkspace: {},
  recentTicketsByWorkspace: {},
  leftRailCollapsed: false,
};

export const useWorkbenchStore = create<WorkbenchStore>((set, get) => ({
  ...emptyPersistedState,
  userID: null,
  workspaceID: null,
  commandOpen: false,
  hydrated: false,

  initialize: (userID, workspaceID) => {
    const loaded = loadPersisted(userID);
    const key = workspaceKey(workspaceID);
    const withInbox = ensureWorkspaceState(loaded, key);
    set({ ...withInbox, userID, workspaceID, hydrated: true });
    persistCurrent();
  },

  resetWorkbench: () => {
    const userID = get().userID;
    if (userID && typeof window !== 'undefined') {
      window.localStorage.removeItem(storageKey(userID));
    }
    set({
      ...emptyPersistedState,
      userID: null,
      workspaceID: null,
      commandOpen: false,
      hydrated: false,
    });
  },

  syncLocation: (workspaceID, location) => {
    const key = workspaceKey(workspaceID);
    const match = resolveWorkbenchLocation(location);
    set((state) => {
      const current = ensureWorkspaceState(state, key);
      const tabs = current.tabsByWorkspace[key] ?? [];
      const activeID = current.activeTabIdByWorkspace[key];
      const active = tabs.find((tab) => tab.id === activeID) ?? tabs[0];
      const activeMatchesLocation =
        active?.routeId === match.route.id && active.href === match.href;
      // A forked tab shares its routeId with non-fork tabs of the same kind
      // (e.g. `inbox` + `inbox:fork:<id>`). When the active tab is a fork
      // and the user navigates within it (left-click on a different view
      // pill, ?view=… changes), the fork should stay active and refresh —
      // not get hijacked by the original tab via the `existing` lookup.
      const isForked = active?.tabKey?.includes(':fork:') ?? false;
      const activeCanHostMatch =
        active?.routeId === match.route.id && (active.tabKey === match.tabKey || isForked);
      const existing = tabs.find((tab) => tab.tabKey === match.tabKey);
      let nextTabs = tabs;
      let nextActive = activeID;

      // Always refresh iconId from the matched route, not just title/href.
      // Heals any past corruption (e.g. a stale-effect race that stamped a
      // tab with the wrong iconId) on the very next navigation.
      if (activeMatchesLocation && active) {
        nextTabs = tabs.map((tab) =>
          tab.id === active.id
            ? {
                ...tab,
                href: match.href,
                title: tab.customTitle ? tab.title : match.title,
                iconId: match.route.iconId,
                lastActiveAt: Date.now(),
              }
            : tab,
        );
        nextActive = active.id;
      } else if (activeCanHostMatch && active) {
        // Same routeId and the active tab is either the canonical tab for
        // this tabKey *or* a fork. Keep it active, refresh href/title.
        nextTabs = tabs.map((tab) =>
          tab.id === active.id
            ? {
                ...tab,
                href: match.href,
                title: tab.customTitle ? tab.title : match.title,
                iconId: match.route.iconId,
                lastActiveAt: Date.now(),
              }
            : tab,
        );
        nextActive = active.id;
      } else if (existing) {
        nextTabs = tabs.map((tab) =>
          tab.id === existing.id
            ? {
                ...tab,
                href: match.href,
                title: tab.customTitle ? tab.title : match.title,
                iconId: match.route.iconId,
                lastActiveAt: Date.now(),
              }
            : tab,
        );
        nextActive = existing.id;
      } else if (active && active.tabKey === 'inbox' && match.tabKey === 'inbox') {
        nextTabs = tabs.map((tab) =>
          tab.id === active.id
            ? {
                ...tab,
                href: match.href,
                title: match.title,
                iconId: match.route.iconId,
                lastActiveAt: Date.now(),
              }
            : tab,
        );
        nextActive = active.id;
      } else {
        const tab = tabFromMatch(key, match);
        nextTabs = [...tabs.map((t) => ({ ...t })), tab];
        nextActive = tab.id;
      }

      const capped = capTabs(sortTabs(nextTabs));
      return {
        ...current,
        tabsByWorkspace: { ...current.tabsByWorkspace, [key]: capped },
        activeTabIdByWorkspace: { ...current.activeTabIdByWorkspace, [key]: nextActive },
      };
    });
    persistCurrent();
  },

  openOrReuseTab: (workspaceID, href) => {
    const key = workspaceKey(workspaceID);
    const match = resolveWorkbenchHref(href);
    let opened: WorkbenchTab | null = null;
    set((state) => {
      const current = ensureWorkspaceState(state, key);
      const tabs = current.tabsByWorkspace[key] ?? [];
      const existing = tabs.find((tab) => tab.tabKey === match.tabKey);
      if (existing) {
        opened = {
          ...existing,
          href: match.href,
          title: existing.customTitle ? existing.title : match.title,
          lastActiveAt: Date.now(),
        };
        return {
          ...current,
          tabsByWorkspace: {
            ...current.tabsByWorkspace,
            [key]: sortTabs(
              tabs.map((tab) => (tab.id === existing.id ? (opened as WorkbenchTab) : tab)),
            ),
          },
          activeTabIdByWorkspace: { ...current.activeTabIdByWorkspace, [key]: existing.id },
        };
      }
      opened = tabFromMatch(key, match);
      return {
        ...current,
        tabsByWorkspace: {
          ...current.tabsByWorkspace,
          [key]: capTabs(sortTabs([...tabs, opened])),
        },
        activeTabIdByWorkspace: { ...current.activeTabIdByWorkspace, [key]: opened.id },
      };
    });
    persistCurrent();
    if (!opened) throw new Error('Failed to open workbench tab.');
    return opened;
  },

  forkTab: (workspaceID, href) => {
    const key = workspaceKey(workspaceID);
    const match = resolveWorkbenchHref(href);
    let opened = tabFromMatch(key, match, true);
    set((state) => {
      const current = ensureWorkspaceState(state, key);
      const tabs = current.tabsByWorkspace[key] ?? [];
      opened = { ...opened, tabKey: `${match.tabKey}:fork:${opened.id}` };
      return {
        ...current,
        tabsByWorkspace: {
          ...current.tabsByWorkspace,
          [key]: capTabs(sortTabs([...tabs, opened])),
        },
        activeTabIdByWorkspace: { ...current.activeTabIdByWorkspace, [key]: opened.id },
      };
    });
    persistCurrent();
    return opened;
  },

  activateTab: (workspaceID, tabID) => {
    const key = workspaceKey(workspaceID);
    set((state) => ({ activeTabIdByWorkspace: { ...state.activeTabIdByWorkspace, [key]: tabID } }));
    persistCurrent();
  },

  closeTab: (workspaceID, tabID) =>
    closeTabs(workspaceID, (tabs) => tabs.filter((tab) => tab.id !== tabID), tabID),
  closeLeft: (workspaceID, tabID) =>
    closeTabs(
      workspaceID,
      (tabs) => {
        const idx = tabs.findIndex((tab) => tab.id === tabID);
        return idx < 0 ? tabs : tabs.slice(idx);
      },
      tabID,
    ),
  closeRight: (workspaceID, tabID) =>
    closeTabs(
      workspaceID,
      (tabs) => {
        const idx = tabs.findIndex((tab) => tab.id === tabID);
        return idx < 0 ? tabs : tabs.slice(0, idx + 1);
      },
      tabID,
    ),

  duplicateTab: (workspaceID, tabID) => {
    const key = workspaceKey(workspaceID);
    let duplicated: WorkbenchTab | null = null;
    set((state) => {
      const tabs = state.tabsByWorkspace[key] ?? [];
      const idx = tabs.findIndex((tab) => tab.id === tabID);
      if (idx < 0) return state;
      const source = tabs[idx] as WorkbenchTab;
      const clone: WorkbenchTab = {
        ...source,
        id: crypto.randomUUID(),
        tabKey: `${source.tabKey}:copy:${crypto.randomUUID()}`,
        customTitle: source.customTitle,
        pinned: false,
        lastActiveAt: Date.now(),
      };
      duplicated = clone;
      const nextTabs = [...tabs.slice(0, idx + 1), clone, ...tabs.slice(idx + 1)];
      return {
        tabsByWorkspace: { ...state.tabsByWorkspace, [key]: capTabs(sortTabs(nextTabs)) },
        activeTabIdByWorkspace: { ...state.activeTabIdByWorkspace, [key]: clone.id },
      };
    });
    persistCurrent();
    return duplicated;
  },

  renameTab: (workspaceID, tabID, title) => {
    const key = workspaceKey(workspaceID);
    set((state) => ({
      tabsByWorkspace: {
        ...state.tabsByWorkspace,
        [key]: (state.tabsByWorkspace[key] ?? []).map((tab) =>
          tab.id === tabID ? { ...tab, customTitle: title.trim() || undefined } : tab,
        ),
      },
    }));
    persistCurrent();
  },

  pinTab: (workspaceID, tabID) => setPinned(workspaceID, tabID, true),
  unpinTab: (workspaceID, tabID) => setPinned(workspaceID, tabID, false),

  reorderTabs: (workspaceID, activeID, overID) => {
    const key = workspaceKey(workspaceID);
    set((state) => {
      const tabs = state.tabsByWorkspace[key] ?? [];
      const activeIndex = tabs.findIndex((tab) => tab.id === activeID);
      const overIndex = tabs.findIndex((tab) => tab.id === overID);
      if (activeIndex < 0 || overIndex < 0 || activeIndex === overIndex) return state;
      const active = tabs[activeIndex];
      const over = tabs[overIndex];
      if (!active || !over || active.pinned !== over.pinned) return state;
      const next = [...tabs];
      next.splice(activeIndex, 1);
      next.splice(overIndex, 0, active);
      return { tabsByWorkspace: { ...state.tabsByWorkspace, [key]: sortTabs(next) } };
    });
    persistCurrent();
  },

  reopenLastClosed: (workspaceID) => {
    const key = workspaceKey(workspaceID);
    let reopened: WorkbenchTab | null = null;
    set((state) => {
      const closed = state.recentClosedTabsByWorkspace[key] ?? [];
      const [tab, ...rest] = closed;
      if (!tab) return state;
      reopened = tab;
      return {
        tabsByWorkspace: {
          ...state.tabsByWorkspace,
          [key]: capTabs(sortTabs([...(state.tabsByWorkspace[key] ?? []), tab])),
        },
        activeTabIdByWorkspace: { ...state.activeTabIdByWorkspace, [key]: tab.id },
        recentClosedTabsByWorkspace: { ...state.recentClosedTabsByWorkspace, [key]: rest },
      };
    });
    persistCurrent();
    return reopened;
  },

  // `forRouteId` + `expectedHref` together guard against a stale-effect
  // race: a route component's useEffect can fire AFTER the user has
  // navigated away (because Zero re-emits a query result with a new array
  // reference). Without the guard, the call would relabel whatever tab is
  // *now* active — corrupting an unrelated tab. `forRouteId` catches
  // route-type changes (ticket→customer). `expectedHref` catches
  // ticket-to-ticket and customer-to-customer races where the route type
  // hasn't changed but the entity has; pass the *current* href the caller
  // believes it owns and the update is a no-op if the active tab has moved
  // to a different href under the same route type.
  setActiveTabTitle: (workspaceID, title, iconId, forRouteId, expectedHref) => {
    const key = workspaceKey(workspaceID);
    set((state) => {
      const activeID = state.activeTabIdByWorkspace[key];
      if (!activeID) return state;
      const tabs = state.tabsByWorkspace[key] ?? [];
      const active = tabs.find((tab) => tab.id === activeID);
      if (!active) return state;
      if (active.routeId === 'inbox') return state;
      if (forRouteId && active.routeId !== forRouteId) return state;
      if (expectedHref && active.href !== expectedHref) return state;
      return {
        tabsByWorkspace: {
          ...state.tabsByWorkspace,
          [key]: tabs.map((tab) =>
            tab.id === activeID ? { ...tab, title, iconId: iconId ?? tab.iconId } : tab,
          ),
        },
      };
    });
    persistCurrent();
  },

  setCommandOpen: (open) => set({ commandOpen: open }),
  setLeftRailCollapsed: (collapsed) => {
    set({ leftRailCollapsed: collapsed });
    persistCurrent();
  },
  recordRecentTicket: (workspaceID, ticketID) => {
    const key = workspaceKey(workspaceID);
    set((state) => {
      const current = state.recentTicketsByWorkspace[key] ?? [];
      return {
        recentTicketsByWorkspace: {
          ...state.recentTicketsByWorkspace,
          [key]: [ticketID, ...current.filter((id) => id !== ticketID)].slice(0, 10),
        },
      };
    });
    persistCurrent();
  },
}));

export function selectWorkspaceTabs(workspaceID: string | null): WorkbenchTab[] {
  return useWorkbenchStore.getState().tabsByWorkspace[workspaceKey(workspaceID)] ?? [];
}

export function selectActiveWorkspaceTab(workspaceID: string | null): WorkbenchTab | null {
  const key = workspaceKey(workspaceID);
  const state = useWorkbenchStore.getState();
  const tabs = state.tabsByWorkspace[key] ?? [];
  const activeID = state.activeTabIdByWorkspace[key];
  return tabs.find((tab) => tab.id === activeID) ?? tabs[0] ?? null;
}

export function workspaceKey(workspaceID: string | null | undefined): string {
  return workspaceID ?? 'no-workspace';
}

function tabFromMatch(
  workspaceID: string,
  match: ReturnType<typeof resolveWorkbenchHref>,
  forceUnpinned = false,
): WorkbenchTab {
  return {
    id: crypto.randomUUID(),
    routeId: match.route.id,
    tabKey: match.tabKey,
    href: match.href,
    title: match.title,
    iconId: match.route.iconId,
    pinned: forceUnpinned ? false : !!match.route.pinnedByDefault,
    workspaceID,
    lastActiveAt: Date.now(),
  };
}

function ensureWorkspaceState<T extends WorkbenchPersistedState>(state: T, key: string): T {
  const tabs = state.tabsByWorkspace[key];
  if (tabs && tabs.length > 0) return state;
  const inbox = tabFromMatch(key, resolveWorkbenchHref('/app/inbox'));
  return {
    ...state,
    tabsByWorkspace: { ...state.tabsByWorkspace, [key]: [inbox] },
    activeTabIdByWorkspace: { ...state.activeTabIdByWorkspace, [key]: inbox.id },
  };
}

function sortTabs(tabs: WorkbenchTab[]): WorkbenchTab[] {
  return [...tabs.filter((tab) => tab.pinned), ...tabs.filter((tab) => !tab.pinned)];
}

function capTabs(tabs: WorkbenchTab[]): WorkbenchTab[] {
  const pinned = tabs.filter((tab) => tab.pinned);
  const unpinned = tabs.filter((tab) => !tab.pinned);
  if (unpinned.length <= MAX_UNPINNED_TABS) return [...pinned, ...unpinned];
  const keep = [...unpinned]
    .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
    .slice(0, MAX_UNPINNED_TABS);
  const keepIDs = new Set(keep.map((tab) => tab.id));
  return [...pinned, ...unpinned.filter((tab) => keepIDs.has(tab.id))];
}

function setPinned(workspaceID: string | null, tabID: string, pinned: boolean) {
  const key = workspaceKey(workspaceID);
  useWorkbenchStore.setState((state) => ({
    tabsByWorkspace: {
      ...state.tabsByWorkspace,
      [key]: sortTabs(
        (state.tabsByWorkspace[key] ?? []).map((tab) =>
          tab.id === tabID ? { ...tab, pinned: isCanonicalInbox(tab) ? true : pinned } : tab,
        ),
      ),
    },
  }));
  persistCurrent();
}

function closeTabs(
  workspaceID: string | null,
  getNextTabs: (tabs: WorkbenchTab[]) => WorkbenchTab[],
  closedTabID: string,
) {
  const key = workspaceKey(workspaceID);
  useWorkbenchStore.setState((state) => {
    const tabs = state.tabsByWorkspace[key] ?? [];
    const closed = tabs.find((tab) => tab.id === closedTabID);
    // Only scrub a stray *canonical* inbox that somehow ended up unpinned —
    // never the user's forked inbox views. The previous version filtered
    // every unpinned inbox tab and silently deleted forks whenever any
    // other tab was closed (e.g. close Settings → fork disappears).
    const nextTabs = sortTabs(
      getNextTabs(tabs).filter((tab) => !isCanonicalInbox(tab) || tab.pinned),
    );
    const safeTabs = ensureInboxTab(nextTabs, key, tabs);
    const currentActive = state.activeTabIdByWorkspace[key];
    const nextActive = safeTabs.some((tab) => tab.id === currentActive)
      ? currentActive
      : (safeTabs[Math.max(0, tabs.findIndex((tab) => tab.id === closedTabID) - 1)]?.id ??
        safeTabs[0]?.id);
    return {
      tabsByWorkspace: { ...state.tabsByWorkspace, [key]: safeTabs },
      activeTabIdByWorkspace: {
        ...state.activeTabIdByWorkspace,
        [key]: nextActive ?? safeTabs[0]?.id ?? '',
      },
      recentClosedTabsByWorkspace:
        // Forked inbox views can be closed (and therefore reopened); only
        // the canonical inbox is sealed off from the recent-closed list.
        !closed || isCanonicalInbox(closed)
          ? state.recentClosedTabsByWorkspace
          : {
              ...state.recentClosedTabsByWorkspace,
              [key]: [closed, ...(state.recentClosedTabsByWorkspace[key] ?? [])].slice(0, 10),
            },
    };
  });
  persistCurrent();
}

function ensureInboxTab(tabs: WorkbenchTab[], key: string, previousTabs: WorkbenchTab[]) {
  // Re-add the canonical inbox specifically — checking just `routeId` would
  // treat a surviving fork as "inbox is present" and leave the workspace
  // without its home surface.
  if (tabs.some(isCanonicalInbox)) return tabs;
  const previousInbox = previousTabs.find(isCanonicalInbox);
  const inbox = previousInbox ?? tabFromMatch(key, resolveWorkbenchHref('/app/inbox'));
  return sortTabs([{ ...inbox, pinned: true }, ...tabs]);
}

function storageKey(userID: string): string {
  return `${STORAGE_PREFIX}:${userID}`;
}

function loadPersisted(userID: string): WorkbenchPersistedState {
  if (typeof window === 'undefined') return emptyPersistedState;
  try {
    const raw = window.localStorage.getItem(storageKey(userID));
    if (!raw) return emptyPersistedState;
    return persistedSchema.parse(JSON.parse(raw));
  } catch {
    return emptyPersistedState;
  }
}

function persistCurrent() {
  const state = useWorkbenchStore.getState();
  if (!state.userID || typeof window === 'undefined') return;
  const persisted: WorkbenchPersistedState = {
    tabsByWorkspace: state.tabsByWorkspace,
    activeTabIdByWorkspace: state.activeTabIdByWorkspace,
    recentClosedTabsByWorkspace: state.recentClosedTabsByWorkspace,
    recentTicketsByWorkspace: state.recentTicketsByWorkspace,
    leftRailCollapsed: state.leftRailCollapsed,
  };
  window.localStorage.setItem(storageKey(state.userID), JSON.stringify(persisted));
}
