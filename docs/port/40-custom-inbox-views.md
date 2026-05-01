# Phase 40 — Custom Inbox Views

## Goal

After this phase: agents can save the current inbox filter as a named view, reorder views as tabs, group conversations within a view by an axis (assignee / priority / tag / status / custom field), and share views workspace-wide. The hardcoded `all | unassigned | mine | resolved` strip becomes one row of *built-in* views among many.

## Why now

Custom views are the daily-use surface for triage workflows. They depend on tags + custom fields (Phase 10) for filterability and on the command registry (Phase 30) for "Save current filter…" / "Open view…" commands.

## Atlas behavior

### Saved searches / custom inboxes

- **Backend model:** `webapp/web/search/saved_search.py`. Tied to `company_id` (workspace-wide; not per-agent).
- **APIs:** `POST /search/saved-search/`, `PUT /search/saved-search/{id}`, `DELETE /search/saved-search/{id}`. Backend file: `webapp/web/search/apis.py`.
- **Frontend store:** `jsapp/src/stores/ticketing/controllers/InboxController.tsx:98-120` — `customInboxSaved`, `customInboxes` Map.
- **Create/edit modal:** `jsapp/src/components/search/SaveModal.tsx`.
- **Filters menu:** `jsapp/src/app/inbox/filters-menu.tsx:50-200+` (filter operators) and `jsapp/src/app/inbox/filters-menu.tsx:94-150` (edit/delete/download per-view actions).

### View shape (Atlas)

```ts
type SavedQuery = {
  id: string;
  label: string;
  description?: string;
  icon?: string;       // emoji or icon id
  color?: string;
  query: {
    filters: Filter[];      // {field, operator, value}
    search?: string;        // free-text search
    status?: string[];
    priority?: string[];
    tags?: string[];
    assignee?: string[] | "unassigned" | "me";
    // ... etc
  };
  sort?: { field: string; direction: "asc" | "desc" };
  groupBy?: string;     // "assignee" | "priority" | "status" | "tag" | "custom_field:KEY"
  position: number;     // for tab ordering
  archivedAt?: string;
};
```

### Group-by axis (the killer feature)

- A view can specify `groupBy: "priority"` and the inbox renders sectioned: each priority becomes a collapsible group with its conversations beneath.
- Empty groups still render with a "0" count.
- Group expansion state persists per-view per-agent in localStorage.

### Filter operators (Atlas)

- File: `jsapp/src/app/app-config/custom-fields/fieldOperators.tsx`.
- Per type: equals, not equals, contains, in, not in, before, after, between, is empty, is not empty.
- Filters are AND'd by default; OR groups available in advanced builder.

### Counts per view

- Atlas calls `GET /conversation/totals` returning `{view_id: count}` for the tab badges.
- Refreshed on view change and after mutations that affect membership.

## Schema delta

### `view.ts` (new)

```ts
export const viewKindEnum = pgEnum("view_kind", ["builtin", "custom"]);
export const viewScopeEnum = pgEnum("view_scope", ["workspace", "personal"]);

export const view = pgTable("view", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceID: uuid("workspace_id").notNull().references(() => workspace.id, { onDelete: "cascade" }),
  kind: viewKindEnum("kind").notNull().default("custom"),
  scope: viewScopeEnum("scope").notNull().default("workspace"),
  ownerID: uuid("owner_id").references(() => user.id, { onDelete: "set null" }),
  // owner is who created it; for "personal" views, only this user sees them.
  label: text("label").notNull(),
  description: text("description"),
  icon: text("icon"),    // lucide icon name or emoji
  color: text("color"),
  query: jsonb("query").$type<ViewQuery>().notNull(),
  sort: jsonb("sort").$type<ViewSort>().notNull().default({ field: "updatedAt", direction: "desc" }),
  groupBy: text("group_by"), // null = no grouping
  position: integer("position").notNull().default(0),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt, updatedAt,
}, (t) => [
  index("view_workspace_idx").on(t.workspaceID, t.archivedAt, t.position),
  index("view_owner_idx").on(t.ownerID, t.scope),
]);
```

### Built-in views

We don't seed these as rows. Instead the UI shows them as fixed entries in the tab strip and the `views()` Zero query is layered with built-in definitions client-side. This keeps the schema minimal and avoids stale built-in rows on workspace creation.

### Query DSL types (shared, in `packages/core/src/views.ts`)

```ts
export type FilterField =
  | "status" | "priority" | "assignee" | "tag" | "channel"
  | "createdAt" | "updatedAt" | "firstResponseAt" | "resolvedAt"
  | `custom_field:${string}`;

export type FilterOperator =
  | "eq" | "neq" | "in" | "nin"
  | "contains" | "ncontains"
  | "before" | "after" | "between"
  | "empty" | "nempty";

export type Filter = {
  field: FilterField;
  operator: FilterOperator;
  value?: unknown;
  values?: unknown[]; // for "in" / "nin" / "between"
};

export type ViewQuery = {
  filters: Filter[];           // AND'd
  search?: string;             // free-text, hits FTS endpoint
  matchAll?: boolean;          // default true; false = OR
};

export type ViewSort = {
  field: "updatedAt" | "createdAt" | "priority" | "shortID" | `custom_field:${string}`;
  direction: "asc" | "desc";
};

export type GroupByAxis =
  | "assignee" | "priority" | "status" | "tag"
  | `custom_field:${string}` | null;
```

## Zero queries

```ts
views: () =>
  applyWorkspaceScope(z.query.view)
    .where("archivedAt", "IS", null)
    .where(({ or, cmp, AUTH }) =>
      or(cmp("scope", "workspace"), cmp("ownerID", AUTH.sub))
    )
    .orderBy("position", "asc").orderBy("createdAt", "asc").orderBy("id", "asc"),

viewByID: ({ id }) =>
  applyWorkspaceScope(z.query.view).where("id", "=", id).one(),
```

The materialized inbox query for a *custom* view runs **client-side** by composing `applyWorkspaceScope(z.query.ticket)` with the view's filters. We add a helper:

```ts
// packages/zero-schema/src/queries.ts
ticketsForView: ({ viewID, viewQuery }: { viewID: string, viewQuery: ViewQuery }) => {
  let q = applyWorkspaceScope(z.query.ticket);
  for (const f of viewQuery.filters) {
    q = applyFilterToQuery(q, f);
  }
  return q
    .related("customer").related("assignee")
    .related("tags", q => q.related("tag", t => t.related("group")))
    .related("customFieldValues", q => q.related("field"));
}
```

Where `applyFilterToQuery` is a switch on `field` + `operator` that adds the right `.where()` clauses. Free-text `search` is **not** applied here — see T-4006.

## Mutators

`packages/mutators/src/view-mutators.ts`:

- `view.create({ id, label, description?, icon?, color?, scope, query, sort?, groupBy?, position? })`
- `view.update({ id, label?, description?, icon?, color?, query?, sort?, groupBy? })`
- `view.archive({ id })`
- `view.reorder({ orderedIDs[] })` — accepts the new order; mutator updates `position` for the IDs included, leaves others untouched.

Audit events: `view.created`, `view.updated`, `view.archived`, `view.reordered`.

## UI surfaces

### `apps/web/src/components/inbox-tabs.tsx` (new)

- Replaces the hardcoded 4-button strip in `inbox-list.tsx`.
- Renders built-in views (All / Unassigned / Mine / Resolved / Archived) followed by custom views in `position` order.
- Each tab: icon + label + count badge.
- Right-edge "+" button → opens "Save current filter as view" modal.
- Drag-reorder via `@dnd-kit/sortable` (custom views only).
- Right-click on tab → context menu (Edit, Duplicate, Archive, Download CSV).

### `apps/web/src/components/inbox-filter-bar.tsx` (new)

- Above the list: filter chips ("Status: Open, In Progress", "Priority: High", "Tag: billing"), each removable.
- "+ Filter" button → popover with filter builder.
- "Sort" button → sort picker.
- "Group by" button → axis picker.
- Search input (free-text).
- "Save as view" button (highlighted if filters differ from current view).

### Filter builder popover

- Two-step: pick field → pick operator + value.
- Field list: status, priority, assignee, tag, channel, dates, custom fields (active ticket-category).
- Per-type operator/value editors:
  - status / priority → multi-select from enum.
  - assignee → workspace members combobox + "Unassigned" option + "Me".
  - tag → tag combobox.
  - dates → date picker with operator.
  - custom field text → text + operator.
  - custom field list/multi-select → option picker.

### Group-by renderer

- When `groupBy` is set, the virtualized list renders section headers between groups.
- Headers: axis label + count + collapse caret.
- Collapse state persists in localStorage keyed by `(viewID, axisValue)`.
- "Show empty groups" toggle in view config.

## Tickets

### T-4001 — View schema + Zero mirror

**Atlas ref:** `webapp/web/search/saved_search.py`.

**Plan:**
- Drizzle migration adding `view` table.
- Zero mirror.
- Shared types in `packages/core/src/views.ts`.
- Helper `applyFilterToQuery` in `packages/zero-schema/src/views.ts`.

**Acceptance:**
- Migration applies clean.
- Helper passes unit tests for each `(field, operator)` combo.
- Workspace + personal scope query returns correct subset.

**Deps:** Phase 10 (T-1001, T-1006).

---

### T-4002 — View mutators

**Atlas ref:** `webapp/web/search/apis.py`.

**Plan:**
- Mutators per spec above.
- Server-side validation of `query` shape (Zod schema mirroring `ViewQuery`).
- `position` defaults to max+1 within scope on create.
- Audit events.

**Acceptance:**
- Create view, reorder, archive — all live across windows.
- Invalid `query` rejected server-side.
- Personal-scope view invisible to other users.

**Deps:** T-4001.

---

### T-4003 — Tab strip component (replace hardcoded tabs)

**Atlas ref:** `jsapp/src/app/inbox/index.tsx:35-300` (inbox layout).

**Plan:**
- `inbox-tabs.tsx`. Reads built-ins from a constant, custom views from `views()` query.
- Renders icons + labels + count badges.
- Click → updates URL search param `?view=<id|builtin-key>`.
- Drag-reorder for custom views, calls `view.reorder` on drop.
- Wire into `apps/web/src/routes/app/inbox.tsx`.

**Acceptance:**
- All 4 built-ins still navigable.
- Adding a custom view appears as a new tab without refresh.
- Reorder persists.

**Deps:** T-4002.

---

### T-4004 — Filter bar + filter builder popover

**Atlas ref:** `jsapp/src/app/inbox/filters-menu.tsx:50-200+`.

**Plan:**
- `inbox-filter-bar.tsx` reads + writes the `query` of the currently-loaded view.
- For built-ins: filter bar is editable but a tooltip warns "Saving will create a new view".
- Filter chips with X to remove.
- "+ Filter" popover: 2-step picker described above.
- Filter values normalized into `Filter` records and passed to `ticketsForView`.

**Acceptance:**
- All filter operators round-trip.
- Removing the last filter shows the unfiltered list (within view scope).
- Edits to built-in views show "Save as new view" CTA.

**Deps:** T-4003.

---

### T-4005 — Inbox query refactor (use `ticketsForView`)

**Atlas ref:** —

**Plan:**
- Refactor `inbox-list.tsx` to subscribe to `ticketsForView({viewID, viewQuery})` instead of `inboxOpen()`.
- Built-in views compose their fixed `ViewQuery`:
  - `all`: `{ filters: [{ field: "status", operator: "in", values: ["open","in_progress","snoozed"] }] }`
  - `unassigned`: `{ filters: [..., { field: "assignee", operator: "empty" }] }`
  - `mine`: `{ filters: [..., { field: "assignee", operator: "eq", value: AUTH.sub }] }`
  - `resolved`: `{ filters: [{ field: "status", operator: "in", values: ["resolved","closed"] }] }`
  - `archived`: `{ filters: [{ field: "deletedAt", operator: "nempty" }] }` (Phase 50)

**Acceptance:**
- All built-in tabs return identical results to current implementation.
- Custom view filters narrow correctly.
- Counts per tab correct (computed via separate count subscription — see T-4007).

**Deps:** T-4001, T-4004.

---

### T-4006 — Free-text search inside views

**Atlas ref:** `jsapp/src/app/inbox/filters-menu.tsx` search input.

**Plan:**
- View `query.search` triggers a `/api/search?q&types=ticket` call (Phase 30).
- Result IDs become the candidate set; merge with the `ticketsForView` rows by intersection.
- Pattern: query for IDs, then `applyWorkspaceScope(z.query.ticket).where("id", "IN", ids)`.
- Debounce 200 ms; abortable.
- Empty search → standard view query.

**Acceptance:**
- Search "billing" inside an "Unassigned" view returns only unassigned tickets matching the term.
- Live updates when new tickets arrive matching both criteria.
- Slow search shows inline spinner; UI not blocked.

**Deps:** Phase 30 (T-3005), T-4005.

---

### T-4007 — Per-view counts

**Atlas ref:** `GET /conversation/totals`.

**Plan:**
- Two options:
  - **Client-side**: each tab subscribes to `ticketsForView({viewQuery, limitFields: true})` and reads `.length`. Cost: N parallel materializations.
  - **Sidecar endpoint**: `GET /api/views/counts` returns `{viewID: count}` from a single SQL query. Refreshed every 30 s + on mutation broadcast.
- **Decision**: start client-side for correctness + simplicity. Switch to sidecar if N>10 views causes lag.

**Acceptance:**
- Each tab shows accurate live count.
- Counts update within 1 s of a status change.
- Tab strip with 10 custom views still renders <16 ms per frame.

**Deps:** T-4005.

---

### T-4008 — Group-by renderer

**Atlas ref:** "Custom views support a group-by axis" — Atlas's `groupBy` setting.

**Plan:**
- In `inbox-list.tsx`, when `view.groupBy` is non-null, partition the rows.
- Header rows in the virtualizer (mixed sizes — use estimateSize variants).
- Axis renderers:
  - `priority` → 4 fixed groups (Urgent, High, Normal, Low).
  - `status` → enum groups.
  - `assignee` → groups by member name + "Unassigned".
  - `tag` → one group per tag the ticket has (a ticket appears in multiple groups). Show "Untagged" group.
  - `custom_field:KEY` → groups by value (or "(no value)").
- Collapse state stored in localStorage `view.groupCollapse:{viewID}:{axisValue}`.

**Acceptance:**
- Toggling groupBy from null → priority sections the list correctly.
- Empty groups appear with "0".
- Multi-tag membership: clicking same ticket from two groups navigates correctly (no key collision).

**Deps:** T-4005.

---

### T-4009 — Save-current-filter modal

**Atlas ref:** `jsapp/src/components/search/SaveModal.tsx`.

**Plan:**
- Modal triggered by "+" tab or "Save as view" CTA in filter bar.
- Form: label (required), description, icon picker (lucide icons), color picker, scope (workspace/personal).
- Sort + groupBy carried over from current state.
- On save → `view.create` mutator, then navigate to the new view.

**Acceptance:**
- Save with empty label rejected.
- Created view appears as the next tab.
- Navigates to it after save.

**Deps:** T-4002, T-4003, T-4004.

---

### T-4010 — Tab context menu (edit / duplicate / archive)

**Plan:**
- Right-click on a custom-view tab → context menu.
- Edit → opens the same modal pre-filled.
- Duplicate → new view with " (copy)" suffix.
- Archive → `view.archive` mutator.
- Built-in tabs only show "Customize" (which creates a personal copy of the built-in).

**Acceptance:**
- All three actions live across windows.
- Archived view disappears from tabs but data preserved (visible in `/settings/views/archived` — deferred).

**Deps:** T-4009.

---

### T-4011 — Cmd+K commands for views

**Plan:**
- Register: `view.open` (one command per view), `view.save_current`, `view.next`, `view.prev`.
- `view.open` per-view commands are dynamically registered when `views()` query data changes.
- Hotkeys: G,V chord opens view picker (palette filtered to view-open commands).

**Acceptance:**
- Cmd+K → typing view name jumps to it.
- G,V chord opens picker.

**Deps:** Phase 30, T-4003.

---

## Definition of done for Phase 40

- Built-in tabs reimplemented through view system; behavior unchanged.
- Custom view: create → filter → group-by → save → reorder → archive flow works.
- Workspace + personal scope respected.
- Per-tab counts live.
- Cmd+K navigates between views.
- Type-check + Biome clean; design review on tabs / filter bar / save modal / grouped list.
