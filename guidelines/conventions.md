# Engineering Conventions

Living rules for `apps/web` and the Zero schema package. Rules here are
enforced; deviations need a comment explaining why. Derived from the
[2026-05-01 audit](./audit-2026-05-01.md), zbugs, and current Zero docs.

> **Scope note.** This file covers the UI write path: Zero queries, Zero
> mutators, the React app, settings pages, copy. Anything programmatic
> (REST API, CLI, MCP, action contracts, executors) lives in
> `guidelines/agent-platform.md`. The boundary between the two is in
> `guidelines/architecture.md` — read that first if you're not sure
> which side a piece of work falls on.
>
> The non-negotiable rule: **the web app never calls `/v1`. External
> consumers never call Zero.** Both surfaces converge server-side
> through `defineMutators`, so business logic stays in one place.

---

## 1. Queries (Zero)

### Where queries live

- All queries are defined in `packages/zero-schema/src/queries.ts` via
  `defineQuery` with a Zod argument schema.
- No inline `defineQuery` in routes or components.
- Routes import named queries: `queries.customerList(...)`,
  `queries.inboxOpen(...)`, etc.

### Pagination

Two patterns, used in different contexts:

**`limit + 1` sentinel** (paginated lists): server returns up to
`limit + 1` rows; client slices the first `limit` for display and uses
the trailing row as the "has more" signal. Used by customers, customer
notes/events, ticket message timelines.

```ts
import { paginate } from '@/lib/paginate';
const [rawRows] = useQuery(queries.customerList({ limit: limit + 1 }), CACHE_TICKET_DETAIL);
const { visible, hasMore } = paginate(rawRows, limit);
```

**Absolute growing window** (inbox preload): inbox uses `inboxOpen({ limit: pageLimit })`
and grows `pageLimit` (200 → 400 → … → 2000) when the user nears the bottom.
"Has more" is detected via `tickets.length < pageLimit`. This pattern exists
because the inbox preloads aggressively for instant cold-start render — a
second round-trip would flash a loading state. Do not use this pattern for
new lists; it's an inbox-specific optimization.

Constants live in `packages/zero-schema/src/consts.ts` and are the single
source of truth — `queries.ts` imports from `consts.ts`, no private
duplicates:

- `PAGE` — default page size for list views.
- `MAX_LIST_LIMIT` — display ceiling for paginated lists. Query schemas
  accept up to `MAX_LIST_LIMIT_QUERY = MAX_LIST_LIMIT + 1` so the
  sentinel fits.
- `INBOX_INITIAL_PAGE`, `INBOX_PAGE_GROWTH`, `MAX_INBOX_LIMIT` — inbox
  window sizing.
- `TICKET_ANCHOR_LIMIT`, `ALL_TICKET_MESSAGE_LIMIT` — single-ticket
  timeline.
- `CUSTOMER_TICKET_LIMIT`, `CUSTOMER_NOTE_LIMIT`, `CUSTOMER_EVENT_LIMIT`
  — customer-scoped queries.

**Never** hardcode `limit: 2000` or similar. If a query genuinely needs
to fetch all, use `zero.preload(...)` at app boot, not a giant inline
limit in a component.

### Filter composition

- Use Zero's builder primitives (`and`, `or`, `cmp`, `exists`) directly.
- Filters are ad-hoc per query — *do not* build a generic
  `applyFilters(query, filterObject)` helper. (See audit §4 for the
  rationale.)
- Use `escapeLike()` (or equivalent) on every `ILIKE` value before
  interpolation.

### Cache policy

- Use the named constants from `apps/web/src/lib/zero-cache.ts`:
  - `CACHE_FOREVER` (10 min) — data we always want hot (inbox, members).
  - `CACHE_NAV` (5 min) — per-route data the user may return to.
  - `CACHE_TICKET_DETAIL` (5 min) — ticket detail subscriptions.
  - `CACHE_NONE` — truly throwaway.
  - `CACHE_PRELOAD` (alias for `CACHE_FOREVER`) — at preload sites, signals
    intent.
- **Never** pass an inline `{ ttl: '5m' }` to `useQuery`. If you need a new
  TTL bucket, add a named constant.

### Result handling

- Distinguish partial-local from confirmed-complete: only render
  "not found" / empty UI when `status?.type === 'complete'`. Otherwise
  show skeleton.
- Use `useQuery(...)` for reactive subscriptions, `zero.run(...)` for
  one-shot reads, `zero.preload(...)` for warming caches at app boot.

---

## 2. Mutators

- Validate all args with Zod via `defineMutator`.
- **Auth check before existence check**, always. Otherwise we leak
  information (e.g. "does ticket X exist?"). zbugs reference:
  `mutators.ts:104`.
- Use a typed error class with a code, not string-matching:

  ```ts
  export type MutationErrorCode = 'NOT_AUTHORIZED' | 'NOT_LOGGED_IN' | ...;
  export class MutationError<T extends MutationErrorCode> extends Error { ... }
  ```

- Server-side error policy:
  - Temporary error → halt and retry (don't increment `lastMutationID`).
  - Permanent error → log, increment `lastMutationID`, skip mutation.

  This avoids deadlocking a client whose mutation always errors.
- Emit an `audit_event` for every state-changing mutation that another
  agent might want to see in the timeline.

---

## 3. Lists / tables

### `<DataList>` for paginated tabular lists

- **Today**: `<DataList>` handles the "Show more" button pattern with
  rows / header / empty / skeleton slots. `customers.index` is the only
  consumer.
- **Not yet in DataList**: infinite scroll, virtualization, keyboard
  navigation, bulk select. The inbox keeps its bespoke shell because it
  needs all four. Callers that need keyboard nav wire it themselves
  (`useShortcut(['j'], ...)`).
- **Growth rule**: DataList grows a feature only when a second non-inbox
  consumer needs it. Don't pre-implement.

### When to virtualize

- Use `@tanstack/react-virtual` only when the visible window may exceed
  ~200 rows in practice. Inbox: yes. Customers (paginated to 50): no.
- **Do not** introduce `@tanstack/react-table`. We don't need column
  models. Our data is row-shaped — keep it that way until proven otherwise.

### Row clickability

- Use the Linear-style overlay-link pattern (see `inbox-row.tsx:71-79`):
  full-row `<a>` at `absolute inset-0 z-0`, interactive children at
  `z-10`, labels at `pointer-events-none z-0`. No "dead zones."

### Skeletons

- Use a single `<SkeletonRow>` primitive (to be built). Configure via
  props: `{ count, height, showAvatar }`.
- **Do not** roll a skeleton per page.

---

## 4. Routing (TanStack Router)

### Search params are state

- Filters, sort, pagination, view preferences live in the URL.
- Validate at the route level with `validateSearch` + Zod. Use
  `.catch(default)` not `.default(...)` for malformed inputs (don't show
  the user an error — recover silently).
- Read in components via `useSearch({ from: Route.id })`.
- Update via `navigate({ search: prev => ({ ...prev, ... }) })` —
  reducer-style, atomic.
- React state is for UI ephemera only (hover, animations, in-flight input
  before commit).

### File layout

- File-based routes under `apps/web/src/routes/`.
- Each `/app/<feature>` group has its own folder (or flat files where
  small). Layouts use `<Outlet />`.
- Page components for non-settings routes use `<PageHeader>` for
  consistency. Settings routes already use `<SettingsHeader>` ✅.

---

## 5. Forms

- Validation: Zod schemas, validated on submit and (where useful) on
  blur. No ad-hoc string checks.
- Error display: shared `useFormError()` hook (to be built). Returns
  `{ error, setError, handleException }`.
- Submit pattern: try/catch around the mutator call; on error
  `handleException(e)` which routes to a toast or inline message based on
  error code.

---

## 6. Composer

- Single shell: `<ComposerShell>` owns the toolbar slot, send/cancel
  controls, draft persistence, Cmd+Enter to send.
- Two editors: `<TiptapEditor>` (rich, for replies) and `<PlainEditor>`
  (textarea, for notes).
- Drafts persist to localStorage via Zustand (existing
  `composer-drafts.ts`). Both rich and plain composers must persist.
- Tiptap content stored as JSON, not HTML, in the draft store. HTML is
  rendered on demand. Sanitize with DOMPurify before any server write.

---

## 7. Code quality

### File size

- **Comfortable target:** ≤ 300 lines per component file.
- **Hard ceiling:** 500 lines. Files over 500 lines need a refactor
  ticket.
- The mainstream React community converges on 200–300 lines as the sweet
  spot; 500 as the upper bound before splits become urgent.

### Comments

- Default to none. Only write a comment when the *why* is non-obvious: a
  hidden constraint, a workaround, a security rationale.
- **Never** write multi-paragraph block comments (e.g. file-header
  philosophy preambles). One line max.
- **Never** describe what the code does. Identifiers do that.
- **Never** reference task or PR context ("added for issue #123",
  "handles the X case from the Y flow"). Belongs in the PR description.

### Types

- `readonly` on all interface fields and array params unless mutation is
  intentional.
- `as const` for static config tuples / objects.
- No branded ID types — Zod validation at the boundary is sufficient.
- No `any` in hand-written code. No `!.` non-null assertions unless
  immediately preceded by an explicit guard.

### Naming

- Files: kebab-case (`note-composer.tsx`, `data-list.tsx`).
- React components: PascalCase, exported by name (no default exports
  except where required by the framework, e.g. lazy routes).
- Utilities: camelCase functions.
- No barrel `index.ts` files. Imports go to leaf modules.

### Constants

- All magic numbers move to a named constant the first time they're
  reused — even within a single file. Two uses → constant.
- Cross-feature constants live in
  `packages/zero-schema/src/consts.ts` (back-end / data) or
  `apps/web/src/lib/constants.ts` (UI).

---

## 8. Testing

(Stub — flesh out as we add real tests.)

- Integration tests hit a real Postgres + Zero cache, never mocks. Mocks
  diverge from production behaviour (zbugs runs against a real db too).
- Component tests with Vitest + React Testing Library for stateful
  components.
- Playwright for end-to-end golden paths (sign-in, inbox → ticket reply,
  composer draft persistence).
