# Architecture: which surface for which work

The single most-asked question on this codebase is *"where does this change go?"* This guide answers it. Read it before you start a feature.

opendesk has two write paths. They look superficially similar — both produce database rows, audit events, and Inngest dispatches — but they have different invariants, different auth models, and different consumers. Mixing them up is the most common cause of subtle multi-tenant bugs.

---

## The two paths

### Path A — UI write path (Zero + Inngest)

For anything that runs **in the React app at `apps/web`**: clicks, keyboard shortcuts, form submits, drag-and-drop, optimistic state updates.

- **Schema**: `packages/db` (Drizzle, source of truth for DDL).
- **Read side**: `packages/zero-schema/src/queries.ts` — `defineQueries({...})` with `applyWorkspaceScope`.
- **Write side**: `packages/mutators/src/index.ts` — `defineMutators({...})`. The same code runs client-side (optimistic) and server-side (authoritative) via `apps/api/src/server-mutators.ts`.
- **Side effects**: server mutators do `inngest.send(...)` post-commit for delivery, audit, webhooks, anything async.
- **Auth**: better-auth session cookie → JWT cookie carried by `<ZeroProvider>`.

### Path B — Programmatic write path (action contract → REST → CLI / MCP / SDK)

For anything that runs **outside the React app**: external integrations, agentic LLM tools, scripts, CI jobs, public API consumers.

- **Contract**: `packages/action-contracts/src/<domain>.ts` — Zod input/output schemas + `mcp` / `cli` / `rest` metadata + `scopes` + `idempotency`.
- **Executor**: `packages/action-executor/src/<domain>.ts` — server-side runner that takes a parsed input and produces output. Reads from Drizzle, writes via Zero server-mutators (delegated through `ctx.runMutation`).
- **REST**: `apps/api/src/public-api/<domain>.ts` — Hono router that wires the executor to the URL declared in the contract's `rest` metadata.
- **Client**: `packages/api-client` — auto-derived methods + `client.action(...)` + idempotency-key generation + retry semantics.
- **CLI**: `apps/cli` — command tree auto-derived from `cli` metadata; ships as `salve` binary.
- **MCP**: `apps/mcp` — stdio MCP server exposing every action with `mcp` metadata as a tool; ships as `salve-mcp` binary.
- **Auth**: bearer token (PAT prefix `slv_pat_`, service-account prefix `slv_svc_`) issued by `apps/api`'s API-key plugin. Scopes from `packages/action-contracts/src/scopes.ts`.

---

## The boundary rule (non-negotiable)

> **The web app never calls `/v1`. External consumers never call Zero.**

- `apps/web` reads through Zero subscriptions (`useQuery`) and writes through Zero mutators (`zero.mutate.<ns>.<action>`). It does not import from `@opendesk/api-client` or fetch `/v1/*`.
- The CLI, MCP server, and SDK consumers go through `/v1`. They do not import `@opendesk/zero-schema` or `@opendesk/mutators` directly.
- The two paths *converge* server-side: the action executor calls `ctx.runMutation('<ns>.<action>', args)`, which runs the same `defineMutators` code the web app would have run. That's why business logic stays in one place.

Why the rule exists:
- Optimistic UI requires the local Zero replica's reactive cache; calling `/v1` from the React app would skip it and split state into two stores.
- Programmatic consumers can't replay Zero mutators (no replica, no client ID, no JWT cookie); they need the server-authoritative REST surface.
- Auditing, scopes, idempotency, and rate-limiting belong on `/v1` only — the web app's session is already authenticated by JWT, not by a scoped token.

---

## Which path do I add code to?

| You're adding... | Path | File(s) |
|---|---|---|
| A new column or table | both | `packages/db/src/schema/*.ts` then mirror in `packages/zero-schema/src/schema.ts` |
| A new query the UI subscribes to | A | `packages/zero-schema/src/queries.ts` |
| A new write the UI performs | A | `packages/mutators/src/index.ts` |
| A new public-API endpoint | B | new contract in `packages/action-contracts/src/<domain>.ts` + executor in `packages/action-executor` + route mount in `apps/api/src/public-api` |
| A new CLI command | B | add `cli` metadata to the action contract; CLI auto-registers it |
| A new MCP tool | B | add `mcp` metadata to the action contract; MCP auto-registers it |
| A side effect of a write (email, webhook, indexing) | both | server-mutator post-commit `inngest.send(...)` in `apps/api/src/server-mutators.ts` |
| A scheduled job | both | Inngest function in `apps/api/src/inngest/functions/` |

If a write needs to be available **both** to the UI and to programmatic consumers (the common case for any meaningful operation), build the action contract first; the executor delegates to the same Zero mutator the UI uses. You get one place for business logic, two surfaces for free.

---

## Identity and scopes

| Surface | Principal | Auth | Scope check |
|---|---|---|---|
| Web app | user (JWT cookie) | better-auth → JWT → Zero `<ZeroProvider>` | `assertCanModify*` helpers in `@opendesk/mutators/src/auth.ts` |
| `/v1` (REST/CLI/MCP) | user (PAT) or service account | `Authorization: Bearer slv_{pat,svc}_…` | `requireApiScopes(action.scopes)` middleware + executor invariants |

Service-account tokens carry a `principalKind: 'service_account'` claim. The audit trail records the API-key id so admins can revoke.

---

## Idempotency

Two layers, both required for write actions:

1. **HTTP layer** — `Idempotency-Key` header is taken from `idempotencyKeyMiddleware`. The action route stores `(workspaceID, actionID, key) → response` in `idempotency_record`; replays return the cached response with `Idempotency-Replayed: true`. Mismatched-body replays return `409 idempotency_key.reused_with_different_request`.
2. **Resource layer** — `actionResourceID(ctx, actionID, suffix)` (in `@opendesk/action-executor`) derives a deterministic UUID from `(workspaceID, actionID, idempotencyKey, suffix)` so the *generated row id* is stable across retries. Without an idempotency key, it falls back to `randomUUID()`.

Contracts declare `idempotency: 'none' | 'optional' | 'required'`. The CLI and MCP auto-generate a key for `'required'`; the api-client mints one for the same set. Audit-event creation, message sends, and ticket creation are all `'required'`.

---

## Where to put a new "side effect"

If something needs to happen *after* a write commits (send an email, ingest a webhook, fan out to a search index), it goes in **Inngest**, not in a polling worker, not in a synchronous post-write call.

- **Server mutators** (Path A or Path B) call `inngest.send({name, data})` *post-commit*.
- **Inngest functions** live in `apps/api/src/inngest/functions/` (the planned home `apps/inngest/` is still a placeholder per its package.json description).
- Event names are channel-agnostic (`delivery/message.requested`, not `email.send`) so chat / WhatsApp / SMS slot in without a schema migration.
- Idempotency keys travel through to the Inngest event so the function dedupes natively.

No DB pollers. The original RFC committed to this for a reason — the moment a poller appears, every other channel becomes second-class.

---

## Reading list (when adding code)

| Adding code to... | Read first |
|---|---|
| `apps/web/**` | `guidelines/frontend.md`, `guidelines/conventions.md`, `apps/web/AGENTS.md` |
| `packages/mutators/**` | zbugs `shared/mutators.ts`, `packages/mutators/AGENTS.md` |
| `packages/zero-schema/**` | zbugs `shared/{schema,queries}.ts`, `packages/zero-schema/AGENTS.md` |
| `packages/action-contracts/**`, `packages/action-executor/**`, `apps/{cli,mcp}/**` | `guidelines/agent-platform.md`, `docs/agent-platform-rfc.md`, the package's `AGENTS.md` |
| `apps/api/**` | `apps/api/AGENTS.md` |
| Inngest functions | `tmp/research/inngest-multichannel-design.md`, `apps/api/src/inngest/AGENTS.md` (TBD) |

---

## Anti-patterns (we've hit each one)

- **Calling `fetch('/v1/...')` from a React component.** It bypasses the local Zero cache, breaks optimistic UI, and the request fails CORS in dev. Use `zero.mutate.<ns>.<action>` instead.
- **Writing from the executor with raw SQL or `ctx.db.insert(...)`.** Bypasses audit emission and the Zero mutator's reactive cache. Always go through `ctx.runMutation('<ns>.<action>', …)`.
- **Adding a CLI subcommand that doesn't have an action contract.** The CLI is a thin wrapper; if the action doesn't exist in `@opendesk/action-contracts`, the command shouldn't exist either.
- **Skipping `idempotency: 'required'` on a write.** Then a network retry doubles the row. The api-client auto-generates a key only when the contract demands one.
- **Using `idSchema` (`z.string().min(1)`) for input UUIDs.** Lets non-UUID strings reach the postgres driver and explode as `500 internal_error` instead of `400 validation_error`. Use `z.string().uuid()` for all user-supplied identifiers (see post-H hardening 2026-05-05).
- **Polling the database for "things to send".** Inngest is the durable queue. Server mutators dispatch post-commit; recovery cron is a no-op in healthy operation.

---

For the deep details on building actions, see `guidelines/agent-platform.md`. For UI conventions, `guidelines/conventions.md` and `guidelines/frontend.md`.
