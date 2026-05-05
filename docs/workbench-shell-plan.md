# Workbench Shell Plan

Status: **draft v2 — pending sign-off on §11 open questions**
Date: 2026-05-01 (initial), 2026-05-01 (v2 revision)

This document is the consolidated plan for moving salve from a conventional page app into a PostHog-style support workbench. It supersedes v1 with sharper decisions, PostHog-source-code grounding, and a re-ordered delivery plan that keeps `main` shippable through every phase.

---

## 0. Summary in one paragraph

A **three-area CSS grid** (left rail | top tab strip | main outlet) replaces the current `<AppHeader />` and per-leaf-route layouts inside `routes/app.tsx`. **Tabs are URL-as-state** (mirrors PostHog's `SceneTab`), persisted per `userID` in localStorage with workspaceID inside each record, and **Inbox is pinned by default**. Default click reuses the active tab; **Cmd-click forks a tab** — this is the only path that creates a second ticket open beside the inbox. **Settings is one tab** with internal navigation (horizontal section strip), not a sub-route layout. **Cmd-K** opens a single-mode palette (recents · tickets · apps · settings · actions). The inbox-list lives **inside** the Inbox tab — not as a global shell pane — so j/k context, composer focus, and screen real estate stay clean.

This sits on top of foundations already shipped:

- TTL'd Zero queries + workspace preload (`apps/web/src/lib/zero-cache.ts`, `zero-preload.ts`)
- Cached session via `lib/session-loader.ts` (no auth re-fetch on internal nav)
- `<AppHeader />` already lifted to `routes/app.tsx` so it doesn't remount per sub-route
- `BrandSplash` covering the cold-load auth window only
- `useShortcut` hook centralising the keyboard contract
- `guidelines/frontend.md` codifying the patterns

The workbench shell does not break any of those guarantees. Every phase below has a regression check for them.

---

## 1. Goals (priority-ordered, non-negotiable)

1. **An agent can have N tickets open at once** and pivot between them in <16ms.
2. **The chrome never flickers** on navigation. We just got there last commit; the workbench has to preserve it.
3. **The URL is canonical.** Direct paste, browser back/forward, copy-link-and-share all work without tab plumbing being involved.
4. **Auth gate is intact.** `routes/app.tsx`'s `beforeLoad` + `<ZeroProvider>` lifecycle does not move; the shell mounts inside that boundary.
5. **No tab explosion.** Default click reuses the active tab. Power users opt into multi-tab via Cmd-click or a context menu. Help-desk agents triage 200+ tickets/day; default-new-tab would be a paper-cut from the first hour.
6. **The "feel" is Linear/PostHog-tier.** Sub-100ms interactions on warm paths, no spinners, keyboard-complete.

## 2. User decisions already locked

- **Tab persistence:** per-device storage for v1 (localStorage, scoped by user).
- **Tab scope:** all `/app/*` routes are tab-addressable.
- **Shell direction:** PostHog-like shell, not a small header tweak.
- **Opening behaviour:** balanced model.
  - Sidebar, command search, and ticket list open or reuse tabs.
  - Local sub-navigation updates the active tab.
  - Direct URL reload creates or focuses the matching tab.
- **Search scope:** routes, open tabs, app/settings/setup routes, and recent tickets for v1. Full backend entity search comes later.

## 3. Mental model (decided)

There are exactly three kinds of tab content:

| Kind | Examples | Singleton? | Pinned by default | Closable |
|---|---|---|---|---|
| **App** | Inbox, Customers (later) | yes (one Inbox tab) | Inbox: yes; others: no | Inbox: no; others: yes |
| **Record** | Ticket, future Customer profile | no — one tab per id | no | yes |
| **Utility** | Settings, Workspace setup, New workspace | yes per utility | no | yes |

**A tab is a URL plus display chrome (title, icon, pinned).** Component state is *not* a property of the tab. This is the constraint that buys us simpler reasoning and PostHog-grade reliability — anything that genuinely needs to survive a tab switch (composer drafts) is persisted in its own keyed store.

## 4. PostHog research findings

Inspected at `/tmp/posthog/frontend/src/` (commit `1c45131b8c6ac13cbba0ca5ae091c8620f0a0d39`).

### 4.1 Patterns to copy verbatim

The original v1 of this doc captured a subset; the deeper read added several non-obvious behaviours.

**Three-area CSS grid** (`Navigation.scss:708-732`):

```scss
.app-layout {
  display: grid;
  grid-template:
    'left top'     var(--scene-layout-header-height)
    'left content' 1fr
    / var(--left-nav-width) minmax(0, 1fr);
  height: 100vh;
}
.app-layout--mobile {
  grid-template: 'top' var(--scene-layout-header-height) 'content' 1fr / minmax(0, 1fr);
}
```

The left rail spans the full height; the tab strip sits over `<main>` only — like browser tabs above a document, not a global header.

**`SceneTab` shape** (`sceneTypes.ts:230-246`):

```ts
export interface SceneTab {
  id: string;
  pathname: string;
  search: string;
  hash: string;
  title: string;
  active: boolean;
  customTitle?: string;
  iconType: FileSystemIconType | 'loading' | 'blank';
  pinned?: boolean;
  badge?: boolean;
  sceneId?: string;
  sceneKey?: string;
  sceneParams?: SceneParams;
}
```

A tab is a serialised URL plus display chrome. `sceneParams` is added at runtime and stripped before persistence (`tabToPersistableSnapshot` at `sceneLogic.tsx:82-89`) because it can be cyclic.

**`partitionTabs` + `sortTabsPinnedFirst`** (`sceneLogic.tsx:216-219`) — pinned tabs always sorted before unpinned. Called at the end of every reducer. Visual divider rendered inline when `isLastPinned` is true (`SceneTabs.tsx:93-111`):

```tsx
const isLastPinned = tab.pinned && (index === tabs.length - 1 || !tabs[index + 1]?.pinned);
{isLastPinned && <div className="h-4 w-px bg-border-secondary shrink-0 ..." />}
```

Pinned tabs are CSS-narrowed via `.scene-tab--pinned { max-width: 36px }` and titles hidden — they look like icons.

**dnd-kit reorder with cross-section guard** (`SceneTabs.tsx:39-62`). 5px activation distance so click ≠ drag. Handler refuses to drop a pinned tab into the unpinned section: `!!activeTab.pinned !== !!overTab.pinned` aborts.

**`closeToLeft` / `closeToRight`** are one-liners (`SceneTabContextMenu.tsx:47-61`):

```tsx
const closeToLeft = () => setTabs(tabs.slice(idx));
const closeToRight = () => setTabs(tabs.slice(0, idx + 1));
```

Just `setTabs(slice)`. No per-tab cleanup; subscriptions in `sceneLogic.tsx:1574-1599` notice ids that disappeared and unmount their cached state.

**`freezeTabWidths` on close-button mousedown** (`sceneLogic.tsx:893-906`). On mousedown, every tab's width is measured and frozen via reducer; `SortableSceneTab` reads frozen widths so adjacent tabs don't snap-grow before close completes. Cleared on `onMouseLeave` of the row. **The single nicest detail in PostHog's tab strip.**

**Tab click flow** (`SceneTabs.tsx:267-275`):

```tsx
onClick={(e) => {
  e.stopPropagation(); e.preventDefault();
  if (!isDragging) {
    clickOnTab(tab);
    router.actions.push(`${tab.pathname}${tab.search}${tab.hash}`);
  }
}}
```

`clickOnTab` marks active and `router.push` re-runs the same pipeline as fresh navigation. Middle-click closes; double-click triggers inline rename.

**Mobile: 992px breakpoint** (`navigationLogic.ts:16`). Below it, grid collapses to single column, left rail becomes off-canvas overlay (`translateX(-100%)` → `0` with backdrop), hamburger inline with the tab strip:

```tsx
{mobileLayout && (
  <ButtonPrimitive onClick={() => showLayoutNavBar(!isLayoutNavbarVisibleForMobile)} iconOnly>
    {isLayoutNavbarVisibleForMobile ? <IconX /> : <IconMenu />}
  </ButtonPrimitive>
)}
```

### 4.2 Subtle behaviours easy to miss

**Tabs are URL+title, not full state.** Anything in `useState` is gone after a tab switch. The `key={`scene-${id}-${tabId}`}` (`App.tsx:128-132`) **forces full unmount on every tab change**:

```tsx
sceneElement = (
  <SceneAnimationRoot key={`scene-${activeSceneId}-${activeSceneLogicPropsWithTabId.tabId}`}>
    <SceneComponent user={user} {...params} />
  </SceneAnimationRoot>
);
```

By design, not by accident. State that must survive must live in URL, in shared stores, or in per-id stores.

**Pinned tabs are read-only navigation targets.** Navigating from a pinned tab forks a new unpinned tab. `ensureNavigationTabId` (`sceneLogic.tsx:1384-1410`):

```ts
if (values.tabs.length === 0) return createNavigationTab();
if (activeTab?.pinned && !cache.initialNavigationTabCreated) return createNavigationTab();
if (!activeTab?.id) return createNavigationTab();
return activeTab.id;
```

A "pinned tab" is a saved view; you click it to activate; clicking inside it that changes the URL spawns a new tab.

**There is NO canonicalisation function in PostHog.** No `tabKey`, no "collapse `/insights/abc` and `/insights/abc/edit` into one tab". The model is "every navigation reuses the active tab unless the active tab is pinned, in which case fork". To force a new tab you call `newInternalTab(path)` (`/tmp/posthog/frontend/src/lib/utils/newInternalTab.tsx:5-10`):

```ts
export function newInternalTab(path?: string, source = 'internal_link'): void {
  getContext().store.dispatch({ type: NEW_INTERNAL_TAB, payload: { path, source } });
}
```

**For salve we DO want canonicalisation per route** — different from PostHog. Reason: `/app/inbox/t/abc` and `/app/inbox/t/abc?compose=1` should be the same tab. `/app/settings/setup` and `/app/settings/tags` should be the same tab. We codify this as `tabKey(pathname, params)` per route in the registry (§6).

**Trailing slashes are stripped** by `locationChanged` (`sceneLogic.tsx:1092-1094`) via `router.replace`. Tab-URL equality must canonicalise.

**Two storage layers in PostHog.** sessionStorage for the full tab list (per-tab session continuity), localStorage for pinned tabs only + homepage (synced cross-tab via `storage` event), plus a backend sync for pinned tabs (debounced 500ms, `sceneLogic.tsx:1530-1543`). **Salve v1: just localStorage, no cross-tab sync, no backend persistence.** Add later if needed.

**Cmd-K palette is single-mode and reuses the active tab on Enter.** `Command.tsx`'s `handleItemSelect` is literally `closeCommand(); router.actions.push(item.href)`. There is no "open in new tab from palette" — that would require explicit `Cmd+Enter → newInternalTab(href)` which we should add.

**Settings is one Scene** (`Scene.Settings`) with a `:section` URL param (`scenes.ts:883`). Switching settings sections updates the URL but never creates a new tab — same scene re-renders. The section sidebar is component-internal.

**Tab widths get frozen on close-button mousedown** so adjacent tabs don't snap-grow before close finishes. Cleared on `mouseleave` of the row. Steal this directly.

**Tabs context menu is a thin wrapper over the same actions** (`pinTab`, `duplicateTab`, `removeTab`, `startTabEdit`). No special plumbing — context menu and click handlers share the store API.

### 4.3 Patterns NOT to copy

- **Kea entirely.** Replace with Zustand + `subscribeWithSelector` for the workbench store; replace Kea loaders with TanStack Query (or simpler — direct fetches into Zustand) for command palette result groups; replace `kea-router` with TanStack Router. Kea's `urlToAction` becomes TanStack's route `loader` / `beforeLoad`.
- **`paramsToProps` + `BindLogic`.** Use TanStack Router's `useParams()` inside scenes.
- **Per-tab Kea logic mounting** (`cache.mountedTabLogic[tabId]`). With Zero, the shared store is keyed by query already; if a tab opens `/tickets/123`, `useQuery(queries.ticketByID({id:'123'}))` shares cache across tabs naturally.
- **`panelLayoutLogic` flyout system.** Salve doesn't need a project-tree flyout. Icon rail navigates directly.
- **`featureFlagLogic`-gated scenes.** No feature flags yet.
- **`PersistedPinnedState` cross-tab sync via `storage` event** (`sceneLogic.tsx:1664-1668`). Nice-to-have. Skip in v1.
- **Backend persistence** of pinned tabs to `/api/user_home_settings/`. Skip v1.
- **The `Scene` enum.** Replace with TanStack Router route ids (string literals from the file path) + a parallel `workbenchRegistry` map.
- **No-canonicalisation tab model.** We add `tabKey()` per route. PostHog's "every nav reuses active tab" makes sense for sequential exploration; we have parallel work.

---

## 5. The DOM hierarchy

Inside `routes/app.tsx`, after the auth gate and `<ZeroProvider>`:

```
+----------+--------------------------------------+
|  left    |  ─── tab strip ─── (pinned | unp.) + |
|  rail    +--------------------------------------+
|          |                                      |
|  240px   |              <Outlet />              |
|  (col-   |          (active tab content)        |
|  laps-   |                                      |
|  ible)   |                                      |
+----------+--------------------------------------+
```

Concrete shape:

```tsx
<ZeroProvider {...zeroOpts}>
  <TooltipProvider delayDuration={150}>
    <WorkspacePreloader />
    <WorkbenchShell>
      <Outlet />
    </WorkbenchShell>
  </TooltipProvider>
</ZeroProvider>
```

`<WorkbenchShell>` owns left rail, top tab strip, and the main container. The current `<AppHeader />` is **deleted**; everything in it redistributes:

| Current AppHeader piece | New home |
|---|---|
| Logo (link to /app/inbox) | Top of left rail |
| Workspace switcher | Bottom of left rail (above account menu) |
| Theme switcher | Top right of tab strip OR account menu |
| Settings link | Bottom of left rail (icon button) |
| Setup pill ("Continue setup · 4/7") | Inline in left rail's "Setup" item with a count badge |
| Email + Sign out | Bottom-of-rail account menu |

This kills the "header on top of header" anti-pattern that was always going to bite as we added more chrome. Match PostHog: nothing in the top-row's left column.

---

## 6. Data model

### 6.1 `WorkbenchTab`

```ts
interface WorkbenchTab {
  id: string;              // generated; unique per workspace lifetime
  routeId: string;         // matches a registry entry id (see §7)
  tabKey: string;          // logical identity (e.g. 'inbox' or 'ticket:abc')
  href: string;            // pathname + search + hash, source of truth
  title: string;           // displayed; updated as scenes report titles
  customTitle?: string;    // user-renamed
  iconId: string;          // resolved via the registry
  pinned: boolean;
  workspaceID: string;     // tenancy guard
  lastActiveAt: number;
}
```

### 6.2 Tabs store (Zustand, persisted)

```ts
interface WorkbenchState {
  tabsByWorkspace: Record<string, WorkbenchTab[]>;
  activeTabIdByWorkspace: Record<string, string>;
  recentClosedTabsByWorkspace: Record<string, WorkbenchTab[]>; // small graveyard for Cmd+Shift+T
  recentTicketsByWorkspace: Record<string, string[]>;          // for command palette
  leftRailCollapsed: boolean;
  commandOpen: boolean;

  // Actions
  syncLocation(workspaceID: string, location: WorkbenchLocation): void;
  openOrReuseTab(workspaceID: string, href: string, source: TabOpenSource): void;
  forkTab(workspaceID: string, href: string): void; // explicit new tab
  activateTab(workspaceID: string, tabId: string): void;
  closeTab(workspaceID: string, tabId: string): void;
  closeLeft(workspaceID: string, tabId: string): void;
  closeRight(workspaceID: string, tabId: string): void;
  duplicateTab(workspaceID: string, tabId: string): void;
  renameTab(workspaceID: string, tabId: string, title: string): void;
  pinTab(workspaceID: string, tabId: string): void;
  unpinTab(workspaceID: string, tabId: string): void;
  reorderTabs(workspaceID: string, activeId: string, overId: string): void;
  reopenLastClosed(workspaceID: string): void;
  resetForWorkspace(workspaceID: string): void;
}
```

- One Zustand slice. Use `subscribeWithSelector` for per-tab title updates (so renaming doesn't rerender the entire list).
- Persist with `persist` middleware. **Storage key: `salve.workbench.v1:${userID}`.** Workspace ID is *inside* the value, not the key — switching workspace doesn't clear other workspaces' tabs.
- Validate on load with a Zod schema. On parse error, fall back to `[{tabKey: 'inbox', pinned: true, ...}]` for the active workspace.
- **Sign-out clears the slice.** Add `resetWorkbench()` next to `clearSessionCache()` and call it in the `onSignOut` flow.
- Cap at 20 unpinned tabs per workspace (silently drop oldest by `lastActiveAt` when a new tab pushes past the cap).

### 6.3 Composer drafts (separate slice)

```ts
interface DraftSnapshot {
  body: string;
  bodyHtml: string;
  selectedAddressId?: string;
  isInternal?: boolean;
  updatedAt: number;
}

interface ComposerDraftsState {
  drafts: Record<string, DraftSnapshot>; // key: `${workspaceID}:${ticketID}`
  setDraft(key: string, snapshot: Partial<DraftSnapshot>): void;
  clearDraft(key: string): void;
}
```

- Persisted under `salve.composer-drafts.v1:${userID}`.
- Composer subscribes; on mount, reads draft if present; on every keystroke (debounced 300ms), persists; on send-success, clears.
- Drafts survive reload — a bonus over PostHog's session-only model.

### 6.4 What is NOT persisted

- Scroll position. Skip in v1; can copy PostHog's 4-`setTimeout` retry trick (`sceneLogic.tsx:1116-1125`) later.
- Search-input transient values, dialog state, filter chips. Component state.
- Open/closed toggle of any expandable section in a route.

---

## 7. Route registry

Lives at `apps/web/src/lib/workbench/routes.ts`. Bridges TanStack Router and the workbench:

```ts
export type WorkbenchRouteKind = 'app' | 'record' | 'utility';

export interface WorkbenchRouteDef {
  id: string;
  kind: WorkbenchRouteKind;
  match: (pathname: string) => boolean;
  /** Logical key for tab dedupe. Two URLs returning the same key share one tab. */
  tabKey: (pathname: string, params: Record<string, string>) => string;
  defaultHref: () => string;        // where the rail entry navigates
  title: (pathname: string, params: Record<string, string>) => string;
  iconId: string;
  pinnedByDefault?: boolean;
  closable?: boolean;
  searchable?: boolean;             // in palette "Apps" group
  /** Search params to strip when computing href / tabKey (e.g. transient ?action=add). */
  transientSearchParams?: readonly string[];
}
```

**Initial registry:**

| id | kind | tabKey for | pinned | closable | rail visibility |
|---|---|---|---|---|---|
| `inbox` | app | `inbox` for any `/app/inbox*` not under `/t/` | yes | no | top of "Apps" |
| `ticket` | record | `ticket:{ticketId}` | no | yes | hidden (opens via inbox click or palette) |
| `settings` | utility | `settings` for any `/app/settings*` | no | yes | bottom-rail icon |
| `workspace-setup` | utility | the same — `/app/settings/setup` collapses into `settings` | — | — | also reachable from Settings landing |
| `workspaces-new` | utility | `workspaces-new` | no | yes | hidden |

**Key rule: Settings has ONE tabKey for all sub-routes.** `/app/settings/setup`, `/app/settings/channels/email`, `/app/settings/tags`, `/app/settings/custom-fields` all return `tabKey === 'settings'`. They share one tab with internal navigation. This delivers on "settings should move away from where it is currently" — settings is no longer a sub-route layout with a sidebar; it's a tab whose internal navigation happens to be a horizontal section strip.

Legacy email-domain routes (`/app/settings/email/domains*`) canonicalise to the modern paths via the existing redirect path; the tabKey logic produces `'settings'` regardless.

**Transient search params** like `?action=add` (currently used by the setup checklist deep-links) must be stripped from `tabKey` so they don't fragment tabs. The registry entry for `settings` lists them; canonicalisation happens once in `tabKey()`.

---

## 8. The decisions (sign-off needed on §11)

### D1 — How tickets relate to tabs **(the biggest decision)**

**Recommendation:** Inbox-tab-with-detail-pane is the default. Cmd-click forks a ticket tab.

- The Inbox tab is two-pane: list left (`<InboxList>` with virtualisation, j/k, etc.), detail right. `/app/inbox/t/abc` keeps the list visible and renders the ticket on the right. Same as today, just inside the workbench shell.
- **Cmd-click on a ticket row, or the row's "Open in new tab" context menu, forks** a ticket tab (`tabKey: 'ticket:abc'`). The forked ticket tab is single-pane (no list), full-width detail.
- Direct URL paste of `/app/inbox/t/abc` reuses the active tab if it's the Inbox tab; otherwise creates a ticket tab. Mirror PostHog's pinned-tab-fork behaviour: pasting into a pinned active tab spawns a new tab.

**Rationale:** help-desk agents triage in two-pane (list + detail) and *occasionally* want a second ticket open beside the work they're triaging — usually for cross-referencing. Front, Help Scout, Intercom all do this. PostHog's "every link reuses active tab" doesn't fit because PostHog's primary use is sequential exploration; salve has parallel-context work.

### D2 — Settings layout

**Recommendation:** One Settings tab with a horizontal section strip at the top (no sidebar inside the tab).

- The tab's outer layout: title + section strip (`Setup` · `Email` · `Tags` · `Custom fields`) + content. Navigating sections updates the URL and the tab's stored href; doesn't create a new tab.
- We already have the email-channel-tabs pattern (`components/email-settings/nav-tabs.tsx`) — promote to a shared `<SectionStrip>` component and reuse here.
- Drop `routes/app/settings.tsx`'s sidebar entirely. The file becomes a layout that renders the strip + `<Outlet />`.

### D3 — Inbox pane visibility

**Recommendation:** The inbox-list is part of the Inbox tab, not a global shell pane.

V1 of this doc proposed making `<InboxList>` a shell pane that's always visible and toggleable. Reverse course:

- The list is only meaningful in the inbox/triage context.
- j/k navigation only fires when the user is in that context.
- Making it global means we keep the query and DOM live everywhere just to hide it in CSS. Wasteful and confusing.
- "Peek inbox while in Settings" is a one-keystroke nav away (Cmd-K → Inbox → Enter, or `g i` Vim-style).

So `routes/app/inbox.tsx` continues to render the two-pane (list + outlet). The change is that the chrome around it is the workbench shell. Ticket tabs that opened via fork render `routes/app/inbox/t/$ticketId` *without* the list pane wrapper — call this "ticket-tab mode". Cleanest implementation: a search param like `?fullDetail=1` set by the fork action, which the inbox layout reads to decide pane visibility. Or a parent layout switch. Pick whichever has the smaller diff during phase 4.

### D4 — Tab switch unmounts

**Recommendation:** Match PostHog. Unmount on tab switch via `key={activeTabId}` on `<main>`. Persist drafts explicitly.

```tsx
<main key={`tab-${activeTabId}`}>
  <Outlet />
</main>
```

The only state that matters today and would be lost: composer drafts. They go in `composer-drafts.ts` (§6.3). Anything else is either in URL params, in Zero (server-truth), in shared stores, or genuinely transient (input typing) — and unmount is fine for those.

### D5 — Cmd-K palette

**Recommendation:** Single-mode. Reuses active tab on Enter; `Cmd+Enter` opens result in new tab.

Matches PostHog (`Command.tsx:handleItemSelect` does `closeCommand(); router.actions.push(item.href)`).

V1 result groups, in order:

1. **Open tabs** (jump back to an already-open tab).
2. **Recent tickets** (last 10 ticket ids the user navigated to). Source: recents store (§6.2).
3. **Apps** (Inbox; Customers later). Source: registry where `searchable && kind === 'app'`.
4. **Settings sections** (`Setup`, `Email`, `Tags`, `Custom fields`). Source: hardcoded list keyed off the settings registry entry.
5. **Actions** (New ticket, Sign out, Switch theme, Open setup checklist, …). Source: hardcoded action list.

Skip in v1: full server-side ticket / customer search. Needs a `/api/search` endpoint. Add in v2.

Library: `cmdk` ([cmdk.paco.me](https://cmdk.paco.me)) wrapped in Radix Dialog. Bind via existing `useShortcut('k', fn, {allowInInputs: true})` plus the `isMod(e)` check — exactly the pattern in `guidelines/frontend.md` §10.

### D6 — Mobile

**Recommendation:** Narrow mode in v1. Don't ship mobile-optimised workbench UX — just don't break it.

Match PostHog's 992px breakpoint. Below it:

- Grid collapses to single column.
- Left rail becomes off-canvas overlay opened by a hamburger inline with the tab strip.
- Tab strip stays, scrolls horizontally.
- Inbox tab on mobile = single-pane (list OR detail, not both); URL drives which.

This is graceful degradation. Most agents will be on desktop.

---

## 9. Phased delivery

Five sequential phases. Each can land on `main` independently and is independently revertible. Earlier doc proposed three parallel workers; recommend sequential for phases 1–3 (foundation), then parallelise phases 4 and 5 if velocity matters.

### Phase 1 — Workbench data layer (no UI change)

Ship:

- `apps/web/src/lib/workbench/routes.ts` — registry with the 5 entries above.
- `apps/web/src/lib/workbench/store.ts` — Zustand slice + persist middleware + Zod schema.
- `apps/web/src/lib/workbench/url.ts` — pathname → `(routeId, tabKey, title)` resolution.
- `apps/web/src/lib/composer-drafts.ts` — drafts slice (used by phase 4).

**Acceptance:** type-check passes. Vitest covers the URL → tabKey function for every registered route, including legacy `/app/settings/email/domains*` redirects collapsing to `'settings'`. No UI changes. No regression in any existing route.

### Phase 2 — Shell skeleton, no behavioural change

Ship:

- `apps/web/src/components/workbench/shell.tsx` — three-area grid.
- `apps/web/src/components/workbench/left-rail.tsx` — Inbox/Settings buttons, account menu, theme switcher, workspace switcher (move from current `AppHeader`).
- `apps/web/src/components/workbench/tab-strip.tsx` — renders tabs from the store; no DnD yet, no context menu.
- Wire into `routes/app.tsx` replacing `<div className="flex h-dvh flex-col"><AppHeader />…</div>`.
- Delete `apps/web/src/components/app-header.tsx` and remove imports.
- `routes/app/inbox.tsx` and `routes/app/settings.tsx` shrink — they no longer own header/dvh chrome.

**Acceptance:**

- Type-check + biome check pass.
- Hard reload of `/app/inbox` and `/app/inbox/t/<id>` — no flicker, no "Loading…" text. Regression test of the BrandSplash + skeleton work.
- Dark mode screenshots match light mode in coverage.
- Cmd-click on a ticket creates a new tab; default click navigates inside the Inbox tab.
- Click "Settings" in left rail → opens or activates the Settings tab.
- `/app/settings/tags` direct URL paste opens (or activates) Settings tab and navigates internally.
- Tab strip survives a reload (persistence works).
- Mobile (<992px) collapses to overlay nav; tab strip horizontally scrolls.

### Phase 3 — Tab interactions polished

Ship:

- DnD reorder via `@dnd-kit/core`, with the cross-section guard.
- Context menu: Pin/Unpin, Duplicate, Rename, Copy URL, Open in new tab, Close, Close left, Close right.
- `freezeTabWidths` on close-button mousedown.
- Middle-click closes.
- Double-click renames inline.
- Keyboard: `Cmd+1..9` jumps to tab N; `Cmd+Shift+W` closes active tab; `Cmd+Shift+T` reopens last closed (graveyard stack).

**Acceptance:** keyboard-only walkthrough completes — open inbox, fork two tickets, switch with `Cmd+1..3`, rename one, close another, undo close. No mouse touched.

### Phase 4 — Composer drafts + ticket-tab mode + Settings strip

Ship:

- Composer reads/writes the drafts store. Loads draft on mount; persists on every keystroke (debounced 300ms); clears on send.
- "Ticket-tab mode" — when active tab `tabKey` starts with `ticket:`, the inbox layout hides the list pane and renders the detail full-width.
- "Open in new tab" context menu on inbox rows (also fired by Cmd-click).
- Settings: extract `<SectionStrip>` from `email-settings/nav-tabs.tsx`. `routes/app/settings.tsx` becomes section strip + `<Outlet />`. Drop the existing sidebar.

**Acceptance:**

- Open ticket, type 100 chars in composer, Cmd-click another ticket → second tab opens, draft #1 persists. Switch back, draft is there. Send. Draft is cleared.
- Reload mid-draft → draft restored.
- Settings tab navigates between Setup/Email/Tags/Custom fields without creating new tabs; URL updates each time.

### Phase 5 — Cmd-K palette

Ship:

- `apps/web/src/components/workbench/command-palette.tsx` using `cmdk` + Radix Dialog.
- Recents store (last 10 ticket ids visited) persisted alongside the workbench store.
- Bound to `Cmd+K` globally via `useShortcut`.
- Result groups: Open tabs · Recent tickets · Apps · Settings sections · Actions.
- Enter reuses active tab. `Cmd+Enter` opens in new tab (forks a ticket tab if applicable).

**Acceptance:** from anywhere, `Cmd+K` + first letter of any registered destination, Enter → there. `Cmd+Enter` → new tab. Empty query shows recents + apps. Esc closes.

---

## 10. Risks (with the chosen mitigation)

| Risk | Mitigation |
|---|---|
| Tab explosion from accidental forks | Default click reuses active tab; only Cmd-click forks. Cap at 20 unpinned tabs per workspace (drop oldest by `lastActiveAt`). |
| State loss on tab switch (unmount) | Composer drafts persisted explicitly. Audit every component for `useState` that should move to URL/store. |
| Persistence corruption | Zod schema validation on load. Fallback to `[Inbox]`. |
| Cross-tenant tab leak | Workspace id inside every tabKey AND inside the tab record. On workspace switch, swap which slice is active without clearing other workspaces' tabs. |
| Pinned tab gets navigated unexpectedly | Match PostHog: navigating from a pinned tab forks a new unpinned tab. |
| Trailing slashes / search params duplicating tabs | Canonicalise in `tabKey()` — strip trailing slash, strip transient params (registered via `transientSearchParams`), keep meaningful path params. |
| `j/k` firing in Settings | Shortcut is registered inside the inbox-list component, scoped via mount. On Settings tab the inbox-list is unmounted — shortcut is gone. Free win. |
| Splash on tab switch | Tab switch is purely client-side; no `beforeLoad` re-fires. Session is cached. Confirmed in phase 2 acceptance. |
| Mobile regression | Phase 2 explicitly tests the 992px overlay path. Don't merge phase 2 without it. |
| BrandSplash + workbench fight on cold load | Shell mounts inside `routes/app.tsx` after `beforeLoad`. Splash hides on first React paint (current behaviour preserved). |
| Three nav layers in Settings (rail + tab strip + sidebar) | Drop the settings sidebar; horizontal section strip only. |

---

## 11. Open questions for sign-off

**Q1 — Default open behaviour for inbox row clicks.**

- (a) Default click navigates inside Inbox tab; Cmd-click forks. *(My recommendation. Support-tool convention.)*
- (b) Default click forks a ticket tab; same-tab mode requires a setting toggle.

I'd ship (a) first and watch usage.

**Q2 — Pinned tabs.**

- Inbox is pinned-by-default and not closable. Agreed.
- Should we let users pin arbitrary other tabs (drag into pinned section)? PostHog does. Adds ~50 LOC. Worth it in v1?

**Q3 — Settings layout: section strip vs. internal sidebar.**

- I recommended the horizontal section strip. Smaller component, matches `email-settings/nav-tabs.tsx` we already have, avoids "sidebar inside a tab inside a left rail" awkwardness.
- Counter-option: keep the existing settings sidebar inside the Settings tab (smaller diff, more familiar to existing users). Your call.

**Q4 — Cmd-K result scope in v1.**

- Recents + Apps + Settings + Actions covers ~80% of value with no new API.
- Server-side ticket/customer search is the other 20% — needs a search endpoint. Skip v1, ship in v2?

**Q5 — Mobile: in-scope or v2?**

- 992px overlay mode is ~half a day. I'd include it because mobile completely breaking is a bad look. Defer if velocity matters more than mobile parity.

**Q6 — Phasing: sequential vs. parallel.**

- Sequential through phases 1–3 (foundation); parallelise 4 + 5 if you have agent labour. Recommend not running phases 1, 2, 3 in parallel — they touch the same files and the merge would be painful.

**Default answers (apply if you don't override): Q1=(a), Q2=yes, Q3=section strip, Q4=skip server search, Q5=in-scope, Q6=sequential 1-2-3, parallel 4+5.**

If those are good, Phase 1 is pure data layer with no visible change, low risk, and unblocks everything else. Tell me which answers to flip and I'll adjust before writing code.

---

## 12. Updates this plan requires in `guidelines/frontend.md`

Three additions, no removals:

1. **§5 (Routing & layouts)** — new subsection: *"Workbench tabs are a UI layer over routing"*. URL is canonical. Each `/app/*` route registers a `WorkbenchRouteDef`. New routes inside `/app` MUST add a registry entry.
2. **§6 (Component architecture)** — *"Sub-route navigation inside a single tab uses a section strip, not nested route layouts."* The Settings strip becomes the canonical pattern.
3. **§14 (Animation & latency)** — *"Tab switch unmounts. State that must survive lives in a keyed store."* With the composer draft example.

Two new anti-patterns for §18:

- **#34** — *Adding a new route under `/app` without registering it in the workbench registry.* The route will work but won't behave correctly with tabs (no icon, no title, no canonicalisation, no palette entry).
- **#35** — *Storing tab-survival-critical state in `useState`.* It evaporates on tab switch. Use a keyed store (composer drafts pattern).

---

## 13. Reference: PostHog source paths

All absolute paths inside `/tmp/posthog/frontend/src/`:

- `layout/scenes/SceneTabs.tsx` — tab strip component
- `layout/scenes/SceneTabContextMenu.tsx` — context menu (close-left/right one-liners)
- `layout/scenes/SceneLayout.tsx` — scene container, info panel portal
- `layout/scenes/sceneLayoutLogic.tsx` — scene layout state
- `layout/scenes/SceneTabs.css` — pinned-tab CSS narrowing
- `layout/panel-layout/PanelLayout.tsx` — left rail flyout (we skip)
- `layout/panel-layout/panelLayoutLogic.tsx` — left rail state
- `layout/panel-layout/PanelLayoutNavBar.tsx` — icon rail
- `layout/panel-layout/NavBarFooter.tsx` — account menu at bottom of rail
- `layout/navigation-3000/Navigation.tsx` — top-level shell composition
- `layout/navigation-3000/Navigation.scss` (lines 700–746 for grid)
- `layout/navigation/navigationLogic.ts` — 992px breakpoint
- `layout/GlobalShortcuts.tsx` — Cmd-K binding
- `scenes/sceneLogic.tsx` — the heart of the tab system (~1700 LOC)
- `scenes/sceneTypes.ts` — `SceneTab`, `SceneConfig` types
- `scenes/scenes.ts` — route → scene map
- `scenes/App.tsx` (lines 80–155) — scene render with `key={tabId}`
- `scenes/settings/SettingsScene.tsx` — single-tab settings
- `lib/components/Command/Command.tsx` — palette dialog
- `lib/components/Command/commandLogic.tsx` — open/close (22 LOC)
- `lib/components/Search/Search.tsx` — search compound (`Search.Root`, `Search.Input`, …)
- `lib/components/Search/searchLogic.tsx` — result group selectors
- `lib/utils/newInternalTab.tsx` — explicit fork helper

External docs:

- cmdk: https://cmdk.paco.me
- @dnd-kit: https://docs.dndkit.com
- TanStack Router: https://tanstack.com/router
- Zustand persist: https://zustand.docs.pmnd.rs/integrations/persisting-store-data

---

## 14. What is intentionally NOT in v1

So we don't scope-creep:

- Backend persistence of tabs / pinned tabs.
- Cross-tab sync via `storage` event.
- Server-side ticket / customer / message search.
- Customer profile route + tab.
- Activity / audit-log tab.
- Reports tab.
- Saved views (pin a filter as a tab).
- Tab groups.
- Split panes (side-by-side ticket comparison).
- "Open in real browser tab" for sharing — Cmd-click on links does this for free.
- A tour / first-run tutorial for the new shell.
- Per-tab scroll position restoration.
- Per-tab expanded-section memory.
- Drag-out to detach a tab into a separate window.

Each of these has a clear path in if we want it later. None of them is required to ship the workbench.
