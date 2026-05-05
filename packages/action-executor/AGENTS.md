# packages/action-executor · AGENTS.md

Server-side runtime for every action defined in `@opendesk/action-contracts`. Each executor is a typed function `(ctx, input) => Promise<output>`. Read root `AGENTS.md`, `guidelines/agent-platform.md`, and `packages/action-contracts/AGENTS.md` first.

## Layout

```
src/
├── index.ts        # barrel export of every executor + types
├── registry.ts     # actionExecutors record keyed by ActionID (consumed by tests + tooling)
├── ctx.ts          # ExecutorCtx, ExecutorAuth, Executor<C> type
├── ids.ts          # actionResourceID() — deterministic UUID from idempotency key
├── errors.ts       # ActionExecutorError + factory helpers (notFound, validationError, conflict, …)
├── tickets.ts      # tickets.* executors + readTicketByID + hydrateTicket
├── customers.ts    # customers.* executors
├── views.ts        # views.* executors
└── settings.ts     # settings.* executors
```

## Notable patterns

- **Three steps per executor**:
  1. **Authorize** — assert the resource is workspace-scoped and the principal is allowed to touch it. Cross-workspace probes return the same `notFound` a missing row would (no leaks).
  2. **Mutate via `ctx.runMutation('<ns>.<action>', args)`** — never raw `ctx.db.insert(...)` for domain tables. The mutator runs the same `defineMutators` code the web app uses, including audit emission.
  3. **Return canonical resource** — re-read via `readTicketByID` / `readCustomerByID` / etc. so consumers don't need a follow-up GET.
- **Workspace scope is mandatory.** Every `where()` includes `eq(table.workspaceId, ctx.auth.workspaceID)`. Forgetting it is a tenant-isolation bug. Helpers like `assertTicketAccessible(ctx, id)` exist precisely so you don't have to remember.
- **Use `actionResourceID(ctx, actionID, suffix)` for new row IDs derived from the request.** Two retries with the same idempotency key produce the same UUID, so the unique constraint catches duplicates even when the higher-level idempotency-store has expired.
- **Wrap multi-write executors in `ctx.db.transaction(async (tx) => {...})`.** Atomicity matters. The events-ingest executor learned this the hard way (Phase E).
- **Catch unique-violation as a retry-recovery branch when applicable.** `customers.events.ingest` re-fetches the existing event by id on duplicate-key and returns the original output, making the action fully idempotent even if the HTTP idempotency-store missed.
- **Throw `ActionExecutorError` (via `notFound`/`validationError`/`conflict`/`forbidden` helpers).** Bare `Error`s map to 500. Only the named errors map to clean HTTP statuses.

## Postgres binding gotchas

- **Never bind a `Date` directly through `sql\`…\``.** postgres-js refuses with `TypeError: Received an instance of Date`. Convert to ISO and cast: `sql\`LEAST(COALESCE(${col}, ${iso}::timestamptz), ${iso}::timestamptz)\``.
- **Never write `${col} = ANY(${jsArray})`.** Use drizzle's `inArray(col, values)`. The `ANY` form quietly produces an empty result or 500s — postgres-js doesn't auto-serialise JS arrays as Postgres array literals.

## Reads should hydrate

`readTicketByID` returns the full `ticketDetailSchema` shape: tags, custom fields, recent messages, customer relation. List endpoints batch-hydrate via `hydrateTicketList(ctx, rows)` to avoid N+1. Don't return half-populated rows from a "get" — clients (and especially LLMs) shouldn't have to chase relations.

## Idempotency surface (what executors see vs. what HTTP sees)

The HTTP idempotency-store (`apps/api/src/public-api/middleware/idempotency-store.ts`) wraps the executor in a record-and-replay shell. From inside the executor you see a `ctx.idempotencyKey` string-or-null and you call `actionResourceID(ctx, actionID, suffix)` to derive deterministic ids. You do **not** need to write `INSERT … ON CONFLICT DO NOTHING` — the deterministic id + the unique constraint do the work, and the higher-level store handles full request/response replay.

When an action is `idempotency: 'required'` the HTTP middleware will reject requests without a key; you don't have to validate again.

## Gotchas hit

- **Date binding** through `sql\`…\`` (post-G hardening): solved with ISO + `::timestamptz` cast.
- **`ANY(${jsArray})`** silently returned empty / 500'd: solved with `inArray()`.
- **Deterministic `actionResourceID` collision** on retry of an action that succeeded but whose response wasn't cached: solved by adding a unique-violation catch + re-fetch by id.
- **Workspace scope missing in a single query** caused tests to pass against a single tenant but fail in multi-tenant fixtures: enforced by helper functions like `assertTicketAccessible`.

## Tests

Currently the package has no `test` script of its own; coverage comes from `apps/api` integration tests (planned) and the live PAT-driven harnesses run during phase shipping. When adding tests, mirror `packages/api-client/src/client.test.ts`'s structure: a fake fetch + a real contract.

## Where to look

| File | What it is |
|---|---|
| `src/ctx.ts` | `ExecutorCtx` shape + helpers. The `runMutation` method is the bridge to `@opendesk/mutators`. |
| `src/ids.ts` | `actionResourceID` derivation; SHA-256 of `(workspace, actionID, idempotencyKey, suffix)`. |
| `src/errors.ts` | `ActionExecutorError` + factories. `apps/api/src/public-api/errors.ts` maps these to HTTP responses. |
| `src/registry.ts` | `actionExecutors` record — used to assert that every contract has an executor (test-time check). |

Reference: `guidelines/agent-platform.md` §3 (executor invariants).
