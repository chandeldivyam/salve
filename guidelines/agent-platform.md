# Agent platform: building and shipping actions

How to add, modify, or extend the action-contract pipeline that powers `/v1`, `salve` (CLI), and `salve-mcp` (MCP) — and how to keep the next change from breaking any of the three.

Read `guidelines/architecture.md` first to understand which surface a piece of work belongs on. This file is for when you've decided you're working on Path B (programmatic write path) and need to know *how*.

The canonical narrative is `docs/agent-platform-rfc.md`. This file is the working playbook — the conventions, invariants, gotchas, and post-mortems that emerged while shipping Phases A–H.

---

## 1. The pipeline at a glance

```
                                  ┌─ HTTP /v1/* ──── apps/api/src/public-api/<domain>.ts
action-contracts (Zod + meta)     │
        │                         ├─ CLI command  ── apps/cli (auto-derived from cli metadata)
        ▼                         │
action-executor (server runtime) ─┤── MCP tool    ── apps/mcp (auto-derived from mcp metadata)
        │                         │
        ▼                         └─ SDK call     ── packages/api-client (auto-derived; no per-action method)
@opendesk/mutators (writes)
        │
        ▼
@opendesk/db (Drizzle)
```

A single Zod input schema and a single server function (the executor) drive every consumer. Adding a surface to an action is a **metadata** change, not a code change.

---

## 2. Action contract anatomy

`packages/action-contracts/src/<domain>.ts` exports an action via `defineAction`:

```ts
export const ticketActions = {
  resolve: defineAction({
    id: 'tickets.resolve',                          // namespaced dotted id; stable forever
    summary: 'Resolve a ticket without closing it.',
    inputSchema: ticketIdInputSchema,               // Zod object — input contract
    outputSchema: ticketOutputSchema,               // Zod object — output contract (used by client validation + OpenAPI)
    scopes: ['tickets:write'],                      // any scope from packages/action-contracts/src/scopes.ts
    idempotency: 'optional',                        // 'none' | 'optional' | 'required'
    auditEventKind: 'ticket.status_changed',        // logged on success
    rest: { method: 'POST', path: '/tickets/:ticketId/resolve', pathParams: ['ticketId'] },
    cli: { command: ['tickets', 'resolve'], positionals: ['ticketId'] },
    mcp: { toolName: 'salve.tickets.resolve' },     // optional — omit to hide from MCP
  }),
};
```

Rules for each field:

- **`id`** — dotted namespace. Once shipped, never rename. Renaming breaks every cached idempotency record, every logged audit event, and every external caller.
- **`scopes`** — array. The route middleware enforces *all* listed scopes; reads use `:read`, writes use `:write`.
- **`idempotency`** — `'required'` for any write that creates a row whose duplication would cause customer pain (sends, ticket creation, audit-emitting state changes). `'optional'` for updates that are naturally idempotent (e.g. tag remove, status change). `'none'` only for reads.
- **`auditEventKind`** — fires only on success; the executor never has to call `audit.emit()` itself.
- **`rest.path`** — Hono syntax (`:ticketId`). All `:foo` segments must appear in `pathParams`. The path-params union must be a subset of the input schema's required keys.
- **`cli`** — `command` is the verb tree (`['tickets', 'resolve']` → `salve tickets resolve …`). `positionals` come first; remaining input goes through flags.
- **`mcp`** — `toolName` should follow `salve.<namespace>.<verb>` with **snake_case** segments after the namespace (we standardised on `salve.tickets.add_note`, `salve.tickets.message_update`, etc., not dotted further). Set `destructive: true` for ops that are hard to reverse (close, delete). Omit `mcp` entirely if a tool would only confuse an LLM.

### Input schemas: UUID validation is mandatory

All user-supplied IDs in inputs must be `z.string().uuid()`, not `z.string().min(1)`.

```ts
// packages/action-contracts/src/<domain>.ts
const idSchema = z.string().min(1);                 // for OUTPUT nested ids only
const uuidSchema = z.string().uuid();               // for INPUT user-supplied ids

export const ticketIdInputSchema = z.object({
  ticketId: uuidSchema,
});
```

**Why**: a bare `min(1)` lets non-UUID strings reach the postgres driver, which throws `22P02 invalid_text_representation`, which the API maps to `500 internal_error`. The customer sees a 500; the actual cause is bad input. With `uuidSchema`, Zod rejects the request at the route boundary and emits a clean `400 validation_error` with `field: ticketId`.

This learning came from post-H hardening (2026-05-05) when the MCP harness surfaced `GET /v1/tickets/<not-a-uuid>` returning 500. Mirror what `customers.ts` does. Apply it to every new contract.

### Output schemas: include enough that clients don't need a follow-up read

The CLI and MCP both render the response. If `tickets.resolve` only returns `{ ok: true }`, the agent has to chase up with a `tickets.get` to see the new state. Always return the canonical resource (`{ ticket: ticketDetailSchema }`, `{ message: ticketMessageSchema }`, etc.) so a single round-trip is enough.

---

## 3. Executor invariants

`packages/action-executor/src/<domain>.ts` exports one function per action:

```ts
export const resolveTicketExecutor: Executor<typeof ticketActions.resolve> = async (ctx, input) => {
  await assertTicketAccessible(ctx, input.ticketId);                 // 1. authorize
  await ctx.runMutation('ticket.resolve', { id: input.ticketId });   // 2. write via Zero mutator
  return { ticket: await readTicketByID(ctx, input.ticketId) };      // 3. return canonical resource
};
```

Hard rules:

1. **Workspace-scope every read.** `ctx.auth.workspaceID` must appear in every `where()` clause. Cross-workspace probes return the *same* "not found" the caller would see for a non-existent row — never leak the existence of a tenant's data.
2. **Write through `ctx.runMutation('<ns>.<action>', args)`, not raw Drizzle.** This routes through `apps/api/src/public-api/mutator-runner.ts`, which runs the same `defineMutators` code the web app uses. You get optimistic-UI parity + audit emission for free. Direct `ctx.db.insert(...)` is allowed only for purely-public-API tables (idempotency_record, customer_event_log).
3. **Use `actionResourceID(ctx, actionID, suffix)` for any new row id derived from the request.** Two retries with the same `Idempotency-Key` produce the *same* UUID, so the database's unique constraint catches the duplicate even if the higher-level idempotency-store has been GC'd. Without a key, it falls back to `randomUUID()`.
4. **Wrap multi-write executors in a transaction.** `ctx.db.transaction(async (tx) => {...})`. If the second insert fails, the first rolls back. Critical for any action that writes more than one row (ticket-create + first-message, customer events + customer fields). Learned the hard way during Phase E events ingest.
5. **Catch unique-violation as a retry-recovery branch when applicable.** The events-ingest executor wraps its insert in try/catch; on duplicate-key it re-fetches the existing row by `actionResourceID` and returns the original output. This makes the action *fully* idempotent even if the HTTP idempotency-store missed.
6. **Throw `notFound`, `validationError`, etc. (from `@opendesk/action-executor/errors`), never bare `Error`.** The error handler at the route layer maps these to the right HTTP status; bare errors fall to 500.

### Postgres binding gotchas

- **Never bind `Date` directly through `sql\`…\`` in update expressions.** postgres-js refuses (`TypeError: Received an instance of Date`). Convert to ISO and cast: `sql\`LEAST(COALESCE(..., ${iso}::timestamptz), ${iso}::timestamptz)\``.
- **Never write `${col} = ANY(${jsArray})`.** postgres-js doesn't auto-serialise JS arrays as Postgres array literals. Use drizzle's `inArray(col, values)` instead. (Phase G `views.tickets` 500 was caused by this.)
- **`limit + 1` sentinel pagination** is the convention. Server returns up to `limit + 1`; client slices the first `limit` and uses the trailing row to set `hasMore`. Cursor is always the trailing row's stable sort key (typically `(updatedAt, id)`).

---

## 4. REST routing

`apps/api/src/public-api/<domain>.ts` mounts the router. The pattern is mechanical:

```ts
customersRouter.put(
  '/:customerId/custom-fields/:fieldKey',
  ...actionMiddlewares(customerActions.customFieldSet),
  actionHandler(
    customerActions.customFieldSet,
    setCustomerCustomFieldExecutor,
    async (c) => ({
      ...(await readJsonBody(c)),
      customerId: c.req.param('customerId'),
      fieldKey: c.req.param('fieldKey'),
    }),
  ),
);
```

Key points:

- `actionMiddlewares(contract)` returns the standard chain: request-ID → bearer auth → scope check → idempotency-key extraction.
- `actionHandler(contract, executor, extractInput, successStatus?)` parses the body via `contract.inputSchema.safeParse`, builds an executor context, runs the executor through the idempotency store if applicable, and serialises the response.
- The third argument (`extractInput`) is the *only* per-route code. It composes path params + JSON body into the input shape. Path params win over body keys (we always overwrite from `c.req.param`).
- `successStatus` defaults to 200; pass `201` for creates.

The router gets mounted in `apps/api/src/server.ts` at `app.route('/v1/<domain>', <domain>Router)`. Adding a domain means: add the contract file, add the executor file, add the router file, add one line to `server.ts`.

---

## 5. API client

`@opendesk/api-client` exposes two things:

1. A typed namespaced surface: `client.tickets.resolve(ticketId, options?)`, `client.customers.search({…})`, etc.
2. The escape hatch: `client.action(actionId, input, options?)` — useful for actions whose namespace method doesn't exist yet, for tests, and for the CLI's untyped action runner.

Both go through the same `fetchAction(client, actionID, input, options)` core. Important behaviours:

- **Idempotency key minting.** When `contract.idempotency === 'required'` and the caller didn't pass `options.idempotencyKey`, the client mints a `randomUUID()` and reuses it across all retries.
- **Retry on 5xx and network errors.** Up to 2 retries with exponential backoff. The reused idempotency key makes this safe.
- **Error envelope.** The server's `{error: {type, code, message, requestId, field?}}` is unwrapped into a `SalveApiError` instance with all four fields. *Don't* match on `error.message` strings; match on `error.code`. The hint table (`packages/api-client/src/hints.ts`) is the single source of truth for human-friendly explanations of each code.
- **Validation.** Inputs pass through `contract.inputSchema.parse(input)` *before* the network call. A failed `parse` throws a `ZodError` synchronously — the CLI and MCP both handle this branch (see error formatters in each app).

When adding a new action, you don't need to touch `client.ts` unless you're adding a *typed* namespace method for ergonomics. The bare `client.action(...)` call works the moment the contract ships.

---

## 6. CLI (`apps/cli`)

A hand-written dispatcher in `apps/cli/src/main.ts` routes verbs to `@opendesk/api-client` calls. The `cli` metadata on each action contract is the *declarative source* for what should be wired up — `apps/cli/src/coverage.test.ts` asserts every shipped CLI verb has a matching contract entry, so drift is caught at CI. (Earlier docs called this "auto-derived" — it isn't; the metadata exists for the test, the help text, and to future-proof a generator if we ever build one.)

Conventions:

- Output mode: defaults to **`json`** when stdout is not a TTY (pipe), **`pretty`** otherwise. Override with `--json | --jsonl | --pretty | --yaml | --table`.
- Pagination flag: `--limit` and `--cursor` for any contract whose input schema declares them.
- `--idempotency-key <uuid>` is honoured for every write; otherwise the api-client mints one for `'required'` actions.
- Errors from the API render with a one-line summary, code-derived hint (from the shared hint table), and `requestId` for support. `ZodError` (client-side validation) renders with field paths and a "fix the offending input" tail. Network failures map to exit code 2; 4xx → 1; success → 0.
- `salve login` writes `~/.config/salve/auth.json` (mode 600). `salve workspace use <id>` writes `~/.config/salve/config.json`. The MCP server reads both files as a fallback when env vars are unset.

When you add a new contract with `cli` metadata, the CLI registers the verb tree automatically. Only touch `main.ts` when an action needs custom rendering (e.g. `customers context` would render markdown, not JSON).

---

## 7. MCP (`apps/mcp`)

`apps/mcp/src/tools/registry.ts` walks `ALL_ACTIONS.filter(a => a.mcp)` and registers each as a tool. Three guardrails:

1. **Annotations.** `readOnlyHint`, `destructiveHint`, `idempotentHint` are derived from contract metadata. The host's permission UI uses these to gate tool calls.
2. **Token budget.** `tools/list` payload must stay under **16 KB**. There's a unit test in `apps/mcp/src/server.test.ts` that asserts this. If a contract's `inputSchema` has a deeply-nested branded refinement, `compactInputSchema` (in `tools/schema.ts`) will collapse it to the lowest-fidelity Zod type that still validates the JSON-Schema shape; this is intentional — the executor still runs the *full* server-side parse, so refinements aren't lost.
3. **Composite tools.** Three handcrafted markdown tools (`salve.tickets.triage`, `salve.tickets.summarize_thread`, `salve.customers.context`) live in `tools/composite.ts`. They fan out to multiple read actions, format the result as markdown, and stay token-budgeted. Add a composite when an LLM would otherwise call 3+ read tools in series for the same data.

Resources are URI templates (`salve://ticket/{id}`, `salve://customer/{id}`, `salve://view/{id}`) and prompts are workflow templates (`salve.triage-inbox`, etc.). Both live in `apps/mcp/src/resources/registry.ts` and `apps/mcp/src/prompts/registry.ts`.

When you add a contract with `mcp.toolName`, the MCP tool registers automatically. The only reason to touch `apps/mcp/src/*` is when you're adding a new composite tool, resource, or prompt template.

---

## 8. Errors and the hint table

All four surfaces (REST, api-client, CLI, MCP) share the same error vocabulary. The **codes** are stable strings; the **messages** can change; the **hints** are advisory.

Common codes:

| Code | HTTP | When |
|---|---|---|
| `auth.required` | 401 | No bearer token, or expired/revoked |
| `auth.scope_missing` | 403 | Token lacks the required scope |
| `auth.workspace_required` | 403 | Token isn't workspace-scoped |
| `request.invalid` | 400 | Zod validation failed (input shape) |
| `request.json_invalid` | 400 | Body wasn't valid JSON |
| `request.body_invalid` | 400 | Body wasn't a JSON object |
| `<resource>.not_found` | 404 | Workspace-scoped resource missing |
| `idempotency_key.in_progress` | 409 | Same key, same body, request still running |
| `idempotency_key.reused_with_different_request` | 409 | Same key, different body |
| `internal_error` | 500 | Unhandled exception (file a bug) |

Hints live in `packages/api-client/src/hints.ts` and are consumed by every formatter. Keep them: short, action-oriented, and free of marketing voice.

---

## 9. Testing checklist for a new action

Before you commit:

1. `pnpm --filter @opendesk/action-contracts type-check` — Zod + metadata compile.
2. `pnpm --filter @opendesk/action-executor type-check` — executor signature matches contract.
3. `pnpm --filter @opendesk/api type-check` — REST router compiles.
4. `pnpm --filter @opendesk/api-client test` — namespace method (if added) works in unit harness.
5. `pnpm --filter @opendesk/cli test` — CLI dispatcher still parses cleanly.
6. `pnpm --filter @opendesk/mcp test` — manifest still under 16 KB; tool registers; annotations correct.
7. `pnpm -r type-check` — workspace-wide.
8. `pnpm -r --workspace-concurrency=4 test` — workspace-wide test sweep.
9. **Live test against `localhost:3001`**: with a PAT, exercise the new action via curl *and* via the CLI (`pnpm --filter @opendesk/cli dev <verb tree>`) *and* via the MCP harness if `mcp` metadata is set. Don't trust unit tests alone — Phase G's bugs only surfaced in live runs.

The Phase G/H pattern: build the binary, point it at the dev server with a real PAT, and exercise every verb. Each phase has caught bugs that no unit test would have surfaced (bind type mismatches, error mapping holes, schema drift between client and server).

---

## 10. Common refactors

### Adding a new domain

1. Create `packages/action-contracts/src/<domain>.ts`. Mirror `customers.ts` for layout (input schemas at top, output at middle, action map at bottom).
2. Re-export from `packages/action-contracts/src/index.ts` and add to `ALL_ACTIONS` in `registry.ts`.
3. Add executor at `packages/action-executor/src/<domain>.ts`. Match the action map shape.
4. Add executor to `packages/action-executor/src/registry.ts` and barrel export from `index.ts`.
5. Create `apps/api/src/public-api/<domain>.ts` with a Hono router. One endpoint per action.
6. Mount in `apps/api/src/server.ts`: `app.route('/v1/<domain>', <domain>Router)`.
7. Optionally add namespace methods to `packages/api-client/src/client.ts`.
8. Optionally add typed CLI handlers to `apps/cli/src/main.ts`.
9. Run the testing checklist (§9).

### Adding a single action to an existing domain

1. Add to the action map in `packages/action-contracts/src/<domain>.ts`.
2. Add the executor in `packages/action-executor/src/<domain>.ts` and register in the local executor record.
3. Add one router branch in `apps/api/src/public-api/<domain>.ts`.
4. (Optional) Add to api-client namespace, CLI dispatcher.
5. Test (§9).

### Renaming or removing an action

Don't. Once an action ships, its `id` is on someone's idempotency record, in their audit logs, and in their integration's request history. If the semantics need to change, ship a new action (`tickets.foo.v2` or a new namespace) and deprecate the old one with `mcp` metadata stripped to hide it from MCP. The old executor stays around until the next major.

---

## 11. The post-mortems (don't relearn these)

| Bug | Cause | Fix | Where to mirror |
|---|---|---|---|
| `views tickets` returned 500 | `sql\`${col} = ANY(${jsArray})\`` — postgres-js doesn't serialise JS arrays | Use `inArray()` from drizzle-orm | `packages/action-executor/src/views.ts` |
| `customers events ingest` returned 500 + duplicate-key on retry | `LEAST(COALESCE(... ${dateObj}))` bound a JS Date object directly; deterministic `actionResourceID` collided with a stale row | Convert to ISO + `::timestamptz` cast; wrap in `ctx.db.transaction`; add `findEventByID` fallback for unique-violation recovery | `packages/action-executor/src/customers.ts` |
| CLI rendered raw `[{path:[…], message:…}]` for client-side validation | Generic `Error` branch JSON-stringified the `ZodError` | Add `ZodError` branch with field-path formatting | `apps/cli/src/error.ts`, `apps/mcp/src/error.ts` |
| `customers.customField.set` missing despite UI having the feature | Action just hadn't been ported | Add full vertical: contract + executor + REST + api-client + CLI | follow §10.1 |
| `tickets.get` with a non-UUID returned 500 | `ticketIdInputSchema.ticketId` was `idSchema` (`min(1)`); non-UUID reached postgres and threw 22P02 | Add `uuidSchema = z.string().uuid()` and use it for all input-side IDs in `tickets.ts`, mirroring `customers.ts` | every contract file going forward |

These bugs all share a pattern: **the unit tests passed, the live test surfaced them.** Build the test harness with a real PAT against a real dev server before declaring a phase done.

---

## 12. Versioning + deprecation policy

`/v1` is stable. Before breaking changes:

- **Additive change** (new field on output, new optional input): ship in `/v1`. Old clients keep working.
- **Renaming a field**: dual-write the new name + old name in the output; deprecate old name in OpenAPI docs; remove only on `/v2`.
- **Removing an action**: hide from MCP and CLI first; leave REST endpoint up for one minor with a deprecation header (`Deprecation: <RFC 9745 timestamp>`); only then 410.
- **Changing scope requirements**: never tighten without a major version bump; loosening (allowing more tokens through) is fine.

For now there is no `/v2` and no plan for one. Build for the long tail.

---

## 13. Cheat-sheet

```
Contract:  packages/action-contracts/src/<domain>.ts          # Zod + metadata
Executor:  packages/action-executor/src/<domain>.ts            # async (ctx, input) => output
REST:      apps/api/src/public-api/<domain>.ts                 # Hono router
Client:    packages/api-client/src/client.ts                   # client.action(id, input, opts)
CLI:       apps/cli/src/main.ts                                # auto from cli metadata + custom branches
MCP:       apps/mcp/src/server.ts                              # auto from mcp metadata + composites/resources/prompts
```

Add new things by **extending metadata first**, code last. The pipeline rewards small, declarative changes.
