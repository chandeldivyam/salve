# Phase 30 — Cmd+K + Hotkey Registry

## Goal

After this phase: pressing Cmd+K (Ctrl+K on Linux/Win) opens a fuzzy command palette that exposes every action in the app, finds tickets and customers by free-text search, and shows discoverable hotkeys. A `?` shortcut opens a hotkey reference modal. Every action that exists today (assign, close, snooze, set priority, change status, add tag, set field) becomes a registered command with a hotkey hint.

## Why now

This is the "feels like a real helpdesk" moment. Once the registry exists, every later phase ships its actions as one-line command registrations rather than bespoke menus. Phase 40 (custom views), 50 (bulk), 60 (canned), 70 (notifications), 80 (display settings), 90 (merge/scheduled) all hang off this.

## Atlas behavior

### Command registration system

- **Provider:** `jsapp/src/commandbar/CommandProvider.tsx:40-141`. Holds a global Map of registered commands. Listens to global keydown.
- **Hook:** `jsapp/src/hooks/useCommand.tsx:61-134`. Component-scoped registration; deregisters on unmount.
- **Registry sources:**
  - Inbox commands: `jsapp/src/app/inbox/useInboxCommands.tsx`
  - Conversation commands: `jsapp/src/hooks/use-conversation-commands.tsx`
- **Categories enum:** `jsapp/src/hooks/useCommand.tsx:13-24`.
- **Build-time index:** `jsapp/src/inferred/collected-hotkeys.json` — auto-generated; lists every hotkey with category, description, mac/win variants. Used by the help modal.
- **UI primitive:** `@atlas/uicorn/lib/Control/CommandMenu` (proprietary). We'll substitute with [`cmdk`](https://github.com/pacocoursey/cmdk) — same idiom, MIT-licensed, headless.

### Command record shape (Atlas)

```ts
type Command = {
  key: string;           // unique id ("ticket.close")
  label: string;         // "Close Ticket"
  description?: string;  // shown when disabled, or as subtle hint
  group: CommandCategory; // "Ticket Actions" | "Navigation" | ...
  order?: number;        // sort within category
  disabled?: boolean | string; // string is the reason
  hotkey?: { mac: string; win: string }; // "cmd+enter" / "ctrl+enter"
  onChoose: () => void | Promise<void>;
  icon?: ReactNode | string;
  keywords?: string[];   // search aliases
};
```

### Hotkey framework

- Library: `@atlas/tool/box/event/hotkey` (proprietary).
- Multi-platform aware: cmd ↔ ctrl, option ↔ alt automatically.
- Two-key chords supported (`J`, `I` to "Jump to inbox").
- Priority system: longer chords beat shorter (avoids conflicts).
- Context filtering: hotkey only fires if a context predicate is true (e.g., "only if a ticket is open").
- Conditional disable: hotkeys grey out when their command is disabled.

### Quick-search inside palette

- File: `jsapp/src/commandbar/CommandProvider.tsx:158-246`.
- When the user types into the palette, in addition to fuzzy-matching commands, Atlas calls `api.search.quickSearch(query)`.
- Backend: OpenSearch — returns interleaved tickets + customers (top 10 of each, ranked).
- Result rows render distinctly: ticket → `#shortID title — customer.email`; customer → `name — email`.
- Choosing a ticket result jumps to its conversation; choosing a customer jumps to their timeline.

### Atlas command catalog (full list)

From `jsapp/src/commandbar/hotkey-modal/list.ts` and the two `useInboxCommands` / `use-conversation-commands` files:

**Navigation**
- `view.ticket` — Enter — open focused ticket
- `view.ticket.focus` — Shift+Enter
- `nav.next` / `nav.prev` — ↓ / ↑
- `inbox.next` / `inbox.prev` — Cmd+→ / Cmd+←
- `inbox.tab.1`–`inbox.tab.9` — Ctrl+1..9
- `inbox.tab.last` — Ctrl+9
- `inbox.jump` — J,I (chord, opens picker)
- `ticket.next` / `ticket.prev` (timeline) — hotkeys

**Ticket Actions**
- `ticket.close` — Cmd+O (Atlas overloads "open" letter for "close" — we'll use Cmd+E)
- `ticket.open` — Cmd+R (reopen)
- `ticket.snooze` — opens picker
- `ticket.priority` — Cmd+P
- `ticket.status` — Cmd+S
- `ticket.assign` — Cmd+A
- `ticket.assign.me` — Cmd+Shift+A
- `ticket.assign.team` — Cmd+T (deferred — Phase 95)
- `ticket.assign.zeus` — out of scope
- `ticket.tag` — Cmd+L (Label)
- `ticket.read.toggle` — Shift+U
- `ticket.merge` — Cmd+M (Phase 90)
- `ticket.switch_customer` — Phase 90
- `ticket.delete` — backspace on selection (Phase 50)
- `ticket.subject.edit` — E

**Composition**
- `composer.send` — Cmd+Enter
- `composer.canned` — Cmd+/ (insert canned response, Phase 60)
- `composer.variable` — Cmd+{ or @ prefix (Phase 60)
- `composer.mention` — @ prefix (Phase 60)
- `composer.note.toggle` — Cmd+. (toggle internal note)

**Search & filtering**
- `palette.open` — Cmd+K
- `inbox.preview.toggle` — Space
- `inbox.sort` — Ctrl+S

**System**
- `settings.open` — , (single comma)
- `help.shortcuts` — ?

## Design decisions for opendesk

1. **Library:** `cmdk` (Pacocoursey). Already shadcn-friendly. Add to `packages/ui/src`.
2. **Hotkey library:** [`tinykeys`](https://github.com/jamiebuilds/tinykeys) — 700-byte vanilla, supports chords, platform-aware via `$mod`. No React dep.
3. **Registry:** lives in `apps/web/src/lib/commands/`. Module-scoped store using a small zustand or even raw subscribers; not Zero-backed (commands are app-state, not server-state).
4. **Search endpoint:** `/api/search?q=...&types=ticket,customer&limit=10` — Postgres `pg_trgm` similarity + `tsvector`. Workspace-scoped via JWT.
5. **Hotkey collection:** instead of build-time JSON, derive at runtime from registry — the help modal reads the same store.
6. **Mac/Win keys:** use `$mod` from tinykeys — renders as `⌘` / `Ctrl` in UI based on `navigator.platform`.

## Schema delta

None for the registry. The search endpoint requires a Postgres tsvector column on `ticket` and `customer`:

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

`pg_trgm` and `unaccent` are already enabled in `scripts/init-db.sql`.

## Hono endpoint

`apps/api/src/routes/search.ts`:

- `GET /api/search?q=&types=&limit=`
- Auth via existing JWT middleware.
- Behavior:
  - For `ticket`: rank = `ts_rank(search_vector, plainto_tsquery(q)) + similarity(title, q)`. Filter workspace.
  - For `customer`: same idea on customer search_vector + email substring boost.
  - Returns `{tickets: TicketHit[], customers: CustomerHit[]}` where `Hit = {id, title|name, email?, shortID?, score}`.
  - Hard-cap each list at `min(limit, 25)`. Default 10.
- Response time goal: <50 ms p95 on 100k row tables (gin index makes this trivial).

## Tickets

### T-3001 — Hotkey library + global key dispatcher

**Atlas ref:** `jsapp/src/commandbar/CommandProvider.tsx:69-108`.

**Plan:**
- Add `tinykeys` dep to `apps/web`.
- New file `apps/web/src/lib/commands/dispatcher.ts`:
  - Single global keydown listener mounted in `__root.tsx`.
  - Reads from a registry (T-3002).
  - Skips keys when focus is in `<input>`, `<textarea>`, or `[contenteditable]` UNLESS the binding includes `$mod` (so Cmd+Enter still works in the composer).
  - Supports chord sequences (e.g., `g i` for "go to inbox").
- Helper `formatHotkeyLabel(hotkey)` — turns `"$mod+e"` into `"⌘E"` on Mac, `"Ctrl+E"` elsewhere.

**Acceptance:**
- Pressing Cmd+K (no command registered yet) is a no-op without warnings.
- Typing in the composer does not trigger registered single-letter shortcuts.
- Holding modifiers in inputs *does* trigger.

**Deps:** none.

---

### T-3002 — Command registry and `useCommand` hook

**Atlas ref:** `jsapp/src/hooks/useCommand.tsx:61-134`.

**Plan:**
- New `apps/web/src/lib/commands/registry.ts`:
  - Zustand store of `Map<string, Command>`.
  - `register(cmd)` / `unregister(key)`.
  - Subscribers for the palette and help modal.
- New `apps/web/src/lib/commands/use-command.ts`:
  - Component hook: stable register on mount, unregister on unmount.
  - Re-registers when `cmd.disabled` or `cmd.onChoose` reference changes.
- Command type:

```ts
type Command = {
  key: string;
  label: string;
  description?: string;
  group: CommandGroup;
  order?: number;
  disabled?: boolean | string;
  hotkey?: string; // tinykeys binding "$mod+e" or "g i"
  keywords?: string[];
  icon?: LucideIcon | ReactNode;
  onChoose: () => void | Promise<void>;
  context?: () => boolean; // optional predicate (e.g., "only when a ticket is selected")
};
```

- `CommandGroup` enum: `Navigation | Ticket | Customer | Composer | View | Settings | Help`.

**Acceptance:**
- Registering same key twice replaces (with dev warning).
- `useCommand` cleans up on unmount.
- Hotkey routes to the command's `onChoose` only when `context?.() !== false`.

**Deps:** T-3001.

---

### T-3003 — Command palette UI

**Atlas ref:** `@atlas/uicorn/lib/Control/CommandMenu` (proprietary; we substitute with `cmdk`).

**Plan:**
- Add `cmdk` to `packages/ui/src/cmd-palette.tsx`.
- Component `<CommandPalette />`:
  - Mounted in `__root.tsx`.
  - Trigger: Cmd+K registered as a base command in T-3002.
  - Renders `<Command.Dialog>` with `<Command.Input>` and grouped `<Command.Item>` rows.
  - Group headers: Navigation, Ticket Actions, Customer, Composer, View, Settings, Help.
  - Each item: icon | label | hotkey hint right-aligned.
  - Disabled items grey + tooltip showing `disabled` reason string.
  - Recently used: persisted in localStorage, top group "Recent" (last 5).
- Keyboard: arrows navigate, Enter chooses, Esc closes.

**Acceptance:**
- Cmd+K opens palette over any route without losing scroll.
- Filtering by typing (fuzzy match label + keywords) ranks correctly.
- Disabled items don't fire on Enter.
- Recently used appears next session.

**Deps:** T-3002.

---

### T-3004 — Help modal (`?` shortcut)

**Atlas ref:** `jsapp/src/commandbar/hotkey-modal/`, `list.ts`.

**Plan:**
- New `apps/web/src/components/help-modal.tsx`.
- Reads from registry (T-3002), renders all commands with hotkeys grouped by category.
- Search input at top filters labels + keywords.
- Mac/Win toggle — defaults to platform; overrideable for screenshots/docs.
- Triggered by `?` key (registered as a base command).

**Acceptance:**
- `?` opens modal even when no ticket is selected.
- Filtering reduces list live.
- Each row shows readable hotkey ("⌘E" / "Ctrl+E").

**Deps:** T-3002.

---

### T-3005 — Search endpoint + tsvector columns

**Atlas ref:** `webapp/web/search/` (OpenSearch). We use Postgres FTS instead.

**Plan:**
- Drizzle migration adding `search_vector` generated columns to `ticket` and `customer` (per Schema delta).
- Hono route `apps/api/src/routes/search.ts`:
  - GET `/api/search?q&types=ticket,customer&limit=10`
  - Two parallel SQL queries inside one `Promise.all`.
  - Workspace inferred from JWT.
  - Returns `{tickets: [...], customers: [...]}`.
- Add to api router in `apps/api/src/index.ts`.
- Tiny client helper `apps/web/src/lib/search.ts` wrapping `fetch("/api/search")` with abort signal.

**Acceptance:**
- Empty query returns `{tickets: [], customers: []}`.
- "support" matches both ticket titles and customer names.
- 1k seeded rows: response <50 ms p95.
- Cross-workspace data never returned.

**Deps:** none (parallel with palette tickets).

---

### T-3006 — Wire search into palette (interleaved tickets + customers)

**Atlas ref:** `jsapp/src/commandbar/CommandProvider.tsx:158-246`.

**Plan:**
- When palette input is non-empty, debounce 150 ms and call `/api/search`.
- Render two extra groups: "Tickets" and "Customers", placed above command groups.
- Ticket row: `#shortID — title (customer.email)` — choose navigates to `/app/inbox/t/$shortID`.
- Customer row: `name — email` — choose navigates to `/app/customers/:id`.
- Cancel inflight request on next keystroke (AbortController).
- Show subtle inline spinner in the input while inflight.

**Acceptance:**
- Typing "ack" finds tickets with "acknowledge" in title and customers named "Jack".
- Choosing either result closes palette + navigates.
- Slow network keeps UI responsive (debounced + abortable).

**Deps:** T-3003, T-3005.

---

### T-3007 — Register existing inbox + ticket commands

**Atlas ref:** `useInboxCommands.tsx`, `use-conversation-commands.tsx`.

**Plan:**
- New `apps/web/src/lib/commands/inbox-commands.ts` — hook used by inbox-list.
- Registers:
  - `nav.next` / `nav.prev` (j/k + ↓↑) — replace existing hardcoded handler.
  - `view.ticket` (Enter).
  - `inbox.tab.next` / `inbox.tab.prev` — `[` / `]` for now (Cmd+arrows interfere with browser nav).
  - `inbox.tab.{all,unassigned,mine,resolved}` — number keys 1–4.
  - `inbox.preview.toggle` (Space) — placeholder for Phase 80.
- New `apps/web/src/lib/commands/ticket-commands.ts` — hook used by conversation page.
- Registers:
  - `ticket.close` ($mod+e), `ticket.reopen` ($mod+shift+e).
  - `ticket.priority` ($mod+p) — opens priority sub-menu (palette filters to priority items).
  - `ticket.status` ($mod+s).
  - `ticket.assign` ($mod+a).
  - `ticket.assign.me` ($mod+shift+a).
  - `ticket.snooze` (z).
- `context: () => !!ticketID` so hotkeys only fire on conversation page.
- Remove legacy hardcoded handlers from `inbox-list.tsx`.

**Acceptance:**
- Existing j/k/Enter/e behavior preserved through commands.
- New hotkeys discoverable in help modal.
- Palette searchable by command label and keywords (e.g., search "archive" finds Close).

**Deps:** T-3001, T-3002, T-3003.

---

### T-3008 — Settings + Help nav commands

**Plan:**
- Register: `settings.open` (`,`), `settings.tags`, `settings.custom-fields`, `settings.email`, `help.shortcuts` (`?`).
- These are pure navigation — `onChoose` calls `router.navigate(...)`.

**Acceptance:**
- Commands appear in palette under Settings/Help groups.
- Comma key opens settings even from inbox.

**Deps:** T-3002, T-3004.

---

### T-3009 — Sub-palette pattern for picker actions

**Atlas ref:** "Change priority" opens its own sub-list of Low/Med/High/Urgent.

**Plan:**
- Pattern in `cmd-palette.tsx`: pages stack. Choosing a "picker" command swaps the palette content rather than closing.
- Implement for: `ticket.priority` (4 items), `ticket.status` (5 items), `ticket.assign` (workspace members), `ticket.tag` (tags).
- Esc returns to root palette.

**Acceptance:**
- Cmd+P opens palette in priority mode showing 4 levels with hotkey hints.
- Picker remembers last used (top of list).
- Esc closes only the sub-page, not the dialog (first Esc back, second Esc closes).

**Deps:** T-3007.

---

### T-3010 — Performance and accessibility

**Plan:**
- Palette mounts only when open (lazy via `<CommandPalette open={...} />`).
- All commands have `aria-label`s.
- Focus trapped in dialog; restoration on close.
- Keyboard-only flow tested: open → type → arrow → Enter → close.
- Screen-reader announcement when palette opens ("Command palette, type to filter actions").

**Acceptance:**
- Lighthouse a11y ≥ 95 on the palette.
- Zero console warnings on open/close cycle.

**Deps:** T-3003.

---

## Definition of done for Phase 30

- Cmd+K opens palette with all currently-implemented actions registered.
- `?` opens help modal listing every hotkey.
- Search finds tickets and customers in <100 ms p95.
- Existing j/k/Enter/e shortcuts now flow through the registry, no behavior regression.
- Sub-palette pattern works for priority/status/assignee/tag pickers.
- Type-check + Biome clean.
- Design review pass on palette open/typing/picker flows.
