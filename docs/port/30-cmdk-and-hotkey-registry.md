# Phase 30 — Command Registry, Hotkeys, and Cmd+K

> The design here is the result of a deep audit (2026-05-01) against Linear,
> kbar, cmdk, tinykeys, PostHog's command palette, and Zero's query model.
> Read this document end-to-end before touching the registry, the palette,
> or any hotkey binding. The architecture decisions here cascade across
> Phases 40–95: every later phase ships its actions as command
> registrations rather than bespoke menus.

---

## 1. What "great" looks like

Linear is the bar. Five behaviours we're copying — and the system that makes
them possible:

1. **Cmd+K is contextual.** On the inbox list it offers ticket actions for
   the *hovered* row. On a ticket detail page, for *that* ticket. With a
   bulk selection, for the *selection set*. The chrome doesn't change; the
   target does.
2. **Sub-pages, not nested menus.** "Set priority…" pushes a new page that
   lists Urgent / High / Medium / Low / None. Backspace on empty input
   pops back. Esc closes one level (then the whole thing). Carrying state
   between pages is deliberate and minimal.
3. **One key, three surfaces.** `P` opens the priority picker (a) as a
   sub-page when the palette is open, (b) as a popover when invoked from
   the right-rail property row, (c) as a popover when pressed bare on a
   hovered/URL ticket. **One model, three views, identical filtering.**
4. **Hotkey hints everywhere.** The same `S / P / A / L / I / ⌘. / ⌘⇧.`
   glyphs appear in the palette's right-side, in tooltips on inline
   buttons, and in the `?` cheatsheet — derived from a single registry.
5. **The system stays out of the way.** Single-letter hotkeys never fire
   while the user is typing. Cmd-modifiers always do (so `Cmd+Enter`
   sends from inside the composer). Sub-pages don't subscribe to
   live-queries the user closed in 200 ms.

Non-goals for this phase:

- Voice / AI command interpretation.
- Cross-workspace search (workspace-scoped only).
- Slash commands inside the composer (Phase 60, separate engine).
- Two parallel implementations during migration. We delete the existing
  `CommandPalette` flat-list shape in the same PR that lands the new
  engine.

---

## 2. Three axes you must keep separate

The single most common failure mode in command-palette code is conflating
**scope**, **context**, and **target**. They are different things, with
different lifetimes, owners, and re-render scopes.

### 2.1 Scope — *which bindings are listening right now*

A label set: `{ global, app, inbox, conversation, customer, dialog:cmdk,
modal:confirm }`. Multiple scopes are active simultaneously, in a stack.
Bindings are gated to one or more scopes:

- `global` — always live (Cmd+K, `?`, `,`).
- `app` — anywhere inside `/app/**` (g-prefixed nav chords).
- `inbox` — the inbox list is mounted (j/k, x, hover-target hotkeys).
- `conversation` — a ticket detail is mounted (composer-Cmd+Enter,
  ticket-scoped hotkeys).
- `dialog:cmdk` — the palette is open (Esc, Backspace-on-empty pop).

Mount/unmount of scopes is mechanical: routes push their scope on mount,
pop on unmount. Components don't push scopes.

### 2.2 Context — *ambient state available to all commands*

Slow-changing app state: workspace, current user, theme, feature flags,
current route id. Read from a Zustand store via selectors. Context is
*never* the cause of a re-dispatch — pressing `P` doesn't depend on the
theme.

### 2.3 Target — *the entity a command runs against*

The most subtle of the three. Resolved at dispatch time (palette open
or hotkey fire) and **snapshotted into the dispatched command instance**.
Live-tracking a target after dispatch is a footgun: the user pressed `P`
while looking at row #4; if they mouse to row #6 during the 150 ms it
takes to render the priority picker, picking "Urgent" must apply to row
#4, not row #6. Snapshot it, show it as a chip in the palette input
("Set priority on #DIV-9 ▸"), commit to it.

**Never read the target inside a command's `run()` from a store.**
`run(target, ctx)` takes it as an argument.

---

## 3. Target resolution

Run this precedence at every dispatch (palette open *and* every hotkey
fire). First match wins.

1. **Active form gate.** If `document.activeElement` is `<input>`,
   `<textarea>`, `[contenteditable=true]`, or a descendant of an
   *expanded* `[role=combobox]` / `[role=listbox]`, **the input owns
   the keystroke**. We don't resolve a target; we don't dispatch.
   Exceptions: bindings flagged `allowInInputs` (Cmd+K itself, Esc,
   Cmd+Enter when explicitly opted-in by the form).
2. **Bulk selection.** If `inboxSelectionStore.ids.length > 0`, the
   target is `{ kind: 'bulk', ids }`.
3. **Palette-resolved item.** If the palette is open and the user
   navigated into a sub-page that picked a ticket via search, that
   ticket is the target.
4. **Hovered row.** If `hoveredTargetStore.targetId` is set, that's
   the target. (Hover detection: §3.1.)
5. **URL-focused entity.** If the route is `/app/inbox/t/$shortID` or
   `/app/customers/$id`, the URL ticket/customer is the target.
6. **None.** The command's `condition()` decides whether it's hidden
   ("not applicable here") or disabled with reason ("Select a ticket
   first").

Note: **active-form > bulk** matters. Cmd+Enter inside a composer
sends a reply; it must not trigger a bulk-action even if rows are
selected behind it.

### 3.1 Hover-target detection

One delegated `mouseover` listener on the inbox list container
(`apps/web/src/components/inbox-list.tsx`). On every event, walk
`event.target.closest('[data-ticket-id]')`; if it matches, write to
`hoveredTargetStore`. On `mouseleave` of the list container, clear.

Why delegated, not per-row:

- Survives virtualization (rows mount/unmount; the listener doesn't).
- Zero per-row React listeners.
- Hovering an action button *inside* the row keeps the row as target
  (button is inside `[data-ticket-id]`). Hovering a popover that
  portals out of the row clears the target (portal sits outside the
  list container, so the listener fires `mouseleave`). Both are the
  correct UX.

`hoveredTargetStore` is a tiny Zustand atom (`{ targetId: string |
null }`). The dispatcher reads it via `getState()` imperatively on
keydown — no React subscription, no re-renders.

### 3.2 The "target chip"

When the palette is open with a non-null target, render a small chip in
the input row before the placeholder text:

```
┌──────────────────────────────────────────────────────┐
│ [#DIV-9 ▸]  Set priority to…                         │
└──────────────────────────────────────────────────────┘
```

The chip is a visible commitment: the user pressed Cmd+K *aiming at*
DIV-9; whatever they pick will land on DIV-9 even if their mouse
drifts. Dismiss the chip with Backspace-when-empty, which also clears
the target — useful when the user wants a global command instead.

---

## 4. The Command record

Minimal load-bearing fields:

```ts
interface Command<T extends Target = Target> {
  /** Stable id for the registry. Hierarchical: 'ticket.priority'. */
  id: string;
  /** Display label. */
  label: string;
  /** Group id (Navigation | Ticket | Customer | Composer | View | Settings | Help). */
  group: CommandGroup;
  /** Target predicate: which target shapes this command accepts. */
  accepts: (target: Target) => target is T;
  /** Effect, run with the snapshotted target. */
  run: (target: T, ctx: CommandContext) => void | Promise<void>;
}
```

Optional, presentation-only:

```ts
interface CommandPresentation {
  description?: string;
  icon?: LucideIcon;
  keywords?: ReadonlyArray<string>;
  order?: number;
}
```

Optional, behavioural:

```ts
interface CommandBehaviour<T> {
  /** Deactivate but show a reason. */
  condition?: (target: T, ctx: CommandContext) => true | string;
  /** Open a sub-page on activation instead of running directly. */
  subPage?: (target: T, ctx: CommandContext) => SubPageDescriptor;
}
```

**Hotkeys are NOT a property of the Command.** They live in a parallel
binding registry:

```ts
interface KeyBinding {
  /** tinykeys pattern: '$mod+e', 'g i', '?', '$mod+Shift+a'. */
  pattern: string;
  /** Scope set this binding is active in. */
  scopes: ReadonlyArray<Scope>;
  /** What it does — call out to a Command, or an inline effect. */
  dispatch: { commandId: string } | { effect: (e: KeyboardEvent) => void };
  /** May fire while typing in inputs. Default false. */
  allowInInputs?: boolean;
}
```

Reasons to keep these separate:

- The same command (`ticket.priority`) may be bound to `P` in `inbox`
  scope (acts on hover/URL target) and to nothing in `composer` scope
  (you're typing). Separate records make this trivial.
- Pure-effect bindings (Esc closes the palette, Cmd+\\ toggles a
  sidebar) don't have a Command on the other end. Coupling forces a
  fake "no-op command" pattern.
- The help modal at `?` reads bindings; the palette reads commands.
  Keeping them separate keeps each consumer tight.

---

## 5. Hotkey dispatch

### 5.1 One global listener, capture phase

A single `keydown` listener installed by `<HotkeyDispatcher />` mounted
once at `__root.tsx`. **No component installs its own
`window.addEventListener('keydown')`** — every binding goes through
`useKeyBinding(...)` (or, for components, lives in the catalog).

Capture phase so we win over inner element handlers when the binding
demands it (e.g. Esc closes a popover that has its own internal Esc
handler — we want our scope-stack policy to apply first).

### 5.2 Dispatch ordering

On every event, the dispatcher walks this priority chain:

1. **Form gate.** Per §3 step 1.
2. **Modal stack top.** If a modal is open, only bindings declared
   `scopes: ['modal:cmdk']` (or whichever the topmost modal is)
   match. Esc always pops the topmost modal first.
3. **Active scopes (deepest first).** Conversation > inbox > app >
   global. First match wins.
4. **Sequence buffer.** `g` consumed → wait up to 1000 ms for the
   next key, show a tiny `g…` HUD bottom-left.

The dispatcher reads scopes/modals/sequences imperatively
(`useStore.getState()`) — it never subscribes to React state, so the
dispatcher itself never re-renders.

### 5.3 Form gate detail (the bug everyone has)

```ts
function isTypingInElement(el: HTMLElement | null): boolean {
  if (!el) return false;
  if (el.isContentEditable) return true;
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return true;
  // Combobox / listbox descendants — Radix Select, Tiptap mentions, etc.
  const combobox = el.closest('[role="combobox"], [role="listbox"]');
  if (combobox && combobox.getAttribute('aria-expanded') === 'true') return true;
  return false;
}
```

The combobox check is what the current `useShortcut` is missing. Without
it, opening a Radix Select inside a row swallows the row's hotkeys and
the user can't `j/k` while a select is open.

### 5.4 Sequence chords (`g i`)

[`tinykeys`](https://github.com/jamiebuilds/tinykeys) handles this:
default 1000 ms timeout, registered as `'g i'`. Show a `g…` chord pill
the moment `g` is consumed; clear on second key or timeout. Single-key
bindings on the `g` letter cannot coexist — make `g` exclusively a
prefix.

### 5.5 Conflict detection

At dev startup, walk every `(scope × pattern)` pair and assert
uniqueness. Two commands wanting `Cmd+E` in `conversation` is always a
bug, never an intentional override. Crash in dev, console-warn in prod.

### 5.6 Replacing today's `useShortcut`

Today's `apps/web/src/lib/shortcuts.ts` is the right *interface* but
the wrong *implementation*: each component installs its own listener,
there's no scope concept, no sequences, no combobox gate. We keep the
hook signature for migration ergonomics but reimplement it as a
registration into the global dispatcher:

```ts
useKeyBinding('$mod+k', () => setPaletteOpen(true), { scopes: ['global'] });
useKeyBinding('j',      () => goNext(),             { scopes: ['inbox'] });
useKeyBinding('g i',    () => navigate({ to: '/app/inbox' }), { scopes: ['app'] });
```

Components inside a route inherit the route's scope automatically via
`useScope()`. The migration converts every existing `useShortcut(...)`
call site without changing the call sites' shape — the dispatcher and
scope wrapper are new; the hook is renamed.

---

## 6. Command registry — three tiers

The naive "every component calls `register()` on mount, `unregister()`
on unmount" pattern is the source of every command-palette horror story
(StrictMode double-fires, leaks, ordering bugs, registration races).
Replace it with three tiers, all coexisting, in this order of preference:

### 6.1 Static catalog (most commands)

`apps/web/src/lib/commands/catalog.ts` exports a plain array. Every
command whose `run()` is pure (close ticket, set priority, navigate,
copy ID) lives here. Scope is declared on the command. The catalog is
loaded once at boot, never mutates, trivially testable, and is what the
help modal walks for `?`.

```ts
export const catalog: ReadonlyArray<Command> = [
  {
    id: 'ticket.close',
    label: 'Close ticket',
    group: 'Ticket',
    accepts: isTicketTarget,
    run: (t, { z }) => z.mutate(mutators.ticket.close({ id: t.ticketID })),
  },
  // ...
];
```

### 6.2 Route-bound contributions

Each route file in `apps/web/src/routes/app/**` may export an optional
`commands` array. A small router-bridge (`commands/route-bridge.ts`)
listens to TanStack Router's match changes and calls
`registry.setRouteCommands(routeId, commands)` once per navigation —
not per render, not per component mount. Locality without ordering
bugs.

### 6.3 Dynamic providers (the few cases that need them)

Some sub-pages are derived from data: "Assign to…" lists workspace
members, "Add label…" lists tags. We don't synthesize a Command per
member at idle (registry explosion). We register a single
`CommandProvider`:

```ts
registry.registerProvider({
  id: 'assignee-provider',
  scopes: ['conversation', 'inbox'],
  resolve: ({ ctx }) =>
    ctx.workspaceMembers.map((m) => ({
      id: `ticket.assign.${m.id}`,
      label: `Assign to ${m.name}`,
      group: 'Ticket',
      accepts: isTicketTarget,
      run: (t, { z }) =>
        z.mutate(mutators.ticket.update({ id: t.ticketID, assigneeID: m.id })),
    })),
});
```

`resolve` is only called when the palette opens or a sub-page that
needs the provider activates. The provider reads from already-existing
in-memory caches (workspace members preload, tags preload) — no
extra Zero subscriptions are created on its account.

### 6.4 What `useCommand` is reserved for

A short-lived hook for one-off cases inside dialogs whose lifetime is
genuinely tied to a component (e.g. a wizard step's "Continue"
command). It's a footgun for general use and is discouraged in code
review. Default to catalog or route-bound.

---

## 7. The page stack (cmdk pages)

[`cmdk`](https://github.com/pacocoursey/cmdk) gives us the page stack
primitive. The palette state holds `pages: string[]`; `pages.at(-1)` is
the active page; sub-pages render conditionally (not re-mounted) so
score caches survive.

### 7.1 Keyboard contract (the contract Linear ships)

| Key | Behaviour |
|---|---|
| Esc | Close the entire palette from any depth. |
| Backspace + empty input | Pop one page. At root, close the palette. |
| Backspace + non-empty input | Delete a character. |
| Enter | Activate the highlighted item. |
| Tab | Autocomplete the highlighted command label into the input. |
| Cmd+Enter | Activate, with "open in new tab" semantics where applicable. |

The empty-input check disambiguates: backspace is never both "delete a
character" and "pop a page" in the same press.

### 7.2 Query inheritance between pages

Default: **clear the input on push**. Picker sub-pages (priority,
status) want a fresh fuzzy match against their small option list; the
user's typed-`"DIV-92"` from root is wrong context.

Exception: navigation sub-pages (Switch workspace, Move to team) want
the typed text to come along. Mark these on the sub-page descriptor:
`{ inheritsQuery: true }`.

### 7.3 Sub-page descriptor

```ts
interface SubPageDescriptor {
  id: string;
  /** Title that replaces the placeholder ("Set priority to…"). */
  title: string;
  /** Where items come from. */
  items:
    | { kind: 'static'; commands: ReadonlyArray<Command> }
    | { kind: 'provider'; providerID: string }
    | { kind: 'search'; loader: SearchLoader };
  /** Carry the parent input value. Default false. */
  inheritsQuery?: boolean;
  /** When picked, run the picked command's `run` with the parent target. */
  bindParentTarget: true;
}
```

`bindParentTarget: true` is what makes Linear's "Set priority on
DIV-9 ▸ Urgent" work: the sub-page item ("Urgent") doesn't carry the
target — the target was snapshotted at root, and the chip in the input
visualises the binding.

---

## 8. Live data inside the palette — the Zero rules

The palette is closed 99 % of a session. The wrong design subscribes to
data the user will never look at; the right design subscribes only to
what's already preloaded *or* one-shots external data with abort
semantics.

Three categories of palette data, three different mechanisms:

### 8.1 Preloaded caches → free `useQuery`

Workspace members, tags, recent tickets are already preloaded by
`apps/web/src/lib/zero-preload.ts`. Mounting a `useQuery` for any of
these inside the palette **re-uses the existing server pipeline** — same
`(name, args)` joins the existing IVM materialization, costs only a
small per-subscriber JS view on the client (kilobytes of heap, not
megabytes). Zero docs confirm this pattern.

> Source: zero.rocicorp.dev *"reading-data — Local-Only Queries"*. Same
> `(name, args)` → same server pipeline → second subscriber is
> effectively free.

### 8.2 Local-only filtering → ZQL against in-memory caches

For typeahead inside picker sub-pages (members, tags, recent tickets)
we filter in-memory rather than register a server query per keystroke.
cmdk's built-in scoring + `commandScore` is fine for ≤ 500 items;
beyond that, run a local ZQL filter against the already-synced rows.
**No server roundtrip, no IDB churn.**

### 8.3 Server search → Hono `/api/search` with abort, not Zero

Full-text search across all tickets and customers (potentially 100 k
rows) **must not** be a Zero query. Two reasons:

1. Zero queries materialise their result set into client IDB.
   Searching `"shipping"` would download every row matching `shipping`
   into the client. That's free for 5 rows; ruinous for 5000.
2. Zero ZQL has no real FTS — only `ILIKE`. Postgres `tsvector` + GIN
   does it server-side in ~10 ms.

The right shape is `GET /api/search?q=&types=ticket,customer&limit=10`
hitting Postgres FTS, debounced 150 ms, aborted on next keystroke
(`AbortController`). PostHog's command palette does exactly this; so do
Linear's internals (their search isn't part of the sync engine).

### 8.4 One-shot reads — when?

`zero.run(query)` is the right primitive for "run this once, return,
don't subscribe" — Zero docs explicitly recommend it for non-reactive
needs. Use it for any palette query whose data isn't already preloaded
*and* doesn't justify a real subscription. We expect very few of these:
preloaded caches and the search endpoint cover almost everything.

**Never** call `zero.materialize()` from palette code. It bypasses the
auto-cleanup that `useQuery` and `run()` provide; subscribe-and-forget
becomes a real leak path.

### 8.5 TTL math, briefly

Zero's `ttl` upper bound is 10 min (`MAX_TTL`). "Forever" is achieved
by `zero.preload(...)` at app boot with no cleanup. This is what
`zero-preload.ts` already does for the inbox + workspace metadata.
Anything the palette wants forever should be in there, not in the
palette.

---

## 9. The same model behind right-rail pickers

Linear's right-rail "Set priority" dropdown and the palette's "Set
priority" sub-page both pick a priority for the same ticket. They look
different (chrome differs); they share **everything** else.

The right factoring is a **headless picker primitive**:

```ts
function usePriorityPicker(ticketID: string) {
  return {
    items: PRIORITY_LEVELS,
    current: useQuery(queries.ticketByID({ id: ticketID }), CACHE_NAV)[0]?.priority,
    pick: (level: Priority) =>
      z.mutate(mutators.ticket.update({ id: ticketID, priority: level })),
  };
}
```

Two views — `<PriorityPopover>` (right-rail, anchored to the row) and
`<PriorityPaletteList>` (palette sub-page, `<Command.Item>` rows) — both
consume `usePriorityPicker(...)`. Same data, same mutation, same
optimistic update path. **Every "change priority" surface in the app
becomes automatically consistent**: fix a bug in the hook, the fix lands
in three places.

Same pattern for status, assignee, tags, project.

---

## 10. Recents and suggested

Top-3 recents shown above all groups when the input is empty; hidden
once the user types (lets fuzzy ranking do its job). Persist
`{ commandId, count, lastUsed }` to localStorage, keyed by
`(workspaceId, routeId)`.

Score: `usageCount * exp(-Δt / τ)` with τ ≈ 7 days. Pure-recency forgets
your common actions; pure-count never adapts when you switch projects.

**Never persist arguments.** Store `ticket.priority`, never
`ticket.priority({level: 'urgent', ticketId: 'DIV-9'})`. Privacy +
cross-target reuse.

---

## 11. Discoverability — auto-derive everything

- Every palette item right-aligns its hotkey hint, formatted via
  `formatHotkey(pattern, platform)` → `⌘E` on Mac, `Ctrl+E` elsewhere.
- Every inline action button gets a `<TooltipWithKbd label kbd={…}>`
  (already exists — `packages/ui/src/tooltip-with-kbd.tsx`).
- The `?` cheatsheet reads from the binding registry; commands without
  a hotkey are absent (so the cheatsheet is never noisy with non-keyed
  commands).
- The cheatsheet shows a Mac/Win toggle, defaulting to the platform.
  Useful for screenshots and docs.
- **Training-wheels rule**: dim the hotkey hint on inline buttons after
  the user has used that hotkey ≥ 5 times (counter lives next to
  recents). The hint is for learning, not for life.

---

## 12. Data model & search endpoint

### 12.1 Schema delta

Postgres `tsvector` columns and GIN indexes for the search endpoint:

```sql
ALTER TABLE ticket ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (
    to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(description, ''))
  ) STORED;
CREATE INDEX ticket_search_vector_idx ON ticket USING gin(search_vector);

ALTER TABLE customer ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (
    to_tsvector('simple',
      coalesce(name, '') || ' ' || coalesce(display_name, '') || ' ' || coalesce(email, '')
    )
  ) STORED;
CREATE INDEX customer_search_vector_idx ON customer USING gin(search_vector);
```

`pg_trgm` and `unaccent` are already enabled (`scripts/init-db.sql`).

### 12.2 Hono endpoint

`apps/api/src/routes/search.ts`:

- `GET /api/search?q=&types=ticket,customer&limit=10`
- JWT-scoped to a single workspace.
- Two parallel SQL queries inside one `Promise.all`. Rank =
  `ts_rank(search_vector, plainto_tsquery(q)) + similarity(title, q)`
  for tickets; FTS + email-substring boost for customers.
- Hard-cap each list at `min(limit, 25)`. Default 10.
- Response shape:
  ```ts
  { tickets: Array<{ id, shortID, title, customerEmail, score }>;
    customers: Array<{ id, name, email, score }>; }
  ```
- p95 < 50 ms on 100 k row tables (GIN makes it trivial).

Client wrapper at `apps/web/src/lib/search.ts` exposes
`searchAll(q, signal)` — a thin `fetch` with `AbortController`.

---

## 13. File layout

```
apps/web/src/lib/commands/
  registry.ts              # Zustand store: byId, byScope, providers, scopeStack, modalStack
  dispatcher.ts            # Single global keydown, form-gate, scope-ordered match
  target.ts                # resolveTarget(): Target — runs the §3 precedence
  catalog.ts               # Static command list
  route-bridge.ts          # TanStack-router hook → setRouteCommands per route
  use-key-binding.ts       # Replacement for useShortcut, registers into dispatcher
  use-scope.ts             # Push/pop scope on mount/unmount
  format.ts                # formatHotkey(pattern, platform)
  recents.ts               # localStorage-backed time-decay scoring
  providers/
    members.ts             # Assignee provider (reads preloaded workspace members)
    tags.ts                # Tag provider
    tickets.ts             # Recent-tickets provider

apps/web/src/components/command/
  command-palette.tsx      # cmdk-based dialog, pages stack, target chip
  help-modal.tsx           # ?-triggered cheatsheet, reads from registry
  pickers/
    priority-picker.ts     # Headless hook
    status-picker.ts
    assignee-picker.ts
    tag-picker.ts
  views/
    priority-popover.tsx   # Right-rail view of priority-picker
    priority-palette.tsx   # Palette sub-page view of priority-picker
    # … etc

apps/web/src/lib/
  shortcuts.ts             # DELETED — replaced by lib/commands/use-key-binding.ts

apps/api/src/routes/
  search.ts                # Postgres FTS endpoint
```

---

## 14. Anti-patterns (block in code review)

1. **Hotkey on the Command object.** Bindings live in a separate
   registry. Coupling forces every shortcut user into the palette type
   system.
2. **Reading the target inside `run()` from a store.** Race against
   the snapshot model. Take it as an argument.
3. **`useEffect(() => register(cmd))` without a stable id.** Re-registers
   on every render, double-fires in StrictMode. Use route-bound
   contributions or providers.
4. **Per-row `onMouseEnter` for hover tracking.** Install one delegated
   listener on the list container.
5. **Global `pointermove` listener.** Too eager, fights React.
6. **Boolean `disabled`** without a reason string. UI can't tell the
   user why.
7. **Single `<HotkeysContext.Provider>` value object** holding the
   registry. Every state change re-renders the entire app subtree. Use
   a Zustand store with selectors.
8. **Duplicate bindings across scopes without a conflict check.** Silent
   override; require dev assertion at startup.
9. **Subscribing to ticket-search livequery at app boot.** Wrong tool;
   use the search endpoint.
10. **Stuffing dynamic per-member commands into the static catalog at
    startup.** Use a provider.
11. **Re-mounting `Command.List` on every page push.** Lose scroll,
    throw away score cache.
12. **Carrying input query into picker sub-pages.** Confuses the user;
    clear unless `inheritsQuery: true`.
13. **`zero.materialize()` in palette code.** Manual `destroy()` =
    leak risk. Use `useQuery` (preloaded) or `zero.run()` (one-shot).
14. **Dual implementations during migration.** Land the new engine and
    delete the old `CommandPalette` flat-list shape in the same PR.
15. **Component-local `window.addEventListener('keydown', …)`.** Use
    `useKeyBinding`. Every raw listener is a binding the help modal
    can't see and a conflict the dispatcher can't catch.

---

## 15. Tickets

### T-3001 — Hotkey dispatcher + scope/modal store

**Plan:**
- `lib/commands/registry.ts`: Zustand store with `scopeStack: Scope[]`,
  `modalStack: ModalKey[]`, `pendingChord: string | null`, `bindings`
  (Map by id), `commands` (Map by id), `providers` (Map by id),
  `routeCommands` (Map<routeId, Command[]>), `version: number`.
- `lib/commands/dispatcher.ts`: single `keydown` listener (capture
  phase), runs the §5.2 priority chain. Reads via `getState()` only.
- `lib/commands/use-scope.ts`: `useScope(name)` pushes on mount, pops
  on unmount.
- `lib/commands/use-key-binding.ts`: `useKeyBinding(pattern, dispatch,
  options)` registers into the dispatcher.
- `lib/commands/format.ts`: `formatHotkey(pattern, platform)` →
  `⌘E` / `Ctrl+E`.

**Acceptance:**
- Cmd+K with no command registered is a no-op without warnings.
- `j` while typing in the composer does not navigate.
- Single-key bindings on `g` are forbidden at registry build time.
- Two commands wanting the same `(scope, pattern)` crash in dev.
- Combobox descendants gate single-key bindings (open Radix Select
  in inbox row → `j` doesn't fire).

**Deps:** none.

---

### T-3002 — Target resolution + hover tracker

**Plan:**
- `lib/commands/target.ts`: `resolveTarget(): Target`. Runs §3
  precedence.
- `lib/inbox-selection.ts` already exists (bulk).
- `lib/commands/hover-target.ts`: Zustand store; `<HoverTrackerRoot
  containerRef>` installs one delegated `mouseover` / `mouseleave` on
  the inbox list container.
- Wire into `inbox-list.tsx` — `data-ticket-id` on every row's
  outermost wrapper.

**Acceptance:**
- Hovering an action button inside a row keeps the row as target.
- Mouse leaves the list container → target falls back to URL.
- `selection > hover > url` precedence holds.
- Active form gate beats all of them.

**Deps:** T-3001.

---

### T-3003 — Static catalog + route-bridge

**Plan:**
- `lib/commands/catalog.ts`: catalog of all commands that exist today
  (close, reopen, snooze, set priority, set status, assign, tag,
  copy id, copy url, navigate inbox/customers/settings, palette open,
  cheatsheet open).
- `lib/commands/route-bridge.ts`: hook subscribed to TanStack Router's
  match changes; reads `route.options.commands?` and calls
  `registry.setRouteCommands(routeId, commands)`.
- Add `commands` exports to `routes/app/inbox.tsx`,
  `routes/app/inbox/t.$ticketId.tsx`, `routes/app/customers.index.tsx`,
  `routes/app/customers.$id.tsx`, `routes/app/settings.tsx`.

**Acceptance:**
- Catalog commands surface in the palette in their declared groups.
- Route-bound commands appear only on the matching route.
- Switching route mid-palette re-filters the available items live.

**Deps:** T-3001, T-3002.

---

### T-3004 — cmdk palette with target chip + page stack

**Plan:**
- `components/command/command-palette.tsx`: cmdk `<Command.Dialog>` with
  pages stack. Input row renders the target chip when target is non-null.
- Backspace-on-empty pops a page (or clears the target chip when at
  root with a chip).
- Esc pops one level (palette closes when at root).
- Pages: `static`, `provider`, `search`. `inheritsQuery` honoured.
- `<Command.Item>` rows: icon, label, hotkey hint right.
- Recents group at top when query is empty (T-3007).
- Disabled items render with `condition()` reason as tooltip.

**Acceptance:**
- Cmd+K opens with the right target chip on every (route, hover,
  selection) state.
- `P` then arrow then Enter sets priority on the targeted ticket.
- Backspace flow matches the §7.1 contract.
- Picker sub-pages clear the input; navigation sub-pages inherit it.

**Deps:** T-3003.

---

### T-3005 — Headless picker primitives + dual views

**Plan:**
- `components/command/pickers/{priority,status,assignee,tag}.ts`:
  headless hooks `useXPicker(ticketID): { items, current, pick }`.
- `components/command/views/{x}-popover.tsx`,
  `components/command/views/{x}-palette.tsx`: two views per picker.
- Wire the popover view into the right-rail of
  `routes/app/inbox/t.$ticketId.tsx`.
- Wire the palette view into the corresponding sub-page descriptor.

**Acceptance:**
- Right-rail "Set priority" and palette "Set priority" both call the
  same mutation path with optimistic updates.
- Bug fix in `usePriorityPicker` lands in both views without code
  changes elsewhere.
- No duplicate priority/status/assignee enums in the codebase.

**Deps:** T-3004.

---

### T-3006 — Search endpoint + palette wiring

**Plan:**
- Drizzle migration adding the `search_vector` columns + GIN indexes.
- `apps/api/src/routes/search.ts`: Hono GET handler.
- `apps/web/src/lib/search.ts`: `searchAll(q, signal)`.
- Palette: when input is non-empty AND the active page is root,
  debounce 150 ms and call `searchAll`. Render two extra groups
  ("Tickets", "Customers") above command groups. Abort on next
  keystroke and on close.

**Acceptance:**
- Empty query returns `{ tickets: [], customers: [] }`.
- "ack" matches tickets with "acknowledge" in title and customers
  named "Jack".
- p95 < 50 ms on 100 k row tables.
- Cross-workspace data never returned.

**Deps:** T-3004.

---

### T-3007 — Recents + cheatsheet

**Plan:**
- `lib/commands/recents.ts`: localStorage-backed `{ commandId, count,
  lastUsed }` per `(workspaceId, routeId)`. Score
  `count * exp(-Δt / τ)`, τ = 7 days.
- Top-3 recents render as a "Recent" group above all others when
  input is empty; hidden once the user types.
- Never persist command arguments — only `commandId`.
- `components/command/help-modal.tsx`: `?` triggered, reads bindings
  from registry, groups by category, Mac/Win toggle. Dialog-shape;
  searchable.

**Acceptance:**
- Used commands move to "Recent" weighted by recency + count.
- Switching route changes the recents list.
- `?` opens cheatsheet from any route, including with a ticket open.

**Deps:** T-3001, T-3004.

---

### T-3008 — Migrate `useShortcut` → `useKeyBinding`

**Plan:**
- Mechanical rename + swap import path.
- Delete `lib/shortcuts.ts`.
- Add `useScope(...)` pushes to inbox / conversation / customer routes.
- Verify the existing `j/k/Enter/e/x` etc. behaviour is preserved
  end-to-end via agent-browser.

**Acceptance:**
- Zero behavioural regression on existing hotkeys.
- All bindings discoverable in the cheatsheet.
- No raw `window.addEventListener('keydown', …)` in `apps/web/src`.

**Deps:** T-3001.

---

### T-3009 — Performance & a11y pass

**Plan:**
- Palette dialog `lazy()`; mounted only when open.
- Focus trap inside palette (Radix Dialog handles); restoration on
  close.
- Screen-reader announcement on open ("Command palette, type to filter
  actions").
- Lighthouse a11y ≥ 95 on the palette.
- No console warnings on open/close cycle.
- Zero unnecessary re-renders: dispatcher never re-renders, palette
  re-renders only on `(activeScopes, registryVersion, inputQuery)`.

**Acceptance:**
- All of the above measured.

**Deps:** T-3004.

---

## 16. Definition of done for Phase 30

- Cmd+K opens palette with the right target chip on every route /
  hover / selection state.
- `?` opens the cheatsheet listing every binding.
- Search across tickets and customers in < 100 ms p95.
- Existing `j/k/Enter/e/x/p/s/a/t` shortcuts flow through the
  registry; no behaviour regression.
- Picker sub-pages share their data model with right-rail popovers
  (one `useXPicker` hook per property).
- Recents persist per `(workspace, route)` with time-decay scoring.
- Type-check + Biome clean.
- Design review pass on palette open / typing / picker / chord-HUD
  flows.

---

## 17. Reading list (the basis for these decisions)

- [Linear's command bar — observed behaviour cross-checked across
  Karri Saarinen Config 2022, "Building Linear", Tuomas Artman on
  devtools.fm, and Linear's keyboard shortcuts docs](https://linear.app/docs/keyboard-shortcuts)
- [`cmdk`](https://github.com/pacocoursey/cmdk) — pages stack, score
  cache, the "search empty + backspace → pop" rule
- [`tinykeys`](https://github.com/jamiebuilds/tinykeys) — `$mod`,
  sequences, default 1000 ms timeout
- [`kbar`](https://github.com/timc1/kbar) — `Action` / `ActionImpl`
  separation; "what we deliberately don't do"
- [Zero — reading-data, query caching, MAX_TTL,
  `zero.run()` semantics](https://zero.rocicorp.dev/docs/reading-data)
- [PostHog command palette source — registry + scope
  pattern, kea-loaders `breakpoint(250)` debounce/cancel](https://github.com/PostHog/posthog/blob/master/frontend/src/lib/components/Search/searchLogic.tsx)
- [Superhuman — "How to build a remarkable command
  palette"](https://blog.superhuman.com/how-to-build-a-remarkable-command-palette/)
- [Raycast — extension command
  manifest](https://developers.raycast.com/api-reference/environment)
- [WAI-ARIA Authoring Practices — Combobox /
  Listbox](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/)
