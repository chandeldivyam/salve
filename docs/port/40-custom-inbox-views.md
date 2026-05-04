# Phase 40 — Custom Inbox Views

> Replanned 2026-05-03 against four sources: the current opendesk codebase
> (Phase 30 just shipped), Atlas's `saved_search` implementation, Rocicorp's
> own zbugs reference app (the canonical "Zero at scale" demo), and Linear's
> custom-views UX. The original plan predated the workbench, the command
> registry, and the audit — most of its structural decisions no longer
> apply. Read this document end-to-end before touching `inbox-list.tsx`,
> the route, or the workbench tab system. Phases 50–95 will register their
> own per-view defaults (bulk actions, snooze, SLA), so the data model and
> URL contract here are load-bearing.

---

## 1. What "great" looks like

Linear is the bar, but support is not project management. The five
behaviours we're copying — and the support-specific twists:

1. **Filter-first, save-second.** The agent narrows the inbox with chip
   filters, sees the count drop, and only then promotes the result to a
   saved view (default name auto-derived from the filters). Creating a
   view from cold is a secondary entry point, not the primary one.
2. **Filter chips are mutable in place.** Click the *operator* in
   `Status is open` to flip it to `is not`; click the *value* to multiselect;
   click the *field* to swap the whole chip. No "open builder, edit, apply"
   round-trip.
3. **Display options are a single popover.** `Shift+V` opens Group / Sort /
   Properties / Layout. Personal display tweaks on a saved view stick as a
   client-side preference; structural filter changes raise a save prompt.
   This split is the single most important UX detail Linear gets right.
4. **The drift indicator is honest.** When the live query no longer matches
   the saved view, a subtle banner offers `Save changes` / `Save as new` /
   `Reset`. It never silently mutates the shared view.
5. **Group-by makes the inbox a triage instrument.** Group by Assignee
   (sticky headers, live counts, collapse with `T`) is the default tool a
   manager reaches for. Empty groups still render so an unassigned bucket
   doesn't disappear.

Two support-only twists Linear doesn't have:

- **Default sort is "Oldest waiting", not "Last updated".** The triage
  instinct in support is *what's been ignored longest*, not *what just
  changed*. Built-in views ship with this default.
- **Per-agent ordering of shared views.** Atlas got this right: the view is
  workspace-shared, but each agent reorders their own tab strip. This is a
  separate join row, not a clone.

Non-goals for this phase:

- **No subscribe-to-view → Slack/email digest.** Linear's killer power
  feature, but it depends on Phase 70 (notifications/activity). Defer.
- **No sub-grouping (swimlanes).** Single-axis grouping only. Sub-grouping
  needs board layout and is Phase 41+.
- **No board layout.** List only. Board (kanban) is Phase 41+.
- **No manual drag-to-order rows.** Sort is by axis only. Manual order
  requires `Grouping = None` + per-row position state and is Phase 41+.
- **No view permissions/ACL beyond scope (workspace vs personal).** Atlas's
  per-user `users[]` sharing list is overkill for v1; workspace-shared is
  enough.
- **No `__saved__` recursive composition.** Atlas allows a saved search to
  reference another saved search by ID. Cute, but adds a cycle-detection
  burden we don't need yet.
- **No views as separate workbench tabs.** This is the single biggest
  architectural change from the original plan — see §2.
- **No favorites / sidebar pinning of views.** The view selector inside the
  inbox tab handles ordering and visibility. Phase 41+ may add a Favorites
  rail above the workbench tab strip if the pattern is justified.

---

## 2. The architectural reset: views live *inside* the inbox tab

The original plan assumed views become entries in a tab strip alongside
`Inbox / Customers / Settings` — i.e. each view is a workbench tab. Since
that plan was written, the workbench landed (`apps/web/src/lib/workbench/store.ts`,
`tab-strip.tsx`, `routes.ts`) and made that model wrong:

1. The workbench caps unpinned tabs at 20 (`MAX_UNPINNED_TABS`,
   `store.ts:74`). Power users will save 30+ views.
2. Tabs de-dupe by `tabKey` (`routes.ts:33`). Distinct views as distinct
   tabs would each need a unique key, breaking de-dup.
3. The inbox tab is `pinnedByDefault: true, closable: false`
   (`routes.ts:118-119`). It's a *home* surface, not one tab among
   peers. Splitting it across N view-tabs scatters state — bulk
   selection, j/k focus, scroll position — that should be inbox-global.
4. Workbench tabs persist to `localStorage` keyed by user. View
   definitions are server-side. Mixing the two storage tiers is what
   created the original confusion.

### The new model

The inbox is **one** workbench tab. Inside it sits a **view container**
with three vertical zones, top-to-bottom:

```
┌─ Inbox tab (workbench) ──────────────────────────────┐
│                                                      │
│  [view-strip]  All · Unassigned · Mine · Resolved   │  ← built-ins +
│                | Billing P1 · VIP · ... · [+]        │    custom views
│                                                      │
│  [filter-bar]  Status: open ✕  Tag: vip ✕  + Filter │  ← chip filters,
│                Group: Assignee · Sort: Oldest        │    display opts
│                Save changes ↑ Reset                  │  ← drift banner
│                                                      │
│  [virtualized list]                                  │
│    ▼ Alice (12)                                      │
│      ─ ticket row ─                                  │
│      ─ ticket row ─                                  │
│    ▶ Bob (4)                                         │
│    ▼ Unassigned (2)                                  │
│      ─ ticket row ─                                  │
└──────────────────────────────────────────────────────┘
```

The URL is the source of truth: `/app/inbox?view=<id>`. The workbench tab
title and icon mirror the active view's `label` and `icon` (via the
existing `setActiveTabTitle` flow with the `forRouteId='inbox'` guard
from `frontend.md` §43). Switching views does **not** spawn a new
workbench tab — the same `inbox` `tabKey` is reused.

This pattern matches how Linear renders a team's Issues page (one
left-rail entry, internal tabs for `All / Active / Backlog`) rather than
how it renders unrelated apps.

---

## 3. The four axes you must keep separate

Like Phase 30's command engine, custom views fail when distinct concepts
get conflated. Four axes:

### 3.1 View shape — *what filters/sort/group define this view*

Persistent, server-side. Fields: `query`, `sort`, `groupBy`, `displayProps`.
Edited via the save modal or by promoting drift. Lives in the `view` table.

### 3.2 View membership / order — *which agents see it, in what order*

Per-agent. Fields: `position`, `hiddenAt`. A workspace-scoped view can be
hidden by a single agent without deleting it for everyone, and each agent
arranges their own tab order. Lives in `view_member` (Atlas pattern, but
trimmed — no `users[]` sharing list because v1 is workspace-or-personal
only).

### 3.3 Live filter state — *what the agent is looking at right now*

URL search params. The structural ones (`view`, `q`, `f.<field>`, `group`,
`sort`) are persistent across navigation; the transient ones (`action`,
`fullDetail`) get dropped on back-nav per the existing
`transientSearchParams` contract in `routes.ts:121`. Drift between live
state and saved view is computed *purely from the URL* — the saved view
is the baseline, the URL is the override.

### 3.4 Personal display preferences — *how the agent likes lists rendered*

Client-side, per-user, per-view, in `localStorage`. Things like:
collapsed-group state, "show empty groups", "show resolved", display
property toggles. These persist silently and never trigger a drift
indicator. This is the lever that lets built-in views feel personal
without ever being mutable.

---

## 4. What we take from each source

### From Atlas (`webapp/web/search/saved_search.py`, `apis.py`,
`InboxController.tsx`):

- The **shape**: a `view` row with `query` JSON + `kind` enum +
  `company_id`. We rename `company_id → workspaceID` and drop the
  recursive `__saved__` field.
- The **per-user ordering** model: a `view_member` join row with
  `position`. Each agent reorders independently.
- **Soft-delete via "hide"**: removing a `view_member` row hides a
  workspace view for one agent without affecting others. Hard delete is a
  separate, scope-checked mutator.
- The **lightweight inboxes endpoint** idea: load the view list first
  (cheap), counts later (potentially expensive). We implement this as a
  separate Zero query.
- The **`mode` toggle** (AND vs OR) at the query level — but we default
  to AND and only expose OR in the advanced filter builder, not the
  default chip bar.

### From zbugs (`/tmp/zero-mono/apps/zbugs`):

- The **dynamic query composition** pattern in `shared/queries.ts:358-449`:
  one `buildListQuery(filters)` that imperatively chains `.where()` /
  `.whereExists()`. We do not ship per-filter query variants. This is
  the single most important pattern to copy exactly.
- **Cursor-based pagination** with a tuple cursor `{id, updatedAt}`,
  bidirectional via `.start(row, {inclusive}).limit(N)` plus direction
  flag. (For v1 we keep the existing growing-window pattern from
  `inbox-list.tsx` and only switch to cursors if memory or sync cost
  becomes a problem; the helper is built so we can switch transparently.)
- **`@rocicorp/zero-virtual` over `@tanstack/react-virtual`** for the
  list itself, with the cursor abstraction encapsulated. `inbox-list.tsx`
  already uses `@tanstack/react-virtual`; we keep that for v1 and revisit
  if sub-grouping arrives in Phase 41+.
- **No per-view live counts.** zbugs intentionally avoids per-filter
  badges. We follow the same pragmatism: counts on the *active* view
  come from `.length` of the materialized query; counts on *inactive*
  views update lazily (see §10).
- **URL-as-source-of-truth.** No Zustand-cached filter state. Debounced
  text-input writes to URL; query subscriptions re-fire from URL params.
- **Mutator style**: shared core + server-wraps for side effects,
  Zod-validated args, generic error messages, security checks before
  existence checks. Already the convention in `packages/mutators/`.

### From Linear (custom-views UX):

- **Filter-first, save-second** as the dominant entry point.
- **Auto-suggested view name** at save time (e.g.
  `Open · Tag: VIP · Last reply: customer`).
- **Chip filters mutable in place** — every segment of every chip is its
  own popover.
- **Display options popover** (`Shift+V`) with Layout / Group+Sort /
  Display properties — but Layout is fixed to "list" for Phase 40.
- **Drift indicator** — `Save changes` / `Save as new` / `Reset`.
- **Personal display drift** sticks silently; **structural filter drift**
  surfaces the save prompt. This is the split codified in §3.3 / §3.4.
- **Built-ins absorb personal display tweaks but cannot be edited
  structurally.** "Save as new" is the only way to fork them.
- **Keyboard surface**: `F` filter, `Shift+V` display, `Alt+V` save,
  `T` collapse group, `J/K` row nav, `Space` peek, `G I` Inbox.
- **Field-aware operators** (e.g. `is/is not` for status, `includes
  any/all/none` for tags, `before/after/in last` for dates).
- The **owner field** on every view (creator, reassignable later — but
  v1 doesn't ship reassignment).

---

## 5. Schema delta

### `view` table — the saved view itself

```ts
// packages/zero-schema/src/db/view.ts
export const viewKindEnum = pgEnum('view_kind', ['inbox']);
// 'inbox' only for now. Phase 41+ may add 'customer', 'report', etc.
export const viewScopeEnum = pgEnum('view_scope', ['workspace', 'personal']);

export const view = pgTable('view', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceID: uuid('workspace_id').notNull()
    .references(() => workspace.id, { onDelete: 'cascade' }),
  kind: viewKindEnum('kind').notNull().default('inbox'),
  scope: viewScopeEnum('scope').notNull().default('workspace'),
  ownerID: uuid('owner_id')
    .references(() => user.id, { onDelete: 'set null' }),
  label: text('label').notNull(),
  description: text('description'),
  icon: text('icon'),                      // lucide icon id, e.g. 'flame'
  color: text('color'),                    // hex or tailwind token
  query: jsonb('query').$type<ViewQuery>().notNull(),
  sort: jsonb('sort').$type<ViewSort>().notNull()
    .default({ field: 'firstResponseDueAt', direction: 'asc' }),
  groupBy: text('group_by'),               // null = no grouping
  displayProps: jsonb('display_props').$type<DisplayProps>(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  createdAt, updatedAt,
}, (t) => [
  index('view_workspace_idx').on(t.workspaceID, t.archivedAt),
  index('view_owner_idx').on(t.ownerID, t.scope),
]);
```

Notes:
- **No `position` column.** Ordering is per-agent and lives in
  `view_member` (§5.2). This is the Atlas pattern; the original plan
  put `position` on the view and was wrong.
- **`displayProps` is part of the saved view.** Personal display
  *overrides* live in `localStorage`, but the saved baseline lives here
  so a workspace view can ship with sensible defaults
  (e.g. "show customer plan column").
- **Default sort: `firstResponseDueAt asc`.** Support's "Oldest
  waiting" — this column will exist after Phase 95 (SLA). Until then
  the default is `updatedAt desc` and we silently switch the default
  when the column ships.
- **`archivedAt` instead of `deletedAt`.** Atlas does soft-delete;
  Phase 50 will introduce uniform soft-delete; for now `archivedAt` is
  the user-visible "archive" action.

### `view_member` table — per-agent ordering and hiding

```ts
export const viewMember = pgTable('view_member', {
  viewID: uuid('view_id').notNull()
    .references(() => view.id, { onDelete: 'cascade' }),
  userID: uuid('user_id').notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  workspaceID: uuid('workspace_id').notNull()
    .references(() => workspace.id, { onDelete: 'cascade' }),
  position: integer('position').notNull().default(0),
  hiddenAt: timestamp('hidden_at', { withTimezone: true }),
  createdAt, updatedAt,
}, (t) => [
  primaryKey({ columns: [t.viewID, t.userID] }),
  index('view_member_user_idx').on(t.userID, t.workspaceID),
]);
```

Lifecycle:
- On agent first load, server seeds `view_member` rows for the agent for
  every workspace-scoped view they don't already have a row for. (Done in
  the existing `applyTicketRead` initialization path or a small lazy
  upsert; finalize in T-4002.)
- Reorder updates `position` for the rows in the dragged set; never
  rewrites all rows.
- Hide sets `hiddenAt` (soft); unhide clears it.
- Hard delete (the owner archiving the view itself) sets `view.archivedAt`,
  which cascades to invisibility for everyone via the `views()` query
  filter.

### Built-in views are **not** seeded as rows

We layer built-ins client-side. Reasons:
- Built-ins are universal and version with the app — seeding them in DB
  produces stale rows on schema change.
- Built-ins must survive workspace creation / new-agent join with zero
  DB writes.
- A built-in can't be archived; encoding that in the DB needs an extra
  column. Layering them client-side avoids the column.

A built-in is a static `BuiltinView` constant with `id: 'builtin:all'`,
`builtin:unassigned`, `builtin:mine`, `builtin:resolved`. The
`view_member` table accepts these IDs as opaque strings (we add a
non-FK string column `viewIDStr` for the membership table — see T-4002
for the exact compromise; the cleanest approach is a separate
`builtin_view_member` table keyed by `(userID, builtinKey)`).

---

## 6. The query DSL

Shared types in `packages/zero-schema/src/views.ts` (next to existing
schema/query files) — the original plan put these in `packages/core` but
opendesk has no `packages/core` yet, and `zero-schema` is the natural
home because the `applyFilterToQuery` helper consumes Zero builders.

```ts
export type FilterField =
  | 'status' | 'priority' | 'channel' | 'mailbox'
  | 'assignee' | 'tag' | 'customer' | 'customerPlan'
  | 'createdAt' | 'updatedAt'
  | 'firstResponseDueAt' | 'firstResponseAt' | 'resolvedAt'
  | 'lastReplyBy'                          // 'customer' | 'agent' | 'none'
  | `customField:${string}`;

export type FilterOperator =
  | 'eq' | 'neq'
  | 'in' | 'nin'                            // multi-value
  | 'includesAny' | 'includesAll' | 'includesNone'   // many-to-many (tags)
  | 'contains' | 'ncontains'
  | 'before' | 'after' | 'between'
  | 'inLast' | 'notInLast'                  // relative dates: { unit, n }
  | 'empty' | 'nempty';

export type Filter =
  | { field: FilterField; operator: 'eq' | 'neq'; value: string | number | boolean }
  | { field: FilterField; operator: 'in' | 'nin' | 'includesAny' | 'includesAll' | 'includesNone'; values: (string | number)[] }
  | { field: FilterField; operator: 'contains' | 'ncontains'; value: string }
  | { field: FilterField; operator: 'before' | 'after'; value: string /* ISO */ }
  | { field: FilterField; operator: 'between'; values: [string, string] }
  | { field: FilterField; operator: 'inLast' | 'notInLast'; value: { unit: 'minute' | 'hour' | 'day' | 'week'; n: number } }
  | { field: FilterField; operator: 'empty' | 'nempty' };

export type ViewQuery = {
  filters: Filter[];
  search?: string;          // free-text, hits FTS endpoint (Phase 30)
  matchAll?: boolean;       // default true; false = OR across filters
};

export type ViewSort = {
  field: 'updatedAt' | 'createdAt' | 'priority'
       | 'firstResponseDueAt' | 'shortID'
       | `customField:${string}`;
  direction: 'asc' | 'desc';
};

export type GroupByAxis =
  | 'assignee' | 'priority' | 'status' | 'channel' | 'mailbox' | 'tag'
  | `customField:${string}` | null;

export type DisplayProps = {
  show: ('customer' | 'channel' | 'tags' | 'priority' | 'sla' | 'updatedAt' | 'shortID')[];
};
```

Discriminated-union on `Filter` is intentional — each operator has a
specific value shape, and the type system catches mismatches at the call
site rather than runtime. Server-side we revalidate with a Zod schema
that mirrors this exactly.

---

## 7. Zero queries

### `views()` and `viewByID()`

```ts
// packages/zero-schema/src/queries.ts
views: defineQuery(emptyArg, ({ ctx: auth }) =>
  applyWorkspaceScope(builder.view, auth)
    .where('archivedAt', 'IS', null)
    .where('kind', '=', 'inbox')
    .where(({ or, cmp, exists, AUTH }) =>
      or(
        // workspace-scoped views the agent hasn't hidden
        and(
          cmp('scope', '=', 'workspace'),
          exists('members', m =>
            m.where('userID', '=', AUTH.sub).where('hiddenAt', 'IS', null)
          ),
        ),
        // personal views the agent owns
        and(cmp('scope', '=', 'personal'), cmp('ownerID', '=', AUTH.sub)),
      )
    )
    .related('members', m => m.where('userID', '=', AUTH.sub))
    .orderBy('createdAt', 'asc')   // stable; per-agent position applied client-side
    .orderBy('id', 'asc')          // PK tiebreaker (audit M2)
    .limit(VIEW_LIST_LIMIT),       // 200; audit C5

viewByID: defineQuery(idArg, ({ args: { id }, ctx: auth }) =>
  applyWorkspaceScope(builder.view, auth)
    .where('id', '=', id)
    .related('members', m => m.where('userID', '=', AUTH.sub))
    .one(),
),
```

The `position` from the related `members` row is what the client uses to
sort the tab strip. Sorting by `position asc, createdAt asc, id asc`
client-side keeps the Zero query stable and lets us reorder without
invalidating the view list.

### `ticketsForView({ viewID, viewQuery })` — the dynamic builder

This is the pattern straight from zbugs (`shared/queries.ts:358-449`).
Imperative `.where()` composition over a single base query:

```ts
// packages/zero-schema/src/queries.ts
ticketsForView: defineQuery(
  ticketsForViewArg,
  ({ args: { viewQuery, limit }, ctx: auth }) => {
    let q = applyTicketRead(builder.ticket, auth)
      .related('customer')
      .related('assignee')
      .related('tags', tt => tt
        .related('tag', t => t.related('group'))
        .orderBy('addedAt', 'desc').orderBy('tagID', 'asc'))
      .related('customFieldValues', cv => cv.related('field'));

    const matchAll = viewQuery.matchAll ?? true;
    const apply = (qq: typeof q) => {
      // Each filter contributes either a chain of .where() (AND mode) or
      // a single combined where(or(...)) (OR mode). See applyFilterToQuery.
      return matchAll
        ? viewQuery.filters.reduce((acc, f) => applyFilterToQuery(acc, f), qq)
        : qq.where(({ or, ...helpers }) =>
            or(...viewQuery.filters.map(f => filterPredicate(f, helpers))));
    };

    return apply(q)
      .orderBy(...viewSortToOrderBy(viewQuery.sort))
      .orderBy('id', 'asc')                  // PK tiebreaker (audit M2)
      .limit(Math.min(limit ?? INBOX_INITIAL_PAGE, MAX_INBOX_LIMIT));
  },
),
```

`applyFilterToQuery` is a switch on `(field, operator)` that translates
each filter into the right Zero clause. Each branch is unit-testable in
isolation; the whole helper has 100% case coverage for the operator
matrix in §6.

Free-text `search` is **not** applied here — see T-4006 for the FTS
intersection pattern.

---

## 8. Mutators

`packages/mutators/src/view-mutators.ts`:

```ts
view: {
  create: defineMutator(viewCreateArgs, async ({ tx, args, ctx: auth }) => {
    assertIsAgent(auth);
    const id = args.id ?? randomUUID();
    await tx.mutate.view.insert({
      id,
      workspaceID: auth.workspaceID,
      ownerID: auth.sub,
      kind: 'inbox',
      scope: args.scope,
      label: args.label,
      query: args.query,
      sort: args.sort ?? DEFAULT_SORT,
      groupBy: args.groupBy ?? null,
      displayProps: args.displayProps ?? DEFAULT_DISPLAY_PROPS,
      icon: args.icon, color: args.color, description: args.description,
    });
    // Owner gets a member row at position 0 (front of their tab strip).
    await tx.mutate.viewMember.insert({
      viewID: id, userID: auth.sub, workspaceID: auth.workspaceID,
      position: 0,
    });
    audit('view.created', { viewID: id, scope: args.scope });
  }),

  update: defineMutator(viewUpdateArgs, async ({ tx, args, ctx: auth }) => {
    // Security check before existence check (zbugs pattern).
    await assertIsOwnerOrWorkspaceAdmin(tx, auth, builder.view, args.id);
    await tx.mutate.view.update(args);
    audit('view.updated', { viewID: args.id });
  }),

  archive: defineMutator(idArg, async ({ tx, args, ctx: auth }) => {
    await assertIsOwnerOrWorkspaceAdmin(tx, auth, builder.view, args.id);
    await tx.mutate.view.update({ id: args.id, archivedAt: new Date() });
    audit('view.archived', { viewID: args.id });
  }),

  reorder: defineMutator(reorderArgs, async ({ tx, args, ctx: auth }) => {
    // accepts { orderedIDs: string[] } — only the dragged subset
    for (const [i, viewID] of args.orderedIDs.entries()) {
      await tx.mutate.viewMember.upsert({
        viewID, userID: auth.sub, workspaceID: auth.workspaceID,
        position: i,
      });
    }
  }),

  hide: defineMutator(idArg, async ({ tx, args, ctx: auth }) => {
    // soft-delete for *this* agent only
    await tx.mutate.viewMember.update({
      viewID: args.id, userID: auth.sub,
      hiddenAt: new Date(),
    });
  }),

  unhide: defineMutator(idArg, async ({ tx, args, ctx: auth }) => {
    await tx.mutate.viewMember.update({
      viewID: args.id, userID: auth.sub,
      hiddenAt: null,
    });
  }),

  duplicate: defineMutator(duplicateArgs, async ({ tx, args, ctx: auth }) => {
    // Server reads source view, creates new with " (copy)" suffix.
    // Owner = caller; scope = personal by default (forking workspace
    // views into personal is a common pattern from Linear).
  }),
}
```

Server validation is done with a Zod schema that mirrors `ViewQuery` /
`ViewSort` — explicit `viewQueryZ` schema in `view-mutators.ts`,
applied to args before `tx.mutate.view.insert`. Bad shapes throw
`MutationError` with a generic message (zbugs pattern — no info leakage
about which field was wrong on a private view).

---

## 9. URL state contract

The structural search params:

| param      | role                                                                      |
| ---------- | ------------------------------------------------------------------------- |
| `view`     | active view ID — UUID for custom, `builtin:<key>` for built-ins           |
| `q`        | free-text search (debounced 200ms before URL update)                      |
| `f.<n>`    | live filter overrides — see encoding below                                |
| `group`    | live group-by override                                                    |
| `sort`     | live sort override (`field:direction`, e.g. `priority:desc`)              |

The transient ones inherited from the existing inbox route
(`routes.ts:121`): `action`, `fullDetail`. These get dropped on back-nav.

We add `view`, `q`, `f.*`, `group`, `sort` as **structural** params that
survive nav. The `routes.ts` change is one line: extend the inbox route
with no transient additions, leaving these as default-persistent.

### Filter encoding in URL

Compact JSON-base64 in a single `f` param, **not** scattered query keys.
zbugs uses scattered keys (`?label=bug&label=docs&open=true`) because its
filter set is fixed; ours has 12+ fields and 11 operators. Scattered
keys produce unparseable URL sprawl. Format:

```
f=eyJzdGF0dXMiOnsib3AiOiJpbiIsInZhbHVlcyI6WyJvcGVuIl19fQ==
// decoded: { "status": { "op": "in", "values": ["open"] } }
```

Helper `encodeFilters / decodeFilters` lives in
`apps/web/src/lib/inbox/url.ts`. URL length ceiling: 2048 chars, with
overflow forcing the agent to save as a view (which is the right
forcing function).

### Drift detection

Drift = `decodeFilters(urlFilters) ≠ savedView.query.filters`, OR
`urlSort ≠ savedView.sort`, OR `urlGroup ≠ savedView.groupBy`.

Display props (the `show` array) **do not** count as drift. They live in
`localStorage` under `inbox.view.display:{userID}:{viewID}` and never
hit the URL.

When drift is non-empty, the filter bar shows the drift banner from
§11.5.

---

## 10. Counts strategy

zbugs's pragmatic answer is "don't show per-filter live counts". We
soften that:

1. **Active view**: count from the materialized query's `.length` (cheap
   — already loaded). Refreshes live as tickets enter/leave the view.
2. **Inactive views in the strip**: count is the *Atlas pattern*:
   loaded lazily by a sidecar query `viewCounts()` that runs once on
   inbox mount and then on a 30s tick *plus* on any `ticket.assign /
   status / tag` mutation broadcast. The query returns
   `{ viewID: number }` for the agent's visible views.
3. **No N parallel materializations.** The original plan listed this as
   "option A start client-side." Don't. Even at 10 views it's 10 open
   subscriptions for badges nobody is staring at. Always use the sidecar.

The sidecar is a Zero query, not a REST endpoint, so it inherits cache +
auth + sync semantics:

```ts
viewCounts: defineQuery(emptyArg, ({ ctx: auth }) =>
  applyWorkspaceScope(builder.ticket, auth)
    // The trick: server-side aggregation isn't first-class in Zero yet.
    // Until it is, we run N separate count queries in parallel client-side
    // but only request `id` (no related fields), so each subscription is cheap.
    // Drop down to a custom RPC endpoint if profiling shows pain.
)
```

Open question — Zero aggregation: the official zbugs app doesn't use
aggregation queries because they don't exist in Zero v1. As of 2026-05
this is still the case; reassess at implementation time. If aggregation
lands, switch the sidecar to a single aggregate query. Meanwhile we cap
visible-views at 20 in the strip and budget 20 lightweight subscriptions
as acceptable.

---

## 11. UI surfaces

### 11.1 `<InboxViewStrip>` — replaces the hardcoded 4-button strip

Path: `apps/web/src/components/inbox/inbox-view-strip.tsx`

Reads from a merged list: built-ins (constant) + `views()` (Zero) sorted
by per-agent `position`. Renders horizontally-scrollable tab pills. Each
pill: optional icon + label + count badge (subdued for inactive).
Right-edge `[+]` opens the save-view modal pre-filled with the current
URL filters/sort/group.

Interaction:
- Click → `navigate('/app/inbox?view=<id>')` (preserves any active
  drift filters by deliberately *resetting* them — switching views
  always starts from the saved baseline; this is what Linear does).
- Drag → `view.reorder` mutator. Built-ins are draggable among
  themselves but cannot interleave with custom — visual divider between
  the two groups.
- Right-click → context menu (§11.6).
- Cmd-click → opens the *target ticket detail* in a new workbench
  tab; not relevant here, but called out so we don't accidentally fork
  the inbox tab.

Workbench tab title sync: a `useEffect` in `inbox-list.tsx` calls
`setActiveTabTitle(workspaceID, view.label, view.icon, 'inbox',
'/app/inbox?view=<id>')` whenever the active view changes. The
`forRouteId='inbox'` and `expectedHref` guards avoid the stale-effect
race documented in `frontend.md` §43 and audit H8.

### 11.2 `<InboxFilterBar>` — chip filters + display options + drift

Path: `apps/web/src/components/inbox/inbox-filter-bar.tsx`

Top row: filter chips, `+ Filter`, `q` search input.
Bottom row: `Group: <axis>`, `Sort: <axis>`, drift banner if any.

Each chip is a `Popover` with three segments:

```
┌─────────────────────────────────────┐
│ Status   is   open · in_progress  ✕ │
└─────────────────────────────────────┘
   ↑       ↑    ↑
   field  op   value
```

Clicking the field segment opens the field picker (typeahead over
`FilterField`). Clicking the op segment opens an op picker (filtered to
the field's valid ops). Clicking the value segment opens the value
editor (per-type: multi-select for status/priority/channel; combobox for
assignee/tag; date picker with operator-aware UI for date fields; text
input for `customField:KEY` text fields). The X removes the chip.

This in-place mutability is the Linear pattern and it's the single
detail that makes the difference between "clunky filter UI" and "feels
like Linear." Don't compromise on it.

### 11.3 `<DisplayOptionsPopover>` — `Shift+V`

Path: `apps/web/src/components/inbox/display-options-popover.tsx`

Three sections:

1. **Group by** — radio: None, Assignee, Status, Priority, Channel,
   Mailbox, Tag, then any active `customField:*` of an enum/multi-select
   type.
2. **Sort by** — radio (axis) + toggle (asc/desc). `firstResponseDueAt
   asc` is the support default.
3. **Display properties** — checkboxes for the columns from
   `DisplayProps.show`.

Layout is fixed to "list" — no UI control for it in v1. (Reserved space
in the popover for Phase 41+ board.)

Actions footer: `Set as default for this view` (writes to `view.update`,
clearing personal display override) and `Reset` (clears localStorage
display override).

### 11.4 Group-by renderer

Path: `apps/web/src/components/inbox/inbox-grouped-list.tsx`

When `view.groupBy` (or URL override) is non-null:
- Partition the materialized rows into groups *client-side*. The Zero
  query stays flat; we don't multiplex into N subscriptions.
- Section headers are virtualizer rows of a different fixed height
  (`SECTION_HEADER_HEIGHT = 32`, `INBOX_ROW_HEIGHT = 44` already exists).
  `@tanstack/react-virtual` supports mixed-size via `estimateSize` with
  per-index overrides; use that.
- Headers: axis label + count + collapse caret. Sticky on scroll.
- Collapse state in `localStorage` keyed by
  `inbox.view.collapse:{userID}:{viewID}:{axisValue}`.
- "Show empty groups" toggle in display popover; default *off*
  (different from Linear's default-on for status — empty support
  groups are usually noise).
- **Multi-membership** (a ticket with three tags grouped by tag):
  ticket appears in every tag's group. Row keys are
  `${ticketID}:${groupValue}` to avoid React key collisions and make
  `j/k` navigation through duplicated rows behave correctly (each
  duplicate is a distinct row from the agent's perspective).
- Axis renderers in a small registry:
  - `assignee` → groups keyed by assignee ID, headed with name +
    avatar + `Unassigned` group always last.
  - `priority` → 4 fixed groups, hard-ordered Urgent → Low.
  - `status` → enum groups, hard-ordered Open → In progress → Snoozed
    → Resolved → Closed.
  - `tag` → one group per tag; `Untagged` group always last.
  - `customField:KEY` → groups by value or `(no value)`.

### 11.5 Drift banner

Single horizontal strip below the filter bar, only when drift detected:

```
┌─────────────────────────────────────────────────────────────┐
│ Filters changed.  [Save changes]  [Save as new]  [Reset]    │
└─────────────────────────────────────────────────────────────┘
```

- `Save changes` — writes URL state back to the view via `view.update`.
  Disabled for built-ins (built-ins can't be edited structurally).
- `Save as new` — opens save modal pre-filled with the URL state and
  the auto-suggested name.
- `Reset` — clears the URL filter/sort/group params back to the saved
  view's baseline.

For built-ins the `Save changes` button is hidden entirely (not just
disabled — it's never available, so don't tease it).

### 11.6 Tab context menu

Right-click on a tab pill:

| action          | built-in              | own personal       | own workspace       | other's workspace   |
| --------------- | --------------------- | ------------------ | ------------------- | ------------------- |
| Edit            | hidden                | shown              | shown               | hidden              |
| Duplicate       | shown (→ personal)    | shown              | shown               | shown (→ personal)  |
| Archive         | hidden                | shown              | shown (admin only)  | hidden              |
| Hide for me     | hidden                | hidden             | hidden              | shown               |
| Copy view URL   | shown                 | shown              | shown               | shown               |

"Hide for me" calls `view.hide` (Atlas pattern §5.2).

### 11.7 Save view modal

Path: `apps/web/src/components/inbox/save-view-modal.tsx`

Fields:
- **Label** (required, prefilled with auto-suggestion derived from
  active filters — e.g. `Open · Tag: VIP`).
- **Description** (optional).
- **Icon** (lucide picker; defaults to a `Filter` icon, or a
  field-specific icon if filters are unambiguous — e.g. `Tag` if the
  only filter is a tag chip).
- **Color** (six-token tailwind picker).
- **Scope** (radio: Workspace / Personal). Default Personal — Atlas's
  workspace default proved noisy; Linear defaults personal too.
- The current URL filters / sort / group / displayProps are carried
  over silently; the modal doesn't re-show them. (Optional "Show
  filters" disclosure if the agent wants to confirm.)

On save:
- `view.create` mutator
- Navigate to `/app/inbox?view=<newID>` (filters drop because
  saving means "the URL state is now the saved baseline")
- Fire toast: `"View '<label>' saved"` with `Undo` action that
  archives.

### 11.8 Cmd+K integration (Phase 30 extension)

In `apps/web/src/lib/commands/catalog.ts`, register:

- `view.open.<id>` — one command per visible view, dynamically
  registered when `views()` query result changes. Group: "Views". Icon:
  the view's icon. Keyword: the view's label (so typing "vip" filters
  to the VIP view). Run: `ctx.navigateHref('/app/inbox?view=<id>')`.
- `view.next` / `view.prev` — `[` / `]` shortcuts when scope is
  `inbox`.
- `view.save_current` — `Alt+V` shortcut, opens save modal.
- `view.toggle_display_options` — `Shift+V`, opens display popover.
- `view.add_filter` — `F`, opens filter chip picker focused on field.
- `view.clear_last_filter` — `Shift+F`.
- `view.clear_all_filters` — `Alt+Shift+F`.
- `view.toggle_group_collapse` — `T` (when the focused row is a
  group header).
- `nav.builtin.<key>` — `G I` (Inbox/All), `G U` Unassigned,
  `G M` Mine, `G S` Snoozed/Resolved chord. Reuses the existing chord
  dispatcher from Phase 30.

Dynamic registration uses the registry's `setRouteCommands('inbox', [...])`
hook so the command list is rebuilt only when the route is active.

---

## 12. Tickets

The plan splits into 12 tickets. T-4001 → T-4003 are the foundation;
T-4004 → T-4008 are the core UX surfaces; T-4009 → T-4012 are the
polish + integration tickets.

### T-4001 — View schema + Zero mirror + DSL types

**Plan:**
- Drizzle migration: `view`, `view_member` tables per §5.
- Zero schema mirror in `packages/zero-schema/src/schema.ts`.
- Shared types in `packages/zero-schema/src/views.ts`.
- `applyFilterToQuery` helper with full operator coverage from §6.
- Zod schema `viewQueryZ` mirroring `ViewQuery`, for mutator validation.

**Acceptance:**
- Migration applies clean (forward + rollback).
- `applyFilterToQuery` unit tests cover every `(field, operator)` pair in
  the matrix — at least 80 cases.
- `viewQueryZ.parse(JSON.stringify(viewQuery))` round-trips.

**Deps:** Phase 10 (tags + custom fields), audit C5 (`.limit()`
discipline), audit M2 (PK tiebreaker discipline).

---

### T-4002 — `views()`, `viewByID()`, `viewCounts()` queries +
`view.*` mutators

**Plan:**
- Zero queries per §7.
- Mutators per §8.
- Built-in `view_member` rows: lazy upsert in mutators when an agent
  reorders/hides a built-in. Built-in IDs stored as string literal
  `'builtin:all'` etc. — add `viewIDStr` text column to `view_member`
  alternative *or* a parallel `builtin_view_member` table. Decision in
  this ticket; default to parallel table for clean FK semantics.
- Audit events: `view.created`, `view.updated`, `view.archived`,
  `view.reordered`, `view.hidden`, `view.duplicated`.

**Acceptance:**
- Create / update / archive / reorder / hide / duplicate all live
  across two browser windows.
- Personal-scope view invisible to other agents.
- Hidden workspace view invisible to the hider, visible to others.
- Invalid `query` shape rejected server-side with generic `MutationError`.

**Deps:** T-4001.

---

### T-4003 — `<InboxViewStrip>` (replaces hardcoded 4-button strip)

**Plan:**
- New component at `apps/web/src/components/inbox/inbox-view-strip.tsx`.
- Built-ins constant in `apps/web/src/lib/inbox/builtin-views.ts` —
  `builtin:all`, `builtin:unassigned`, `builtin:mine`, `builtin:resolved`.
- Reads from `views()` Zero query + built-ins constant + per-agent
  `position` from related `members[0]`.
- Renders pill tabs with icon + label + count badge.
- URL: `/app/inbox?view=<id>` via TanStack Router's `useNavigate`.
- Drag-reorder via `@dnd-kit/sortable` (already a dep — used in
  workbench tab strip).
- Workbench tab title sync via `setActiveTabTitle` with route + href
  guards.
- Wire into `apps/web/src/routes/app/inbox.tsx`, replacing the existing
  4-button strip in `inbox-list.tsx`.
- Focus rings: `focus-visible:ring-*` on every interactive element
  (audit H3 lesson — Phase 30 missed this).

**Acceptance:**
- All 4 built-ins still navigable + URL-shareable.
- Adding a custom view appears as a new pill without page reload.
- Reorder persists across reload + across windows.
- Tab title updates when view changes; never stomps a different
  workbench tab (manually verify by opening Customers tab in parallel
  and switching views in the inbox tab).

**Deps:** T-4002, audit H8 (`expectedHref` guard).

---

### T-4004 — `<InboxFilterBar>` (chip filters + display chip)

**Plan:**
- New component `apps/web/src/components/inbox/inbox-filter-bar.tsx`.
- Reads/writes URL search params (encoder/decoder in
  `apps/web/src/lib/inbox/url.ts`).
- Chip popover with three editable segments per §11.2.
- Field picker = typeahead over `FilterField`, grouped by category
  (`Conversation`, `Customer`, `Time`, `Custom fields`).
- Operator picker filtered to the field's valid operators.
- Value editors per type (multi-select / combobox / date picker /
  text).
- For built-ins: chip edits are allowed; tooltip on the implicit
  "Save as new" prompt explains "Built-in views can't be edited
  structurally; save your changes as a new view."
- `q` search input debounced 200ms.

**Acceptance:**
- Every operator from §6 round-trips via URL: change a chip, copy
  URL, paste in incognito, see the same filtered list.
- Removing the last chip falls back to the saved view's baseline
  filters (not "no filters").
- Filter bar height stable across chip count (chips wrap to next line,
  list area resizes accordingly).
- Each chip segment fully keyboard-navigable; focus rings visible.

**Deps:** T-4003.

---

### T-4005 — Inbox query refactor (use `ticketsForView`)

**Plan:**
- Refactor `inbox-list.tsx` to subscribe to `ticketsForView({ viewID,
  viewQuery })` instead of `inboxOpen({ limit })`.
- Built-in `ViewQuery`s live in `apps/web/src/lib/inbox/builtin-views.ts`:
  - `builtin:all`: `{ filters: [{ field: 'status', operator: 'in', values: ['open','in_progress','snoozed'] }] }`
  - `builtin:unassigned`: `{ filters: [..., { field: 'assignee', operator: 'empty' }] }`
  - `builtin:mine`: `{ filters: [..., { field: 'assignee', operator: 'eq', value: '$ME' }] }` — the `$ME` token resolved client-side to `auth.sub`.
  - `builtin:resolved`: `{ filters: [{ field: 'status', operator: 'in', values: ['resolved','closed'] }] }`
- Active view's `viewQuery` is the saved query merged with URL
  overrides (`mergeViewQuery(savedQuery, urlFilters, urlSort, urlGroup)`).
- Growing-window pagination preserved (`INBOX_INITIAL_PAGE`,
  `INBOX_PAGE_GROWTH`); only the query body changes.
- Delete the now-orphaned `inboxOpen` query and
  the dead `MAX_INBOX_LIMIT` preload in `timeline-feed.tsx:148`
  (audit H4 fix).

**Acceptance:**
- All 4 built-in views return identical results to the previous
  hardcoded filter logic. (Run with the existing inbox dataset and
  diff visible IDs.)
- Custom view filters narrow correctly.
- `j/k` row nav, bulk selection, scroll restore all unchanged.
- `inboxOpen` query removed; no callers remain.

**Deps:** T-4001, T-4004.

---

### T-4006 — Free-text search inside views

**Plan:**
- View `query.search` (or URL `q`) triggers a `/api/search?q&types=ticket`
  call (the FTS endpoint from Phase 30 T-3005).
- Result IDs become the candidate set; intersect with `ticketsForView`
  via `applyTicketRead(builder.ticket).where('id', 'IN', ids)`.
- Debounce 200ms; abortable via `AbortController` keyed on the
  search input.
- Empty `q` → standard view query path (no FTS).
- Show inline spinner inside the `q` input while a request is
  in-flight; never block the list.

**Acceptance:**
- Searching "billing" inside the Unassigned view returns only
  unassigned tickets matching the term.
- Live updates as new tickets arrive matching both criteria.
- Slow search (artificial 2s delay) shows spinner; UI remains
  interactive (can scroll, can change filters).
- Aborting an in-flight search by typing again does not flicker
  results.

**Deps:** Phase 30 T-3005, T-4005.

---

### T-4007 — `<DisplayOptionsPopover>` (`Shift+V`)

**Plan:**
- New component `apps/web/src/components/inbox/display-options-popover.tsx`.
- Three sections per §11.3.
- Trigger: a "Display" button in the filter bar + `Shift+V` hotkey
  via Phase 30 registry.
- Group + Sort write URL params (`group`, `sort`).
- Display properties write `localStorage` key
  `inbox.view.display:{userID}:{viewID}` (personal preference, never
  drift).
- "Set as default for this view" writes to `view.update` and clears
  the localStorage override.
- "Reset" clears the localStorage override.

**Acceptance:**
- Toggling group axis re-sections the list correctly without
  re-running the Zero query (partition is client-side).
- Sort change updates the URL and re-orders rows live.
- Display properties persist across reload; clearing localStorage
  reverts to view default.

**Deps:** T-4005.

---

### T-4008 — Group-by renderer

**Plan:**
- Refactor virtualizer in `inbox-list.tsx` to handle mixed-size rows
  (section headers + ticket rows) via per-index `estimateSize`
  override.
- Partition function: `partitionByAxis(rows, axis, axisRegistry)`.
- Headers render axis-specific UI (avatar for assignee, color dot for
  priority, etc.).
- Sticky headers via the virtualizer's
  [`useStickyHeader`](https://tanstack.com/virtual/latest) helper
  (already pulled in via `@tanstack/react-virtual`).
- Collapse state per §11.4.
- Multi-membership row keys per §11.4.

**Acceptance:**
- Toggling groupBy from null → priority sections the list correctly
  with sticky headers and collapse arrows.
- Empty groups appear when "Show empty groups" is on; hidden when
  off.
- Multi-tag membership: clicking the same ticket from two groups
  navigates correctly (no key collision; both rows highlight when
  the ticket is selected).
- Performance: 1k tickets across 8 groups renders <16ms per scroll
  frame (Chrome perf trace).

**Deps:** T-4005, T-4007.

---

### T-4009 — Save-current-view modal + auto-naming + drift banner

**Plan:**
- New component `apps/web/src/components/inbox/save-view-modal.tsx`.
- Auto-name function `suggestViewName(viewQuery, mode)` —
  pure, unit-tested. Examples:
  - `[status: in (open)]` → `"Open"`
  - `[status: in (open), tag: includesAny [vip]]` → `"Open · Tag: VIP"`
  - `[assignee: empty]` → `"Unassigned"`
  - `[customer.plan: eq 'enterprise', updatedAt: inLast {unit:'day',n:7}]`
    → `"Enterprise · Last 7 days"`
- `view.create` on submit; navigate to the new view; show toast with
  Undo action.
- Drift banner per §11.5 in `inbox-filter-bar.tsx`.

**Acceptance:**
- Save with empty label rejected (form-level validation).
- Created view appears as the next pill in the strip (per-agent
  `position` set to current max + 1 within the agent's strip).
- Auto-suggestion regenerates as filters change in the modal (if user
  hasn't manually edited the label field).
- Drift banner appears within 100ms of any URL filter change.
- `Reset` clears all overrides; `Save changes` writes them; `Save as
  new` opens the modal with prefilled state.

**Deps:** T-4002, T-4003, T-4004.

---

### T-4010 — Tab context menu (edit / duplicate / archive / hide /
copy URL)

**Plan:**
- Right-click on a pill → context menu with the matrix from §11.6.
- Edit → opens save modal in edit mode (same component, pre-filled,
  calls `view.update` instead of `view.create`).
- Duplicate → `view.duplicate` mutator; resulting view becomes
  personal-scoped to the caller, suffix `(copy)`.
- Archive → confirmation modal (`copy-guide.md` §3 verdict-style;
  not `window.confirm` — audit H1 lesson) → `view.archive`.
- Hide for me → `view.hide`.
- Copy view URL → `navigator.clipboard.writeText(window.location.href)`
  with toast.

**Acceptance:**
- All five actions live across two windows.
- Hidden workspace view disappears from caller's strip; still visible
  to other agents.
- Archived view disappears for everyone; data preserved (visible in
  `/app/settings/views/archived` — deferred to Phase 50, but data
  must already be queryable).
- Built-ins show only Duplicate + Copy URL (per matrix).

**Deps:** T-4009.

---

### T-4011 — Cmd+K integration + hotkeys

**Plan:**
- Register all view-related commands in
  `apps/web/src/lib/commands/catalog.ts` per §11.8.
- Dynamic per-view `view.open.<id>` commands registered in a
  `useEffect` that subscribes to `views()` and calls
  `setRouteCommands('inbox', [...])`.
- Hotkeys via Phase 30 registry: `F`, `Shift+F`, `Alt+Shift+F`,
  `Shift+V`, `Alt+V`, `T`, `[`, `]`, `G I`, `G U`, `G M`, `G S`.
- Hotkey scope: most are `inbox`-scoped; `G *` chords are
  `app`-scoped (work from any inbox sub-route).

**Acceptance:**
- Cmd+K → typing a view name jumps to it.
- `Alt+V` opens save modal pre-filled.
- `Shift+V` opens display options.
- `F` opens filter chip picker.
- `[` / `]` cycles through views in the strip's order.
- Single-letter hotkeys never fire while typing in chip-value inputs
  or `q` search input (Phase 30 contract).

**Deps:** Phase 30, T-4003, T-4007, T-4009.

---

### T-4012 — `viewCounts` sidecar + badge wiring

**Plan:**
- `viewCounts` Zero query per §10.
- One `useQuery` subscription in `<InboxViewStrip>`, results joined
  to the strip's pills.
- 30s tick: a `setInterval` triggers a Zero materialize-on-demand
  refresh (Zero's standard pattern; not a polling REST call).
- Mutation broadcast: `ticket.assign / status / tag` mutators emit
  a Zero event the strip subscribes to, invalidating the count
  subscription.
- Profiling pass: simulate 20 visible views with 5k tickets each;
  verify <50ms incremental render on mutation.
- If profiling fails: switch to a sidecar REST endpoint
  `GET /api/views/counts` returning `{ viewID: count }` from a single
  SQL aggregate query, refreshed every 30s + on broadcast.

**Acceptance:**
- Each pill shows accurate live count (manually verify with one
  status change in another window — count drops within 1s).
- Strip with 20 visible views renders <16ms per scroll frame.
- No memory leak: navigate away and back to the inbox; subscription
  count stable.

**Deps:** T-4005.

---

## 13. Definition of done for Phase 40

- Built-in tabs reimplemented through the view system; behavior
  unchanged from the original 4-button strip (verified by visual
  diff + ID-set diff on a fixture workspace).
- Custom view full lifecycle works end-to-end: create → filter →
  group-by → save → reorder → hide → archive → restore.
- Workspace + personal scope respected; hide-for-me works; per-agent
  ordering works.
- URL is canonical: copy URL → paste in incognito (logged in as same
  agent) → identical filtered view.
- Drift banner appears reliably; built-ins never offer "Save changes."
- Per-view counts live and accurate within 1s of mutation.
- Cmd+K + all view hotkeys (`F / Shift+V / Alt+V / G I / [ / ]`)
  functional across all inbox sub-routes.
- Workbench tab title + icon mirror the active view (no stale-title
  race; verified with two parallel tabs).
- Type-check + Biome clean.
- Audit-style review pass: every new query has `.limit()` and PK
  tiebreaker; every interactive element has `focus-visible:ring-*`;
  no `useEffect` for derived state; no `window.confirm`.
- Design review on: pill strip, filter chips, display popover, save
  modal, drift banner, grouped list with sticky headers.

---

## 14. Out of scope (Phase 41+ candidates)

- **Subscribe to a view → Slack/email digest** (Linear's killer
  power feature; depends on Phase 70 notifications).
- **Sub-grouping (swimlanes)** (board layout dependency).
- **Board (kanban) layout** for the inbox.
- **Manual row ordering** (`Grouping = None` + drag-to-order rows;
  needs per-row position state).
- **View sharing with explicit user list** (Atlas's `users[]` model;
  v1 is workspace-or-personal only).
- **Recursive saved-search composition** (Atlas's `__saved__`).
- **Favorites rail above the workbench tab strip.**
- **Default landing page** (per-agent setting that opens `<favorite
  view>` when navigating to `/app/inbox` cold).
- **Archived views browser** at `/app/settings/views/archived`
  (data is already there; just needs the UI).
- **Hover-quick-filter** in the conversation detail rail
  ("filter list to this tag").
- **Peek (`Space`)** preserving list focus — needs a lightweight
  detail overlay; cross-cuts with Phase 80 inbox row polish.
- **AI filter input** — natural-language filter synthesis (Linear
  recently shipped this).
