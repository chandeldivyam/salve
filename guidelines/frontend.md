# Frontend Guidelines

> The standard the opendesk web app holds itself to. Read it once, refer back often. When this file disagrees with code already in the repo, update the code — not the guidelines.

The goal is a help desk that feels engineered to a degree most teams skip. Two reference points:

- **Linear** for craft, density, keyboard-first interaction, and the feeling of speed. Required reading: [Building Linear](https://linear.app/blog/building-linear), [Scaling the Linear Sync Engine](https://linear.app/blog/scaling-the-linear-sync-engine), [Brand as customer experience](https://linear.app/blog/brand-as-customer-experience), [The Linear Method](https://linear.app/method).
- **zbugs** (`/tmp/zero-mono/apps/zbugs`) for how to write Zero correctly. It is the canonical reference; when in doubt, copy zbugs.

The thread connecting both: **engineering quality is what makes design quality stick.** Linear's polish is downstream of their sync engine; you cannot bolt Linear-grade UX onto a slow, racey, optimistic-mutation-less app. Zero is our equivalent of that engine — treat it like one.

---

## Table of contents

1. [Philosophy & quality bar](#1-philosophy--quality-bar)
2. [Repository layout](#2-repository-layout)
3. [Writing Zero: schema, queries, mutators](#3-writing-zero-schema-queries-mutators)
4. [State & data flow](#4-state--data-flow)
5. [Routing & layouts](#5-routing--layouts)
6. [Component architecture](#6-component-architecture)
7. [Styling, tokens, dark mode](#7-styling-tokens-dark-mode)
8. [Typography, spacing, density](#8-typography-spacing-density)
9. [Keyboard-first interaction](#9-keyboard-first-interaction)
10. [The command palette (Cmd+K)](#10-the-command-palette-cmdk)
11. [List + detail (master-detail)](#11-list--detail-master-detail)
12. [Forms & validation](#12-forms--validation)
13. [Toasts, dialogs, modals](#13-toasts-dialogs-modals)
14. [Animation & latency](#14-animation--latency)
15. [Accessibility](#15-accessibility)
16. [Performance guardrails](#16-performance-guardrails)
17. [Testing](#17-testing)
18. [Anti-patterns](#18-anti-patterns)
19. [Reading list & libraries](#19-reading-list--libraries)

---

## 1. Philosophy & quality bar

Five rules sit above everything else. If a PR violates one of them, it fails review even if everything else is correct.

1. **Speed is the feature.** Every user-initiated action shows visible feedback in < 100 ms and resolves in < 300 ms on a fast network. We do this with optimistic mutations, prefetch-on-hover, and Zero's local cache — never with spinners.
2. **Keyboard-first, mouse-optional.** Every primary action has a shortcut. Power users should be able to triage 100 tickets without touching the mouse. The shortcut is shown in the button's tooltip; the global cheatsheet is `?`.
3. **Restraint over decoration.** No gradients in chrome. No shadows on flat surfaces. No animation without purpose. Color carries meaning (status, priority, severity); decoration carries none.
4. **Density without crowding.** Lists are tabular, not cards. Body text is 13 px, metadata 12 px, labels 11 px. We squeeze information density up to the limit of legibility and stop there.
5. **The brand IS the experience.** The 404 page, the empty inbox, the error toast, the loading skeleton — these *are* opendesk. They are not chores to delegate to a default. They get the same craft as the inbox itself.

Practical translation:

- If a feature requires a spinner for the common case, it is too slow.
- If a feature requires a modal for the common case, the IA is wrong.
- If a feature lacks a keyboard shortcut, it is unfinished.

---

## 2. Repository layout

The web app is a Vite + React + TanStack Router SPA. The relevant trees:

```
apps/web/src/
  routes/                  TanStack Router file-based routes
    __root.tsx             Top-level providers + route shell
    app.tsx                Auth gate + ZeroProvider wrap
    app/
      inbox.tsx            Inbox layout (list + outlet)
      inbox.t.$ticketId.tsx
      settings.tsx         Settings layout (sidebar + outlet)
      settings.tags.tsx
      ...
  components/
    inbox-list.tsx
    composer.tsx
    feedback-toasts.tsx
    conversation/          Feature-grouped subcomponents
  lib/
    zero.ts                Zero client init
    theme.ts               Theme store (system/light/dark)
    feedback.ts            Toast store
    session-loader.ts
    auth-client.ts
  styles.css               Tailwind v4 entry, design tokens

packages/
  ui/                      shadcn/Radix-flavoured primitives
  zero-schema/             Zero schema + queries + AuthData
  mutators/                Shared client/server mutators + auth helpers
  db/                      Drizzle schema + migrations
```

### Folder rules

- **Co-locate by feature, not by type.** As a folder grows past ~6 files, split it into a feature subfolder (e.g. `components/conversation/` for the metadata block UI). Don't keep adding to a flat `components/` until it has 30 files. Same applies to `routes/app/` once a domain has 3+ routes.
- **`lib/` is for *cross-cutting* utilities** (theme, feedback, session). Anything domain-specific (e.g. `support-metadata.ts`) is on the wrong floor — move it under the feature it serves.
- **`packages/ui/` is for *domain-agnostic* primitives only.** A `<Button>` belongs there. A `<TicketStatusBadge>` does not — that is opendesk-specific and lives in `apps/web/src/components/`.
- **One responsibility per route file.** When a route file passes ~300 lines (`inbox.t.$ticketId.tsx` is currently ~870 — the canonical bad example), split immediately into header / thread / sidebar / composer subcomponents.

### File naming

- Routes: `kebab-case.tsx`, with TanStack's `$` prefix for params (`inbox.t.$ticketId.tsx`).
- Components: `kebab-case.tsx`, default-exporting nothing — always named exports. One component per file unless they're tightly coupled (a `<Foo>` and an internal `<FooRow>` may share a file; a `<Foo>` and unrelated `<Empty>` may not).
- Hooks: `use-*.ts`, named export.
- Utilities: descriptive lowercase, no `*.utils.ts` suffix.

---

## 3. Writing Zero: schema, queries, mutators

zbugs is the source of truth. When opendesk diverges, the divergence must have a written reason.

### 3.1 Schema

- All schema definitions live in `packages/zero-schema/src/schema.ts`. Tables are imported from the Drizzle schema and re-described for Zero with `.from('snake_case')` mapping.
- Define relationships explicitly with `sourceField` / `destField`. Junction tables (many-to-many) use the two-stage form, as in zbugs `shared/schema.ts:141-194`. Don't fake many-to-many with array columns.
- Composite primary keys: `.primaryKey('userID', 'ticketID')`. Use them for `viewState`-style tables (per-user-per-row state).
- Enums are `enumeration<'open' | 'closed' | ...>()` — never raw strings. The string union flows through the type system to mutators and UI.
- `AuthData` is a single typed shape (`{ sub: string; workspaceID: string; role: Role | null }`). It's set from the JWT on the server and from the session cookie on the client.

### 3.2 Queries

The single most important rule:

> **Every workspace-scoped query MUST go through `applyWorkspaceScope`** (`packages/zero-schema/src/queries.ts:65`). A missing `.where('workspaceID', ...)` is a cross-tenant data leak. The helper makes that mistake structurally impossible.

This is the opendesk equivalent of zbugs's `applyIssuePermissions` (zbugs `queries.ts:16-23`). The pattern:

```ts
export const queries = defineQueries({
  inboxOpen: defineQuery(emptyArg, ({ ctx: auth }) =>
    applyTicketRead(
      builder.ticket.where(({ cmp, or }) =>
        or(cmp('status', '=', 'open'), cmp('status', '=', 'in_progress'), cmp('status', '=', 'snoozed')),
      ),
      auth,
    )
      .related('customer')
      .related('assignee')
      .related('tags', (tt) =>
        tt.related('tag', (t) => t.related('group')).orderBy('addedAt', 'desc').orderBy('tagID', 'asc'),
      )
      .orderBy('updatedAt', 'desc')
      .orderBy('id', 'desc'),
  ),
});
```

Inside a query function:

- **Always validate args with Zod.** `z.object({ id: z.string() })` is one line, costs nothing, and catches typos at runtime.
- **Use `alwaysFalse(q)` for the unauthenticated short-circuit**, never a sentinel comparison like `.where('id', '=', '__nope__')`. `alwaysFalse` ANDs in `or()` with no arguments and is type-preserving (`packages/zero-schema/src/queries.ts:48-54`).
- **Chain `.related()` to preload nested data.** Order matters: put `.orderBy(...)` and `.limit(...)` *inside* the related callback when they apply to the related rows (e.g. last 10 messages in `ticketByID`).
- **PK tiebreakers in every `.orderBy()` chain.** `orderBy('updatedAt', 'desc').orderBy('id', 'desc')` — without the second key, equal timestamps produce non-deterministic ordering and break j/k navigation. Already standard in `queries.ts`; do not skip it for "obvious" sort keys.
- **Use `.whereExists()` for filtering on relationships**, not joins. Existence checks handle nullable relations and don't blow up the result set.
- **Use `escapeLike()` for text search.** `cmp('title', 'ILIKE', `%${escapeLike(text)}%`)` (zbugs `queries.ts:404-414`). Never interpolate raw user input into a LIKE pattern.

Caching:

- Cache policies live in **`apps/web/src/lib/zero-cache.ts`**. Three constants, one job each:
  - `CACHE_FOREVER = { ttl: '10m' }` — top-of-funnel data we always want hot (inbox, members, addresses, tags, custom fields). 10m is the Zero `MAX_TTL` (`packages/zql/src/query/ttl.ts:25`).
  - `CACHE_NAV = { ttl: '5m' }` — the Zero default. Per-route data the user might come back to within minutes (ticket detail, settings tabs).
  - `CACHE_NONE = { ttl: 'none' }` — never; reserved for truly throwaway queries.
- **Every `useQuery` call MUST pass one of these as the second argument.** `useQuery(queries.X())` with no options is a code-review blocker — see §18.
- **Preload at the app shell.** `apps/web/src/lib/zero-preload.ts` exports `preloadWorkspace(z)` which calls `z.preload(...)` for the inbox + workspace metadata. It is invoked once from `routes/app.tsx`'s `<WorkspacePreloader />` (mounted inside `<ZeroProvider>`) so the queries stay subscribed for the lifetime of the session — not just while the inbox is on screen. zbugs does the same in `src/zero-preload.ts` and triggers it from `list-page.tsx:242` / `issue-page.tsx:113` on `complete`.
- **Result: hard reload never flashes a loading state.** The previous mount's TTL keeps IDB warm; the next mount hydrates synchronously. The `<InboxListSkeleton />` exists for *first-ever* mounts and slow networks, not as the default render path.

Typed result rows:

- Always export a `<Name>Row` type next to the query, derived with `QueryResultType<typeof queries.X>` (see `queries.ts:367-424`). Never re-declare row shapes in components — it goes stale the moment the query changes.

### 3.2.1 Render from cache, never gate on `status.type`

The single most expensive UX bug we've shipped to date: gating the inbox render on `status?.type !== 'unknown'`. Every reload flashed "Loading inbox…" — even when IDB had the rows ready — because the gate ignored the data and waited for the server to confirm completeness.

**The rule:** treat `useQuery`'s return tuple as `[data, status]`, and render from `data` whenever it's non-empty. `status` is for analytics, conditional preload, and disambiguating *truly empty* (server confirmed) from *not yet hydrated*. It is **not** an "are we ready to render" gate.

zbugs `pages/issue/issue-page.tsx:113-119` is the model:

```tsx
const [issue, issueResult] = useQuery(queries.issueDetail({ idField, id }), CACHE_NAV);

useEffect(() => {
  if (issueResult.type === 'complete') {
    recordPageLoad('issue-page');     // analytics — fires once
    preload(z, projectName);          // warm next-page data
  }
}, [issueResult.type]);

return <IssueView issue={issue} />;   // renders immediately from cache
```

Applied to opendesk:

```tsx
// inbox-list.tsx
const [tickets, status] = useQuery(queries.inboxOpen({ limit }), CACHE_FOREVER);
const ready = status?.type === 'complete';

// Render order:
//  1. tickets present → render the list (covers IDB cache + live data).
//  2. server confirmed empty + matching filter → empty state.
//  3. server has not confirmed yet → skeleton at the row shape.
{filtered.length === 0 && !ready ? <InboxListSkeleton />
  : filtered.length === 0       ? <EmptyInbox … />
  : <VirtualList … />}
```

For `.one()` queries (e.g. `ticketByID`), the same pattern means: **don't show "not found" until `status.type === 'complete'`.** Until then, show a skeleton.

```tsx
const [ticket, ticketStatus] = useQuery(queries.ticketByID({ id }), CACHE_NAV);

if (!ticket) {
  if (ticketStatus?.type !== 'complete') return <TicketDetailSkeleton />;
  return <NotFoundCard />;
}
```

The previous code claimed "Ticket not found" on every reload because it didn't make this distinction. Don't repeat that.

### 3.3 Mutators

zbugs reference: `/tmp/zero-mono/apps/zbugs/shared/mutators.ts`. Patterns to copy verbatim:

1. **Auth before existence.** Every mutation starts with `assertHasWorkspace(auth)` (and any further role check). *Then* it reads the row. Reversing this leaks the existence of private resources via timing/error messages.

   ```ts
   update: defineMutator(updateTicketArgsSchema, async ({ tx, args, ctx: auth }) => {
     await assertCanModifyTicket(tx, auth, args.id); // auth first
     const old = await tx.run(builder.ticket.where('id', args.id).one()); // safe to read
     if (!old) throw new MutationError('Ticket not found', MutationErrorCode.NOT_FOUND, args.id);
     // ...
   });
   ```

2. **Validate all args with a shared Zod schema.** The same schema runs on client (optimistic) and server. Co-locate the schema with the mutator (`packages/mutators/src/index.ts:32-39`).

3. **Server mutators wrap client mutators.** Server-only side-effects (notifications, audit events, webhooks) live in `apps/api/src/server-mutators.ts` and call the client mutator's `.fn()` first, then run their own logic. Same pattern as zbugs `server-mutators.ts:25-80`. Never re-implement a mutation server-side; you'll diverge.

4. **Side-effects colocated with the trigger.** In zbugs, `issueNotifications` upserts live inside `issue.create`, `comment.add`, `emoji.addToIssue` (lines 90-96, 234-239, 374-379). Same here: when a ticket is created, the audit event is emitted *inside* `ticket.create`, not in a watcher.

5. **Typed error codes, not generic Errors.** `MutationError` with `MutationErrorCode.NOT_AUTHORIZED | NOT_FOUND | CROSS_WORKSPACE | …`. The UI maps codes to user-facing copy; the server logs all of them.

6. **Generic messages on auth-sensitive failures.** `"Ticket not found or not authorized"` — never `"You don't have permission to edit ticket abc-123"`, which confirms the ticket exists.

7. **`nanoid()` / `crypto.randomUUID()` for IDs from the client.** Mutations are optimistic; the row needs an ID before the server has seen it.

### 3.3.1 List queries are bounded; pagination is a window, not a page

> **No unbounded list query.** Every list query that can grow with workspace size MUST take a `limit` argument with a sensible default. The default for opendesk is **200**, the ceiling **2000**.

`inboxOpen` (`packages/zero-schema/src/queries.ts`) is the canonical example:

```ts
const inboxOpenArg = z
  .object({ limit: z.number().int().min(1).max(2000).optional() })
  .optional();

inboxOpen: defineQuery(inboxOpenArg, ({ args, ctx: auth }) => {
  const limit = Math.min(args?.limit ?? DEFAULT_INBOX_LIMIT, MAX_INBOX_LIMIT);
  return applyTicketRead(builder.ticket.where(...), auth)
    .related('customer').related('assignee').related('tags', ...)
    .orderBy('updatedAt', 'desc')
    .orderBy('id', 'desc')
    .limit(limit);
});
```

The list view grows the limit on demand:

```ts
const [pageLimit, setPageLimit] = useState(INITIAL_PAGE);
const [tickets, status] = useQuery(queries.inboxOpen({ limit: pageLimit }), CACHE_FOREVER);

// When the virtualizer reports the last visible row is within 16 of the
// end, grow the window. Capped at PAGE_CEILING. Most workspaces never
// hit this.
useEffect(() => {
  if (!ready || tickets.length < pageLimit || pageLimit >= PAGE_CEILING) return;
  if (filtered.length - lastVirtualIndex <= LOAD_MORE_THRESHOLD) {
    setPageLimit((p) => Math.min(PAGE_CEILING, p + PAGE_GROWTH));
  }
}, [...]);
```

This is a **growing window** not cursor pagination. It's simpler than zbugs's `issueListV2` (`shared/queries.ts`, `start`/`dir`/`limit`) and Zero handles the de-dup of the expanded result set efficiently. Migrate to a true cursor (`{ id, updatedAt }` start key, `dir: 'forward' | 'backward'`) only when the workspace ceiling forces it (i.e. p99 list size > 2000).

### 3.4 Permissions are queries, not annotations

Zero has no declarative permission system. Our mitigation is `applyWorkspaceScope` + `applyTicketRead` + future `applyTicketModify`. The pattern:

- `applyWorkspaceScope` enforces tenancy (workspace = workspace).
- `applyTicketRead` layers visibility (open to me / assigned to me / in my team).
- `applyTicketModify` (Phase 4) layers role (creator OR assignee OR admin).

Every query and mutation routes through one of these helpers. Direct `.where('workspaceID', ...)` calls outside the helpers are forbidden.

---

## 4. State & data flow

There are exactly four kinds of state. Pick the right one.

| Kind | Where | Tool |
|---|---|---|
| Server state (rows) | Authoritative in Postgres, mirrored locally | **Zero** via `useQuery` |
| URL state (selection, filter, pagination cursor) | URL | TanStack Router params + search |
| Cross-component UI state (theme, current selection set, drawer open) | Memory, persisted optionally | `useSyncExternalStore` store, or **Jotai** atoms once we exceed 3 stores |
| Local UI state (input value, hover) | Component | `useState` |

Rules:

- **Never mirror Zero data into `useState`.** If you find yourself doing `const [tickets, setTickets] = useState(); useEffect(() => {...})`, you are reinventing Zero badly. Derive with `useMemo` instead.
- **URL is the source of truth for selection.** `selectedTicketID` is read from `params.ticketId`, never stored in state. `j/k` navigates the URL via `router.navigate({ replace: true })`. Back button just works. (See `inbox-list.tsx:107-112` for the right pattern.)
- **`useSyncExternalStore` is the default for global UI state.** It is SSR-safe, lightweight, has zero deps. We use it for `theme.ts` and `feedback.ts` already. Only reach for **Jotai** when fine-grained reactivity matters (e.g. multi-select state that should rerender just the affected rows).
- **Don't put high-churn state in React Context.** Every consumer rerenders on every change. Theme is fine in Context (changes ~once per session); the focused row index is not.
- **`useEffect` is for syncing with external systems.** Not for derived state. If it's derivable from props/state, use `useMemo` or compute inline. Cite: [You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect).

### Mutations

```tsx
const z = useZero();
await z.mutate(mutators.ticket.close({ id: ticket.id }));
```

- Always optimistic. Zero applies the mutation locally before the server acks.
- On error, Zero rolls back; surface a toast (`showError`) — don't swallow.
- For undo-able destructive actions, pair the mutation with a toast that has an Undo action (see §13).

### Reading auth on the client

- `useZero()` for the Zero client.
- Session data (user id, workspace id, role) is read from the auth store, not from Zero. The Zero client is initialized inside `routes/app.tsx` only after the session is known — anonymous users never open a WebSocket. Preserve this gate.

---

## 5. Routing & layouts

We use **TanStack Router** with file-based routes.

### Conventions

- Auth-gated routes are nested under `routes/app.tsx`. That route's `beforeLoad` checks the session and redirects unauthenticated users. Below that, `<ZeroProvider>` is mounted lazily — anonymous users never connect.
- Every domain gets its own *layout* file. `inbox.tsx` (the parent of `inbox.t.$ticketId.tsx`) renders the list pane and an `<Outlet />` for the detail. Don't repeat layouts inside leaf routes.
- Nested routes use the dot notation: `settings.tags.tsx` is a child of `settings.tsx`.
- Dynamic params are `$ticketId`, not `[ticketId]` or `:ticketId` — match TanStack's syntax.

### Pending / error / not-found

- Every route hierarchy provides all three. Configured at the router level in `main.tsx`, then overridden per-route as needed.
- Inline error boundaries around mutation surfaces (the composer, the detail pane). A failed message send must not blow up the whole route.
- Don't show a global "Loading…" — show a layout-shape skeleton (see §14).

### Navigation

- `<Link to="/app/inbox/t/$ticketId" params={{ ticketId: id }}>` — never `href`, never `<a>` for internal nav.
- Programmatic: `const navigate = useNavigate(); navigate({ to, params, search, replace })`.
- `replace: true` for j/k traversal so the back stack isn't polluted with every keystroke.
- Prefetch on hover. TanStack Router supports this with `preload="intent"` on `<Link>`. Combined with Zero's local cache, the detail pane is already populated by the time the click lands.

### Layouts to extract (TODO in current code)

Right now, `routes/app/settings.tsx` and `routes/app/inbox.t.$ticketId.tsx` each implement a two-pane layout independently. Extract a `<SplitLayout left={…} right={…} resizable />` component in `apps/web/src/components/layouts/` so future list+detail screens (customers, automations) inherit the same chrome and resize behaviour. Use [`react-resizable-panels`](https://github.com/bvaughn/react-resizable-panels) for the resize handle.

---

## 6. Component architecture

### Headless first

- Use **Radix Primitives** for: `Dialog`, `Popover`, `DropdownMenu`, `Tooltip`, `Select`, `Tabs`, `Toast`, `ContextMenu`, `Slot`. They handle focus management, ARIA, keyboard, and portal correctly. Do not reimplement these.
- For comboboxes / search menus / command palettes, use **cmdk** (`<Command>` from `@/components/ui/command`).
- Style Radix primitives with Tailwind in `packages/ui/src/`. The pattern is the shadcn one: copy the source into our package, modify freely, never `npm i shadcn-ui` as a runtime dep.

### Compound components

Compose, don't prop-explode. A dialog is:

```tsx
<Dialog.Root open={open} onOpenChange={setOpen}>
  <Dialog.Trigger asChild><Button>Edit</Button></Dialog.Trigger>
  <Dialog.Content>
    <Dialog.Title>Edit ticket</Dialog.Title>
    <TicketForm onSaved={() => setOpen(false)} />
  </Dialog.Content>
</Dialog.Root>
```

Not `<Dialog open trigger={…} title="Edit ticket" body={<TicketForm />} />`. The compound form is the Radix idiom; it composes, slots arbitrary content, and never exposes "we forgot to pass `aria-describedby`" footguns.

### `forwardRef` + `cn()` everywhere

Every primitive in `packages/ui/` forwards refs and merges classNames via `cn()` (clsx + tailwind-merge). Already enforced; keep it. Without `forwardRef`, Radix's `Trigger asChild` breaks. Without `cn`, callers can't override classes idempotently.

### Variants via `class-variance-authority`

```ts
const button = cva('inline-flex items-center justify-center …', {
  variants: {
    variant: { default: '…', outline: '…', ghost: '…', destructive: '…' },
    size:    { sm: 'h-8 px-2 text-xs', md: 'h-9 px-3 text-sm', lg: 'h-10 px-4' },
  },
  defaultVariants: { variant: 'default', size: 'md' },
});
```

CVA centralizes variants and produces a typed `ButtonProps` automatically. Don't ship variants as ad-hoc `className` lookups.

### Domain components live with the app, not in `ui/`

`<TicketStatusBadge>`, `<AssigneePicker>`, `<TagPill>` belong in `apps/web/src/components/`. They depend on `mutators` / `queries` / `AuthData` and are not reusable outside opendesk. Keep `packages/ui/` shape-agnostic.

### Component size budget

- < 100 lines: ideal.
- 100–250 lines: fine if it is a single coherent unit.
- 250–400 lines: extract sub-components.
- > 400 lines: stop, split before the next PR. The current `inbox.t.$ticketId.tsx` (~870 lines) violates this and is the next refactor target. Split into `<TicketHeader>`, `<TicketThread>`, `<TicketSidebar>`, `<TicketComposer>`.

### Avoid prop drilling

Three layers, in order of preference:

1. **Composition / render props.** `<TicketRow>{({ticket}) => <RowActions ticket={ticket} />}</TicketRow>` beats threading 4 props.
2. **Stores** (Jotai or `useSyncExternalStore`) for genuinely shared state.
3. **Context** only for stable values (theme, current org).

Never reach for context to avoid a 2-level prop pass.

---

## 7. Styling, tokens, dark mode

We use **Tailwind v4** with semantic CSS variables defined in `apps/web/src/styles.css`. The setup is good. Do not regress it.

### The tokens that exist (and the only colors you may use)

Defined at `:root` (light) and `.dark` (dark) in `styles.css:11-113`, then exposed through `@theme inline { … }` so Tailwind generates utilities like `bg-surface`, `text-muted-foreground`, `border-brand-border`.

| Surface | Text | Border | Status |
|---|---|---|---|
| `background` | `foreground` | `border` | `success` / `success-soft` / `success-foreground` |
| `surface` | `surface-foreground` | `border-strong` | `warning` / `warning-soft` |
| `surface-muted` | `surface-muted-foreground` | `input` | `danger` / `danger-soft` / `danger-hover` |
| `muted` | `muted-foreground` | `ring` | |
| `popover` | `popover-foreground` | | |
| `tooltip` | `tooltip-foreground` | | |
| Brand | `brand` / `brand-50…900` / `brand-soft` / `brand-soft-foreground` / `brand-border` | | |

Rules:

- **Never use Tailwind palette colors directly** (`bg-gray-500`, `text-blue-600`, `border-zinc-300`). They bypass tokens, break dark mode, and make future redesigns 100x harder.
- **Never hardcode hex** in components. Even in inline styles for charts — read from `getComputedStyle(document.documentElement).getPropertyValue('--brand-600')`.
- **Add tokens, don't add colors.** Need a tertiary text shade? Add `--text-tertiary` to both `:root` and `.dark`, expose via `@theme inline`, then use `text-text-tertiary`. The token is the API.
- **Status colors are only for status.** Don't use `--success` for "completed" buttons that aren't a status. Treat them as semantic, not visual.

### OKLCH

We're already on OKLCH (`oklch(L C H)`). Keep it. OKLCH is perceptually uniform — a 0.05 lightness change *looks* like the same step at any hue, unlike HSL. Reference: [OKLCH in CSS](https://evilmartians.com/chronicles/oklch-in-css-why-quit-rgb-hsl).

When adding a new shade, pick `L` (lightness) and `C` (chroma) from the existing scale. Don't introduce new chromas without a design reason.

### Dark mode

`lib/theme.ts` is bulletproof. Three modes (system / light / dark), persisted under `salve.theme`, applied **before** React hydrates by calling `applyTheme()` in `main.tsx`. Without that pre-paint, the page would flash light then snap to dark. Don't break this.

When designing components:

- Test in both modes for every PR. Take a screenshot in dark mode at minimum.
- Borders in dark mode are opacity-driven (`oklch(0.34 0.024 230)`), not gray colors. Surfaces lift via lightness, not shadow.
- Status colors *vibrate* at high chroma in dark mode. Drop chroma slightly (`0.13 → 0.11`) — already done in `styles.css:95-112`.
- Pure black is wrong. Our background is `oklch(0.16 …)`, not `#000`. Pure black causes halation against white text.

### When you find yourself needing `style={{ … }}`

Almost never the answer. Tailwind covers 99% of styling. Inline `style` is acceptable only for:

- Dynamic CSS variables (`style={{ '--row-height': `${h}px` }}`).
- Virtualizer translation (`transform: translateY(…)`) — there's no other way.
- Image-data URLs.

Static colors / sizes / spacing in `style` is a code-review blocker.

---

## 8. Typography, spacing, density

### Spacing

4px base grid. Allowed values: `0, 1 (4), 1.5 (6), 2 (8), 3 (12), 4 (16), 5 (20), 6 (24), 8 (32), 10 (40), 12 (48), 16 (64), 20 (80)`. Reject `7, 9, 11, 13, 15` in code review. `5/10` are allowed only because Tailwind makes them ergonomic; prefer `4/8/12`.

Component spacing rules:

- Button: `h-9 px-3 text-sm` (md), `h-8 px-2 text-xs` (sm). Inputs match button height.
- List row: `px-3 py-2`, target row height ~36px.
- Section gap inside a card: `gap-3` (12px). Between sections: `gap-6` (24px).
- Page chrome padding: `p-4` to `p-6`.

### Type scale

| Tailwind | px | Use |
|---|---|---|
| `text-[11px]` | 11 | Labels, kbd hints, breadcrumb |
| `text-xs`     | 12 | Metadata, timestamps, captions |
| `text-sm`     | 14 | (Avoid; pick 13 or 14 deliberately) |
| `text-[13px]` | 13 | **Body default** in dense surfaces |
| `text-[14px]` | 14 | Body in marketing/settings prose |
| `text-base`   | 16 | Section headings within a page |
| `text-lg`     | 18 | Subsection in long-form |
| `text-xl`     | 20 | Page titles |

Line height: 1.45 body, 1.2 headings.

Tabular figures everywhere a count or timestamp shows: `tabular-nums` (Tailwind class). Otherwise digits jump as values change.

### Font

`Inter Variable` is the default once we add it. Until then, `system-ui` (currently in `styles.css:170`). Add Inter via `@fontsource-variable/inter` and enable feature flags (single-story `a` and tabular figures): `font-feature-settings: 'cv11' 1, 'ss01' 1, 'tnum' 1;`. Apply at the body level.

### Density

Lists are tabular. Row height target 32–36 px. The current inbox row at 96 px (`inbox-list.tsx:118`) is too tall — we're showing customer name, title, snippet, time, priority, tags, assignee in one row, which requires that height. Either:

- Drop the snippet (Linear doesn't show one in the inbox), shrinking to ~52 px, OR
- Keep the snippet behind a hover/keyboard-toggle "expand row" state.

The principle: dense by default, expand on demand.

---

## 9. Keyboard-first interaction

Two registers of shortcut. Mixing them is a footgun.

### Modified shortcuts (Cmd/Ctrl + key)

Always-on, global. Reserved set:

| Combo | Action |
|---|---|
| Cmd+K | Open command palette |
| Cmd+/ | Open shortcut cheatsheet (also `?` when not in input) |
| Cmd+Enter | Submit form / send message |
| Cmd+Shift+M | Mark current ticket done |
| Cmd+Shift+, | Settings |
| Cmd+B | Toggle sidebar |
| Cmd+\\ | Toggle right rail |

Detect platform once: `const mod = isMac ? 'Meta' : 'Control'`. Surface `⌘K` on macOS, `Ctrl K` elsewhere — don't render `Meta`.

### Unmodified single keys (contextual)

Only fire when no input/textarea/contenteditable is focused. Pattern lifted directly from `inbox-list.tsx:125-163` and zbugs `use-keypress.ts`:

```ts
function shouldAllowShortcut(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el) return true;
  if (el.isContentEditable) return false;
  return !['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}
```

Reserved single-key set:

| Key | Action |
|---|---|
| `j` / `↓` | Next row |
| `k` / `↑` | Previous row |
| `Enter` | Open focused row |
| `Esc` | Close detail / clear search |
| `x` | Toggle select |
| `Shift+J/K` | Extend selection |
| `e` | Archive (currently `close`) |
| `s` | Snooze |
| `a` | Assign… (opens picker) |
| `p` | Priority… (opens picker) |
| `t` | Tag… |
| `r` | Reply (focus composer) |
| `c` | New ticket |
| `/` | Focus search |
| `?` | Cheatsheet |
| `g` then `i` | Go to inbox (sequence; 500 ms timeout) |
| `g` then `m` | Go to mine |
| `g` then `s` | Go to settings |

The `g`-prefix Vim-sequence pattern uses [`tinykeys`](https://github.com/jamiebuilds/tinykeys), which already supports `g i` syntax in 400 bytes.

### The `useShortcut` hook

`apps/web/src/lib/shortcuts.ts` exports `useShortcut(key, fn, options?)`. It centralises the "skip while typing" gate, accepts a single key or an array (`['j', 'ArrowDown']`), and exposes `isMod(e)` for ⌘/Ctrl-modifier checks (mac vs others).

```ts
import { useShortcut } from '@/lib/shortcuts';

useShortcut(['j', 'ArrowDown'], () => goToIndex(cur + 1));
useShortcut('Enter', () => openSelected());
useShortcut(['e', 'E'], () => archive());
```

**No raw `window.addEventListener('keydown', …)` in components.** Every binding goes through `useShortcut` so the input-focus gate is applied consistently and we have one place to add features (sequences, scopes) later.

### Discoverability

- Every button with a shortcut shows `<kbd>` in its tooltip: `Reply <kbd>R</kbd>`.
- The cheatsheet (`?`) groups shortcuts by section: Navigation / Selection / Triage / Editor.
- Cmd+K is the universal escape hatch — if you can't remember the shortcut, the palette has it.

### Don't override

- Cmd+W, Cmd+T, Cmd+L, Cmd+R, Cmd+Shift+T, Cmd+F (browser).
- Cmd+S only inside editor surfaces; outside, let the browser save.
- Tab / Shift+Tab — never preventDefault on these except inside trapped focus contexts (modals, popovers).

---

## 10. The command palette (Cmd+K)

This is the single highest-leverage feature we don't have yet. Build it next.

Library: **cmdk** by Paco Coursey ([cmdk.paco.me](https://cmdk.paco.me)). Used by Vercel, Linear (internal equivalent), Raycast (inspiration).

### Architecture

- **One global palette** opened via Cmd+K from anywhere. Mounted at the `__root.tsx` level inside a portal so depth-of-mount doesn't matter.
- **Pages**, not nested menus. cmdk's pattern: `pages` is a stack in state. Backspace pops back. Each "level" renders a different `<Command.List>`.

  ```tsx
  const [pages, setPages] = useState<string[]>(['root']);
  const page = pages[pages.length - 1] ?? 'root';
  ```

- **Scoped commands first.** Inside a ticket route, the palette shows ticket-scoped actions (Assign…, Set priority…, Snooze…) at the top, then global actions (New ticket, Switch workspace…, Go to settings…). Use `<Command.Group heading="Ticket">` and ordering.
- **Recent / suggested** is the first group when the query is empty — last 5 actions, plus context-aware (ticket open → likely actions).
- **Empty state with creation fallback.** Query "amelia" with zero matches → "No results for *amelia*. Create ticket *amelia*?" Linear ships this and it doubles as a global add.

### Commands taxonomy

A "command" is one of:

- **Navigate** — go to a route (`Inbox`, `Mine`, `Settings → Tags`, `Customer: Amelia Hart`).
- **Action** — mutate the current context (`Assign to…`, `Set priority → High`, `Snooze 1 day`, `Mark resolved`).
- **Create** — open a creation flow (`New ticket`, `New tag`, `New macro`).
- **Search** — full-text into tickets / customers / messages. Debounced; results stream in.

Each command has: `id`, `label`, `keywords[]` (for fuzzy), `shortcut?`, `group`, `icon`, `run(ctx)`.

### Keyboard contract

- Arrows navigate, Enter executes, Tab autocompletes the highlighted command name.
- Cmd+K toggles open/close. Esc closes (or pops a page if stacked).
- The palette never traps focus globally — Tab still cycles through visible inputs inside it.

### Visual

- Dialog-like overlay, but lighter than a real dialog: `oklch(L 0 0 / 0.5)` backdrop, `bg-popover` surface, 12px radius, 1px `border` ring.
- Width: 640px. Max height: 60vh. Scrollable list, sticky input.
- Each row: 36px tall, icon + label + keywords (de-emphasized) + right-aligned shortcut `<kbd>`.

### Building it

```tsx
// apps/web/src/components/command-palette.tsx
import { Command } from 'cmdk';
import { useShortcut } from '@/lib/shortcuts';

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  useShortcut('mod+k', () => setOpen((o) => !o));
  // ...
}
```

References:

- cmdk docs: https://cmdk.paco.me
- Vercel's: open https://vercel.com/dashboard and hit Cmd+K
- Raycast philosophy: https://www.raycast.com/blog

---

## 11. List + detail (master-detail)

Inbox is the canonical example. Customers, automations, and team views will follow the same shape.

### Layout

Three panes: **nav** (240px) | **list** (380–480px, resizable) | **detail** (flex). Resize handles via `react-resizable-panels`. Persist sizes in `localStorage`.

### URL is the source of truth

- The route is `/app/inbox/t/$ticketId`.
- The list reads `ticketId` from params and computes `selectedIndex` (`inbox-list.tsx:107-112`). Don't store selection in state.
- j/k → `navigate({ to, params, replace: true })`. Replace, not push, so the back stack doesn't fill with every keystroke.

### Virtual scrolling

- Use [TanStack Virtual](https://tanstack.com/virtual) when row count > 200 OR row count is unbounded. Below 200, plain rendering is faster (no measurement).
- Currently `inbox-list.tsx:115-120` virtualizes always. That's fine because the list is unbounded in principle.
- Keep `overscan` between 5 and 10. Higher hurts memory; lower flickers on fast scroll.
- Fixed row height when possible. Variable row heights need `measureElement`, which causes a measure pass per row — measurable cost above 1k rows.

### Multi-select

Selection set is *separate* from URL. Use a Jotai atom (or a dedicated `useSyncExternalStore` store) holding `Set<string>`.

- `x` toggles the focused row.
- `Shift+J/K` extends selection from the current focus.
- `Shift+click` extends from `lastClickedIndex` to the clicked row.
- `Cmd+A` selects all *visible* rows. Show "Select all 1,234" link in the bulk action bar to escalate.
- Clear on route change unless explicitly pinned.

The bulk action bar appears at the bottom of the list pane when selection is non-empty. Shows count, primary action (Assign / Snooze / Close / Tag), kebab for less-used actions.

### Inline edit vs detail edit

- **Inline** = single-field, single-action: status, priority, assignee, snooze. Triggered by hover-reveal icon or direct shortcut (`s`, `p`, `a` open pickers for the focused row).
- **Detail** = multi-field, narrative work: composing a reply, editing the subject, viewing the thread.
- Never make a user open a modal to change one enum value.

---

## 12. Forms & validation

Stack: **react-hook-form** + **zod** + `@hookform/resolvers/zod`.

The current settings forms (e.g. `settings.tags.tsx:67-77`) use ad-hoc `useState` + manual validation. Migrate to RHF as we touch them. New forms always use RHF.

### Schema lives once

```ts
// packages/mutators/src/index.ts (already)
export const createTagArgsSchema = z.object({
  groupId: z.string().nullable(),
  label: z.string().min(1).max(40),
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
});
export type CreateTagArgs = z.infer<typeof createTagArgsSchema>;
```

The same schema validates server-side mutations and client-side form input. Never duplicate.

### RHF setup

```tsx
const form = useForm<CreateTagArgs>({
  resolver: zodResolver(createTagArgsSchema),
  mode: 'onTouched',
  defaultValues: { groupId: null, label: '', color: '#06b6d4' },
});
```

`mode: 'onTouched'` — validate after first blur, then on every change. Avoids yelling on first keystroke.

### UX rules

- Field errors render below the input, `text-xs text-danger`. Don't shift layout — reserve a 16px slot.
- Form-level errors (network, server validation that doesn't map to a field) render in a `<Callout variant="destructive">` at the top of the form.
- **Don't disable the submit button on initial paint.** Disable only after first submission attempt to avoid the "why isn't this working" mystery for keyboard users.
- Pending submit: button text swaps to `"Saving…"` after a 200ms delay (no flicker on fast networks). Use `aria-busy` instead of `disabled` so Cmd+Enter remains idempotent.
- Cmd+Enter submits from anywhere in the form.
- On submit *error*, keep all input values. On submit *success*, the parent decides whether to reset.

### Inline edits

For "edit ticket subject in detail pane" patterns:

- No submit button. Save on blur and on Enter.
- Esc reverts to the last saved value.
- A small inline spinner during the optimistic + reconcile window. With Zero, the optimistic write is instant and the spinner is rarely visible.

---

## 13. Toasts, dialogs, modals

### Toasts

We have a custom `feedback.ts` store today and a `<FeedbackToasts>` renderer. Keep it for now — it works. When we want richer toasts (action button, promise pattern), migrate to **Sonner** ([sonner.emilkowal.ski](https://sonner.emilkowal.ski)).

Rules:

- Bottom-right corner, max 3 stacked.
- 4–6s auto-dismiss, paused while hovered AND only when the document has focus (mirror zbugs `toast-content.tsx:7-35`). Stale tab → toast waits.
- Success / error / loading / promise patterns. No "info" — if it's information, find a better surface than a toast.
- Every destructive optimistic action ships an Undo toast:

  ```tsx
  toast('Ticket archived', {
    action: { label: 'Undo', onClick: () => z.mutate(mutators.ticket.reopen({ id })) },
    duration: 6000,
  });
  ```

- `aria-live="polite"` (we already do this).

### Dialogs

Used **rarely**. Reserved for:

- Destructive AND irreversible actions (delete a workspace, revoke an API key).
- Onboarding / first-run flows.

Never used for:

- Creating or editing a record (use a side panel or dedicated route).
- Confirming a reversible action ("Are you sure you want to mark resolved?" — just resolve it, offer undo).

When you do use one:

- Title in second person ("Delete this workspace?"), explicit consequences, named confirm button ("Delete workspace"), Esc cancels.
- For high-stakes destruction, type-the-name pattern: user must type the workspace's slug to enable the delete button.

### Popovers vs sheets

- **Popover** for transient pickers (priority, assignee, tag autocomplete). Click-outside or Esc closes. No backdrop. Renders next to the trigger.
- **Sheet** (side drawer) for medium-complexity flows that don't deserve a route (filter builder, advanced settings panel). Use Radix Dialog with side variants.
- **Route** for everything else.

`Esc` always closes the topmost overlay. Click-outside closes popovers but NOT dialogs (require an explicit close).

---

## 14. Animation & latency

Linear's claim — "every interaction at the speed of thought" — is downstream of three habits:

### Latency budget

| Action | Visible feedback | Resolution |
|---|---|---|
| Click / key | < 50 ms | < 100 ms |
| Optimistic mutation | 0 ms (immediate) | < 300 ms server roundtrip |
| Route transition | 0 ms (cached) / < 100 ms (fetched) | < 300 ms |
| Search keystroke | < 16 ms | < 100 ms (filtered) / < 400 ms (server) |

If you can't hit these on a 4G connection, that screen needs design work, not a spinner.

### Loading states

In order of preference:

1. **Nothing**, because the data was prefetched and persisted in IDB. This is the default with Zero + our `CACHE_FOREVER` / `preloadWorkspace` setup — `useQuery` returns the cached value synchronously on the first frame after a hard reload.
2. **Skeleton** when the layout is known and only content is unknown. Use the components in `apps/web/src/components/skeletons.tsx` (`InboxListSkeleton`, `TicketDetailSkeleton`). They render at the *exact* dimensions of the real content — CLS budget = 0. Add new skeletons when you add new layouts; never reach for a centered spinner.
3. **Inline pending** for buttons: "Saving…" after a 200 ms delay. Never before — flickers on fast networks.
4. **Spinner** only when duration is unknown AND > 300 ms AND no skeleton is possible. Centered Lucide `<Loader2 className="animate-spin" />`.

The skeleton renders only on the truly first mount (no IDB cache yet). Once a query has been subscribed once with a TTL, subsequent navigations and reloads hit IDB synchronously and the skeleton path is bypassed entirely. If you ever see the skeleton flicker on a route the user has already visited, that's a bug — check that the `useQuery` has a TTL and that the query is in `preloadWorkspace`.

### Pre-React splash for the auth window

There is one window we cannot cover with skeletons or IDB: the time between the browser fetching the HTML and React mounting. On a hard reload, this is anywhere from 50ms (warm) to 800ms (cold) — long enough to see a white flash, then a route-pending state, then real content. Three transitions, three different visuals.

The fix is a single brand splash that paints from the very first frame and hides as soon as React has content. **Inline in `index.html`, not React.** This is the only place it lives:

```html
<div id="root"></div>
<style>
  #initial-splash { position: fixed; inset: 0; ... transition: opacity 220ms ease-out; }
  #root:not(:empty) ~ #initial-splash { opacity: 0; pointer-events: none; }
</style>
<div id="initial-splash">…leaf glyph + dots, inline SVG, inline animations…</div>
```

The inline splash uses raw `oklch(...)` colours (CSS variables aren't available before the stylesheet loads) and inline `@keyframes` (no Tailwind, no bundle dependency). It's visible from the very first paint and hides automatically the moment React paints anything into `#root`.

A `<BrandSplash>` React component exists at `apps/web/src/components/brand-splash.tsx` — visually identical — and is wired *only* on `routes/app.tsx`'s `pendingComponent`. It fires when the auth fetch in `beforeLoad` is genuinely slow (>200ms — the `defaultPendingMs` floor). With session caching (next bullet) this is rare.

**THE TRAP:** Setting `BrandSplash` as `defaultPendingComponent` makes it fire on every in-app route transition (clicking a ticket, switching tabs). That is wrong — in-app navigation must never full-screen splash. The default pending component is `RoutePendingFeedback` (small card); only the auth gate gets the splash.

**THE OTHER TRAP:** TanStack Router re-runs `beforeLoad` on every navigation that re-matches the route. Without caching, every internal click re-fetches `/api/auth/get-session`, and a slow fetch fires the auth-gate splash mid-app. **Cache the session at module level** (`apps/web/src/lib/session-loader.ts`):

```ts
let cachedSession: SessionData | null | undefined = undefined;
let inflight: Promise<SessionData | null> | null = null;

export async function fetchSession(): Promise<SessionData | null> {
  if (cachedSession !== undefined) return cachedSession;
  if (inflight) return inflight;
  inflight = fetchSessionUncached().then((s) => { cachedSession = s; inflight = null; return s; });
  return inflight;
}

export function clearSessionCache(): void { cachedSession = undefined; inflight = null; }
```

Sign-out calls `clearSessionCache()` so the next `/app` entry refetches and redirects if needed.

Rules:
- Inline splash in `index.html` and the `<BrandSplash>` component MUST stay visually identical. Shared animation timings live in `styles.css` (`@keyframes brand-splash-*`).
- `BrandSplash` is wired *only* at `routes/app.tsx` (auth gate). Never as `defaultPendingComponent`. Never on `__root.tsx`.
- The inline splash uses raw OKLCH colours that match `--background` / `--brand-600` in both light and dark mode.
- `prefers-reduced-motion` cancels the animation in both copies.
- Any new async work in `beforeLoad` must be cache-fast on warm calls. If you add an async hop and don't cache it, the auth-gate splash will start firing on every internal navigation — exact symptom of the trap above.

### Animations

- 150–200 ms `ease-out` for entry, 80–120 ms for exit.
- Only animate `transform` and `opacity`. They're GPU-composited. Animating `width`, `height`, `top`, `left` causes layout thrash — never on the hot path.
- Cross-fade detail-pane content swaps. Even when the new ticket renders instantly, a 60ms fade lets the brain register completion. Use `framer-motion` `<AnimatePresence mode="wait">`.
- `prefers-reduced-motion`: honour it. Wrap the duration in a hook that returns `0` when the user has set it.

```ts
export function useMotionDuration(ms: number) {
  const reduced = useReducedMotion();
  return reduced ? 0 : ms;
}
```

### Optimistic UI

- Every mutation is optimistic. The row state changes *before* the network ack.
- Rollback must be **visible**. On failure, Zero rolls back the local store; surface a `toast.error` with retry. Silent rollback is a lie to the user.
- Multi-step workflows (send email → update ticket status) apply each step optimistically; they reconcile in order.

---

## 15. Accessibility

Non-negotiable. The cost of doing it later is 10× the cost of doing it now.

### Floor

- Every interactive element is reachable by Tab and operable by keyboard. Test by unplugging your mouse for an hour every month.
- `:focus-visible` ring on every interactive element. Already standard via `focus-visible:ring-2 focus-visible:ring-ring`. Never `outline: none` without a replacement.
- Icon-only buttons get `aria-label`. Audit existing buttons; the inbox filter button at `inbox-list.tsx:213` already has it, the assignee avatar pattern at `inbox-list.tsx:440-446` is the model. Don't ship an icon-only button without a label.
- Color is never the only signal. Status dots (`inbox-list.tsx:384-396`) need text labels or icons too. Add a `<span class="sr-only">` if the visible text feels redundant.

### Focus management

- Modal opens → first focusable element. Modal closes → return focus to the trigger. Radix handles this for free.
- Route changes → focus the page's `<h1>` programmatically (`tabIndex={-1}` + `focus()`). Otherwise screen-reader users have no signal that the page changed.
- Popovers don't trap; dialogs do.

### ARIA live

- Toasts → `aria-live="polite"` (already wired in `feedback-toasts.tsx`).
- Async confirmations ("Ticket assigned to Alex") → `aria-live="polite"`.
- Errors → `aria-live="assertive"` only when truly urgent (form submit failed, message send failed). Don't blast every minor error.

### Custom widgets

- Use Radix or cmdk. Rolling your own listbox/combobox is how you ship six broken keyboard interactions.
- If you must, follow the [WAI-ARIA APG patterns](https://www.w3.org/WAI/ARIA/apg/patterns/) — they are exhaustive and correct.

### Contrast

- WCAG AA: 4.5:1 body, 3:1 large/UI. Test in dark mode separately. Tools: [WebAIM Contrast Checker](https://webaim.org/resources/contrastchecker), Stark Figma plugin.
- Our tokens already meet AA in both modes. New tokens must be checked.

### Reduced motion

CSS baseline plus per-component honour:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
}
```

---

## 16. Performance guardrails

### Rendering

- **Profile before memoizing.** `useMemo` and `React.memo` cost cycles. Add them only when the React Profiler shows a render > 5 ms or > 10/sec.
- **List rows: render-cost target < 1 ms each.** If higher, split off the action bar into a child rendered only on hover.
- **Don't create new object/array literals in hot rows.** `<Row data={{ id, name }} />` invalidates child memos every render. Hoist or `useMemo`.
- Once **React Compiler** ([react.dev/learn/react-compiler](https://react.dev/learn/react-compiler)) is stable, drop manual memos and rely on it. Until then, manual memoization on hot paths only.

### Bundle

- Lazy-load **routes**, not components. TanStack Router's `lazy()` per route — billing, reports, advanced settings should not ship in the inbox bundle.
- Inspect with `rollup-plugin-visualizer`. Budget: main JS < 250kb gz, route chunks < 100kb gz.
- Tree-shake Lucide imports — `import { Search } from 'lucide-react'` works (it's tree-shakeable). Avoid `react-icons` (poor tree-shaking).
- No moment.js (use date-fns). No lodash global import (per-function packages or native).

### CLS / layout

- CLS budget: 0.1 over a session. Skeletons MUST match final dimensions.
- All `<img>` tags get `width`, `height`, `loading="lazy"`, `decoding="async"`.
- Reserve space for content that might appear (error slot under inputs, badge slot in row).

### Input latency

- < 16 ms from event to first paint. Long tasks > 50 ms break this.
- For derived expensive views (filtering 5k items as user types), use [`useDeferredValue`](https://react.dev/reference/react/useDeferredValue) — keeps the input responsive even when the list is heavy.
- Throttle scroll handlers with `requestAnimationFrame`, never `setTimeout`.

### Zero query budgets

- A single `useQuery` should return < 1 MB of decoded JSON in steady state. If you're returning all 50k tags so the UI can filter client-side, that's wrong — paginate or scope server-side.
- Watch `.related()` chains. Each related is its own subscription; 6 levels deep means 6 sync streams. Above 4 levels, push the query up to a parent or split.

---

## 17. Testing

We are not chasing 90% coverage. We are chasing confidence on the things that *must not* break.

### Tiers

1. **Unit tests** for derivation and pure logic. The filter logic in `inbox-list.tsx:85-105` should be extracted to a pure function and tested with a table of `(tickets, filter, search) → expected`.
2. **Component tests** (Vitest + Testing Library) for tricky widgets: Combobox, CommandPalette, KeyboardSequence handler. Don't test markup; test behaviour.
3. **End-to-end** (Playwright) for the 5 must-never-break flows:
   - Login → see inbox with at least one ticket.
   - Open ticket → reply with text → message appears, status flips to in_progress.
   - Search "amelia" → narrow results, j/k still works.
   - Assign ticket via shortcut `a` → picker opens → first agent → toast confirms.
   - Mark resolved → row leaves inbox → undo restores.
4. **Visual regression** (Chromatic or Playwright snapshots) on the design system primitives in `packages/ui/`. Catches the "we changed `--brand-600` and didn't realize it cascaded" bugs.

### Test discipline

- Every PR that fixes a bug includes a test that fails without the fix. No exceptions for "trivial" bugs — those are how regressions sneak back.
- Don't test internals. Test what the user sees / does. If a test mocks more than 2 things, it's testing the wrong layer.
- Mock at the network boundary, not at the React component boundary.

---

## 18. Anti-patterns

If you do any of these, expect to be asked to undo them in code review.

1. **Spinners on every fetch.** Most fetches are < 200 ms; flashing a spinner makes things feel *slower*. Use skeletons or nothing.
2. **Modals for non-destructive actions.** "Are you sure you want to mark resolved?" → just resolve it; offer undo.
3. **Disabled submit buttons with no explanation.** Either show why (validation error nearby) or keep enabled and validate on click.
4. **`outline: none` without replacement.** Instant a11y violation.
5. **`text-gray-500` and friends.** Bypasses tokens. Use `text-muted-foreground`.
6. **Hex codes in components.** Use tokens or add a token.
7. **Toast for everything.** "Saved" toasts on autosave are noise. Inline "Saved" near the field is better.
8. **Icon-only buttons with no `aria-label`.** Screen readers announce "button". Always label.
9. **Mirror Zero data into `useState`.** You are reinventing Zero badly. Derive with `useMemo`.
10. **`useEffect` for derived state.** Use `useMemo` or compute inline. Effects sync with external systems only.
11. **Custom comboboxes / listboxes.** Use Radix or cmdk. You will get keyboard / ARIA / edge cases wrong.
12. **`Context` for high-frequency state.** Selection / focused row / hover state should be in stores, not context. Context rerenders the entire subtree.
13. **Modals stacked on modals.** Your IA is wrong; redesign the flow.
14. **Optimistic mutation with silent failure.** Every optimistic mutation reconciles failure with a visible toast and revert. No silent rollbacks.
15. **`text-overflow: ellipsis` with no escape.** If you truncate, the full value must be reachable — Tooltip on hover/focus, or click-to-expand.
16. **Loading "..." in place of layout.** Always render a skeleton at final dimensions. Layout shift is a quality tax.
17. **Treating dark mode as an afterthought.** Both modes from day one. Take a dark-mode screenshot for every PR with UI changes.
18. **Ad-hoc keyboard listeners on `window`.** Use `useShortcut`. Every raw `window.addEventListener('keydown', …)` outside that hook is technical debt.
19. **`.where('workspaceID', ...)` outside `applyWorkspaceScope`.** Code-review blocker. Cross-tenant leak waiting to happen.
20. **Mutations without `assertHasWorkspace`.** Code-review blocker. See §3.3.
21. **Direct interpolation into ILIKE patterns.** Always `escapeLike()`.
22. **Components > 400 lines.** Stop, split.
23. **Re-implementing a Radix/cmdk primitive because "ours is simpler".** It isn't. It's missing six edge cases.
24. **`as unknown as Foo` casts.** Almost always means a type definition is wrong upstream. Fix the schema, not the call site.
25. **Adding a new color outside the token system.** Add a token, then use it.
26. **`useQuery(queries.X())` without a TTL.** No second argument means no cache survival, which means a hard reload re-mounts cold and the UI flashes a loading state. Always pass `CACHE_FOREVER` / `CACHE_NAV` / `CACHE_NONE` from `lib/zero-cache.ts`. See §3.2.
27. **Gating UI on `status?.type !== 'unknown'`.** This was the source of opendesk's "Loading inbox…" flash. Render from `data` whenever it has rows; only treat `status.type === 'complete'` as "server has confirmed completeness" — useful for analytics, preload triggers, and disambiguating *truly empty* from *not yet hydrated*. Never the gate for whether to render. See §3.2.1.
28. **`!ticket` → "Not found" without checking status.** A `.one()` query returns `undefined` while hydrating, *and* when the row genuinely doesn't exist. Show "not found" only when `status.type === 'complete'`; otherwise show a skeleton.
29. **Unbounded list queries.** Every list that grows with workspace size needs a `limit` arg + window growth. `.orderBy(...).orderBy('id', 'desc')` *without* a `.limit()` is a code-review blocker. See §3.3.1.
30. **No preload at the app shell.** Inbox + workspace metadata must be subscribed via `preloadWorkspace(z)` for the lifetime of `<ZeroProvider>`. Without it, navigating away from `/app/inbox` lets the TTL clock start and a quick reload races the cache. See `apps/web/src/lib/zero-preload.ts`.
31. **`"Loading…"` text instead of a skeleton.** Centered loading text is the wrong shape, shifts layout when content arrives, and makes the app feel slower than it is. Render a skeleton at the *exact* dimensions of the real content (`apps/web/src/components/skeletons.tsx`).
32. **Full-screen splash on in-app navigation.** `BrandSplash` is for the auth gate only. Wiring it as `defaultPendingComponent` makes every ticket click flash a full-screen splash — instant downgrade from "feels like Linear" to "feels like a 2010 web app". See §14 "Pre-React splash for the auth window".
33. **Async `beforeLoad` without caching.** TanStack Router re-runs `beforeLoad` on every matched navigation. An uncached async fetch in there will re-trigger the route's pending state on every click and silently re-hit your auth endpoint. Cache the result at module level (or use the loader's `staleTime`).

---

## 19. Reading list & libraries

### Required reading (in priority order)

1. Linear — [Building Linear](https://linear.app/blog/building-linear)
2. Linear — [Scaling the Linear Sync Engine](https://linear.app/blog/scaling-the-linear-sync-engine)
3. Karri Saarinen — [Designing Linear (Config 2022)](https://www.youtube.com/watch?v=jVAOrCfSrl8)
4. Linear — [The Linear Method](https://linear.app/method)
5. Linear — [Brand as customer experience](https://linear.app/blog/brand-as-customer-experience)
6. Zero — [zero.rocicorp.dev](https://zero.rocicorp.dev) + [`/tmp/zero-mono/apps/zbugs`](file:///tmp/zero-mono/apps/zbugs) (the canonical reference)
7. PostHog — [Engineering conventions](https://posthog.com/handbook/engineering/conventions) and [How we code](https://posthog.com/handbook/engineering/how-we-code)
8. Paco Coursey — [cmdk](https://cmdk.paco.me)
9. React — [You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect)
10. Evil Martians — [OKLCH in CSS](https://evilmartians.com/chronicles/oklch-in-css-why-quit-rgb-hsl)
11. WAI-ARIA — [Authoring Practices](https://www.w3.org/WAI/ARIA/apg/)

### Library stack

| Need | Library |
|---|---|
| Local-first sync | `@rocicorp/zero` |
| Router | `@tanstack/react-router` |
| Headless primitives | `@radix-ui/react-*` |
| Component starter | shadcn/ui (copy into `packages/ui/`) |
| Command palette | `cmdk` |
| Toasts | `sonner` (when we migrate from `feedback.ts`) |
| Forms | `react-hook-form` + `zod` + `@hookform/resolvers/zod` |
| Virtual lists | `@tanstack/react-virtual` |
| Animations | `framer-motion` |
| Hotkeys | `tinykeys` (sequences) wrapped in `useShortcut` |
| Resizable panels | `react-resizable-panels` |
| Atomic state | `jotai` (when we exceed ~3 stores) |
| Icons | `lucide-react` |
| Fonts | `@fontsource-variable/inter` |
| Class merging | `clsx` + `tailwind-merge` (`cn()`) |
| Variants | `class-variance-authority` |

---

## Appendix: PR checklist

Copy this into the PR description for every UI-touching change:

- [ ] Tested in light and dark mode (screenshot of both attached).
- [ ] **Hard reload of the touched route does not flash a loading state** (verify with agent-browser or DevTools "Disable cache" off).
- [ ] Every `useQuery` call passes a TTL constant from `lib/zero-cache.ts` (no bare `useQuery(q())`).
- [ ] List queries are bounded with a `limit` argument.
- [ ] Keyboard shortcuts go through `useShortcut`, not a raw `window.addEventListener`.
- [ ] Keyboard-only walkthrough completed for the new interaction.
- [ ] Every interactive element has a focus-visible ring.
- [ ] Icon-only buttons have `aria-label`.
- [ ] Tokens used (no hex, no `gray-500` family).
- [ ] No new `useEffect` that exists only to derive state.
- [ ] Workspace-scoped queries use `applyWorkspaceScope` / `applyTicketRead`.
- [ ] Mutations call `assertHasWorkspace` and validate args via Zod.
- [ ] Loading state is a skeleton at final dimensions, not "Loading…" text.
- [ ] `.one()` queries don't render "not found" until `status.type === 'complete'`.
- [ ] Optimistic mutation has a visible failure path (toast + rollback).
- [ ] If destructive: undo via toast OR confirm dialog. Never silent.
- [ ] Component is < 400 lines OR split into subcomponents.
- [ ] Lighthouse Performance ≥ 90 on the affected route (CI check).

---

## Appendix: Linear's "shortcut tooltip" pattern

```tsx
// packages/ui/src/tooltip-with-kbd.tsx
export function TooltipWithKbd({ label, kbd, children }: { label: string; kbd?: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent className="flex items-center gap-2">
        <span>{label}</span>
        {kbd && (
          <kbd className="rounded border border-border-strong bg-surface-muted px-1 text-[11px] text-muted-foreground">
            {kbd}
          </kbd>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
```

Use it on every action button. The shortcut is now self-documenting — discoverability without a docs page.

---

The unifying thread, again: **engineering quality is what makes design quality stick.** Linear's polish is downstream of their sync engine. Ours is downstream of how disciplined we are with Zero, with tokens, with keyboard contracts, with optimistic UI. Every shortcut in this guide pays compounding interest.

Hold the line.
