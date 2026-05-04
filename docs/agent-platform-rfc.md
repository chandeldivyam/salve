# Agent Platform RFC — CLI, MCP, and REST API over Zero

Status: **draft v3 — Phase A shipped; Phase B is next**
Date: 2026-05-04 (initial), 2026-05-04 (v2 revision), 2026-05-05 (v3 — Phase A landed)
Owner: TBD (implementation engineer)

This document is the technical plan for opening opendesk to programmatic clients — a CLI, an MCP server for AI agents, and a public REST API — without compromising the Zero sync engine that powers the web client. It is the result of a deep audit of the current codebase plus a survey of how Vercel, Linear, GitHub `gh`, Stripe, Resend, and the official MCP servers structure equivalent layers.

Read this end-to-end before touching `apps/api`, `packages/mutators`, or starting on `apps/cli` / `apps/mcp`. The architecture decision in §3 is load-bearing — every subsequent section assumes it.

---

## 0. Summary in one paragraph

Build a **canonical action layer** (`packages/action-contracts` + `packages/action-executor`) that re-exposes every meaningful domain operation through a typed, scoped, idempotent contract. Wire `/api/v1/**` (Hono), an `opendesk` CLI, and an `opendesk-mcp` server as thin transport adapters over that layer. Every write action delegates to the existing `createServerMutators()` so outbound delivery, audit events, and permission checks stay correct. Public auth is **API keys + service accounts** via the Better Auth API Key plugin (with a hand-rolled fallback only if it doesn't meet our scope requirements during a 1-day spike), carrying coarse scopes (`tickets:write`, `settings:email:write`, …). Zero's `/api/zero/mutate` and `/api/zero/query` stay internal — they exist for `zero-cache` and the browser, not for external clients. Settings paths that today bypass mutators (notably email-domain provisioning in `apps/api/src/settings/email-domains.ts`) get folded into the same action layer with async SES via Inngest. We close a focused set of mutator gaps (`ticket.resolve`, `ticket.markInProgress`, `message.update`, `message.delete`) so the public surface ships complete. **Bulk operations are deliberately deferred to v2** — the hidden complexity (partial failure, per-row permissions, audit explosion, idempotency-across-rows) is not worth the surface area in v1.

---

## 0a. Phase A — shipped (2026-05-05)

All nine Phase-A items from §14 are landed. The codebase ships:

- **Better Auth API Key plugin** confirmed and configured (`apps/api/src/auth.ts`). Plugin owns the `apikey` table; we add `principal_kind` / `principal_id` columns for clean Zero-side filtering.
- **`member.kind`** column (`user` | `service_account`, default `user`) — migration 0010, threaded through `AuthData` / `AuthContext` / mutators.
- **`auditEvent.actorKind`** column shipped + populated by every audit-emitting mutator via `auditActorKind()` in `packages/mutators/src/auth.ts:25`.
- **Bearer middleware** (`apps/api/src/middleware.ts:79-181`) recognises `slv_pat_*` and `slv_svc_*`, verifies via `auth.api.verifyApiKey`, populates `c.var.auth` with `principalKind` and `scopes`.
- **Token write endpoints** at `/api/settings/api-tokens` (POST create, DELETE revoke) and `/api/settings/service-accounts` (POST create, DELETE delete). Reads removed — see deviation note below.
- **`/v1/_meta/whoami`** smoke route — bearer-only, echoes `{ userId, email, workspaceId, role, principalKind, memberId, apiKeyId, scopes, requestId }` with the `X-Request-Id` header.
- **`Settings → Developer → API tokens`** UI — reactive Zero queries, optimistic updates, `<SettingsSheet>` create flow, scope checkboxes, copy-guide-compliant.
- **`idempotency_record`** table + **`withIdempotency()`** executor wrapper (`apps/api/src/public-api/middleware/idempotency-store.ts`). Unit-tested against the real DB for fresh / replayed / mismatch / executor-failure / concurrent paths. Not yet wired to a real action — that happens in Phase D.

**Deviations from the v2 plan worth knowing for Phase B+:**

1. **Token reads went through Zero, not REST.** §14-A4 said list endpoints would stay until Phase D. They don't — `apikey` was added to the Zero schema (excluding the `key` hash and raw permission/metadata text), and three workspace-scoped queries replaced the GETs: `apiTokensForCurrentUser`, `serviceAccounts`, `serviceAccountTokens`. This matches the `frontend.md` "everything driven by Zero" rule.
2. **Both create flows do direct `apikey` insert**, not `auth.api.createApiKey`. The plugin enforces an org-admin-role check on the `userId` we pass — fine for PATs but blocks setting our `principal_kind`/`principal_id` columns and impossible for service-account synthetic users (which we deliberately keep at `member.role='member'`). Direct insert uses the plugin's exported `defaultKeyHasher` so `verifyApiKey` finds the rows.
3. **Idempotency schema is the simpler shipped shape**, not the slimmed/partitioned design in §6.4. We kept `response_body jsonb` and a btree index on `created_at` (no daily partitioning, no `resource_kind`/`resource_id`). Volume is zero today; the partition migration is a Phase-B+ optimisation when first action wires up `withIdempotency`. See §6 update.
4. **PAT prefix `slv_pat_` / service prefix `slv_svc_`** wired through Better Auth's `defaultPrefix` and our middleware's `tokenLooksLikeOpendeskApiKey()` — both prefixes accepted and resolved to the right principal.
5. **`apikey` is a Zero table now** (schema version bumped 7 → 8). `member` got a `createdAt` column added so service-account ordering works.

**What's left for Phase B** — see §14. Mutator gaps next: `ticket.resolve`, `ticket.markInProgress`, `message.update`, `message.delete`. Tested at the API layer end-to-end (sign-up → org → PAT → whoami → revoke → 401, plus service-account flow, plus cross-user isolation, plus expired-token rejection, plus idempotency-store unit behaviour). Web app type-checks, builds, and Phase A surface UI is shipped behind `Settings → Developer → API tokens`.

---

## 1. Goals and non-goals

**Goals**

- Every UI-reachable operation — ticket CRUD, replies, notes, tags, custom fields, customers, views, settings (email channels, addresses, routing rules, custom fields, tags) — is reachable via a stable HTTP API, a CLI, and an MCP tool.
- Public surface is versioned (`/api/v1`), documented (OpenAPI generated from contracts), and decoupled from Zero's wire protocol so we can change Zero without breaking integrations.
- AI agents can call the platform safely: explicit auth principal, scope enforcement, idempotent retries, and an audit trail that distinguishes humans from agents.
- Single source of truth for write logic. Public API and web app run the same authoritative server-side mutator code; outbound side-effects (email send, Inngest fan-out) fire correctly regardless of caller.

**Non-goals (for v1)**

- A Node-side Zero replica or headless Zero client. External callers do request/response, not realtime sync.
- Outbound webhooks. The schema does not yet have a webhook subscriptions table; this is a v2 feature.
- Fine-grained per-action scopes. v1 ships coarse scopes (`tickets:write`); fine scopes (`tickets.assign`) come later if needed.
- Non-workspace scoped tokens (org-level admin tokens). v1 is workspace-bound only.
- A hosted MCP. v1 ships local stdio MCP; remote HTTP-SSE MCP is v2.

---

## 2. Current state — what the codebase already gives us

The audit found that the foundation is in better shape than it looks at first glance.

### 2.1 Mutator surface — already transport-agnostic

All write logic lives in `packages/mutators/src/` and is registered in `packages/mutators/src/index.ts:164`:

```
mutators = defineMutators({
  tagGroup:      { create, update, archive, restore },
  tag:           { create, update, archive, restore, attachToTicket, detachFromTicket,
                   replaceOnTicket, attachToCustomer, detachFromCustomer },
  customField:   { create, update, archive, setValueOnTicket, setValueOnCustomer,
                   clearValueOnTicket, clearValueOnCustomer },
  customer:      { update },
  customerNote:  { create, update, delete, togglePin },
  view:          { create, update, archive, restore, hide, unhide, reorder, duplicate },
  ticket:        { create, update, assign, snooze, close, reopen },
  message:       { send },
});
```

Every mutator has the signature `(tx, args, ctx: AuthData) => Promise<...>`. They use Zod for input validation and `assertHasWorkspace`/`assertCanRead*`/`assertCanModify*` from `packages/mutators/src/auth.ts` for permission checks. They are pure with respect to Zero — nothing is browser-specific.

### 2.2 Server mutator wrappers — critical for correctness

`apps/api/src/server-mutators.ts:37` wraps the shared mutators with server-only post-commit work:

- **`message.send`** appends a `postCommitTask` that inserts an `outbound_message` row and dispatches `DELIVERY_EVENT.MESSAGE_REQUESTED` to Inngest. Skipping this wrapper means email never goes out.
- **`customField.setValueOnTicket` / `setValueOnCustomer`** add reference validation (agent-membership, customer/ticket existence in workspace).

**Implementation rule (non-negotiable):** the action executor must call the *server* mutator, not the bare shared mutator. Public writes that bypass `createServerMutators()` are silently broken — they look fine in tests but produce no real-world side-effects.

### 2.3 Read surface

`packages/zero-schema/src/queries.ts:211` exports named queries (`ticketByID`, `customerList`, `ticketsForView`, etc.). All are workspace-scoped via `applyWorkspaceScope` at `packages/zero-schema/src/queries.ts:98`. They're defined with rocicorp's `defineQuery()` and depend on a Zero replica context.

For the public API we cannot reuse them directly — the replica isn't there. We have three options:

1. Reimplement equivalent reads as Drizzle queries (`packages/db`).
2. Have the executor open a server-side `zero-cache` query session per call (heavy).
3. A hybrid: factor the *predicate construction* out of `queries.ts` into a shared filter-builder that both Zero and Drizzle can consume.

Recommendation: option 1 for v1 (simple, predictable), with the filter-builder split (option 3) as a follow-up if duplication becomes painful.

### 2.4 Existing HTTP routes

`apps/api/src/server.ts:134` already mixes:

- Better Auth routes (`/api/auth/*`)
- Zero protocol endpoints (`/api/zero/mutate`, `/api/zero/query`) — JWT-cookie-authed
- Direct Hono handlers for files (`/api/files/*`), search (`/api/search`), customer events (`/api/customers/:id/events`), and email settings (`/api/settings/email/**`)
- Webhooks (`/api/inbound/email/*`, `/api/webhooks/ses`)
- Inngest dispatch (`/api/inngest`)

The auth middleware (`apps/api/src/middleware.ts:86`) reads the `opendesk-jwt` cookie and populates `c.var.auth = { sub, workspaceID, role }`. There is no token-bearer path today.

### 2.5 The settings bypass

`apps/api/src/settings/email-domains.ts:109` writes domain/address/routing-rule rows via direct Drizzle SQL, not through mutators. That code is correct but lives outside the action surface, and replicating its logic in v1 is part of the work — see §10.

### 2.6 What's missing

Status as of 2026-05-05 — Phase A is in.

| Item | Status |
|---|---|
| Programmatic auth (API keys / service accounts) | ✅ Phase A — Better Auth API Key plugin + `member.kind` + bearer middleware |
| `agent` principal in audit log | ✅ Phase A — `auditEvent.actorKind` + `auditActorKind()` helper |
| Idempotency primitive | ✅ Phase A — `idempotency_record` + `withIdempotency()` (not yet wired to actions) |
| `ticket.resolve`, `ticket.markInProgress` | ⏳ **Phase B** |
| `message.update`, `message.delete` | ⏳ **Phase B** |
| Bulk operations | ❌ v2 (see §9.1) |
| Outbound webhooks | ❌ v2 |

---

## 3. Architectural decision

Four options were considered:

1. **Expose `/api/zero/mutate` publicly.** Rejected. The Zero push protocol uses `clientGroupID`/`mutationID` for idempotency, owned by `zero-cache`. External callers fabricating those IDs would race with real clients. It also leaks protocol details, makes versioning hard, and gives terrible CLI ergonomics.
2. **Hand-roll REST endpoints over the existing mutators.** Workable short-term, but every transport (REST, CLI, MCP) duplicates input parsing, auth, scopes, and idempotency logic. Settings still bypass mutators. Ages badly.
3. **Canonical action registry, with REST/CLI/MCP as adapters. ✅ Recommended.** One contract per operation, generated transports.
4. **Let external callers run their own Zero clients.** Useful far in the future for first-party realtime agents. Not the default public API — request/response is what 95% of integrations want.

**Decision: option 3.**

The action layer becomes the single source of truth for "what does this app do?" REST routes, CLI commands, and MCP tools all describe themselves by reading the action registry. OpenAPI ships generated from the registry. CLI/MCP help text comes from the same Zod schemas.

```
                        packages/action-contracts
                        (action IDs, Zod I/O, scopes, idempotency, audit)
                                      │
                        packages/action-executor (server-only)
                                      │
                ┌─────────────────────┼─────────────────────┐
                │                     │                     │
        apps/api/public-api    apps/cli (via         apps/mcp (via
        /api/v1/** (Hono)      packages/api-client)  packages/api-client)
                │
        packages/api-client
        (typed fetch client; CLI + MCP both use it remotely)
```

Web client unchanged. It still uses Zero, mutators run in `PushProcessor`, the local replica works the same.

---

## 4. The action contract

This is the core abstraction. Every operation declares itself once:

```ts
// packages/action-contracts/src/types.ts

export interface ActionContract<I extends z.ZodTypeAny, O extends z.ZodTypeAny> {
  id: string;                    // e.g. 'tickets.reply'
  summary: string;               // one-line description, used in OpenAPI + MCP + CLI help
  inputSchema: I;
  outputSchema: O;
  scopes: readonly Scope[];      // e.g. ['tickets:write']
  idempotency: 'required' | 'optional' | 'none';
  auditEventKind?: AuditEventKind;
  // Cosmetic / documentation hints
  rest: {
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    path: string;                // e.g. '/tickets/:id/replies'
    pathParams?: readonly string[];
  };
  cli?: {
    command: readonly string[];  // e.g. ['tickets', 'reply']
    positionals?: readonly string[];
    examples?: readonly string[];
  };
  mcp?: {
    toolName: string;            // e.g. 'opendesk.tickets.reply'
    destructive?: boolean;       // surfaces a model-side warning hint
    composite?: boolean;         // not a 1:1 mutator wrap
  };
}

export type ActionInput<C>  = C extends ActionContract<infer I, any> ? z.infer<I> : never;
export type ActionOutput<C> = C extends ActionContract<any, infer O> ? z.infer<O> : never;
```

A separate registry maps `id → executor`:

```ts
// packages/action-executor/src/registry.ts

export type Executor<C extends ActionContract<any, any>> = (
  ctx: ExecutorCtx,                    // { db, auth: AuthData, idempotencyKey?, requestId }
  input: ActionInput<C>,
) => Promise<ActionOutput<C>>;

export const executors: { [id: string]: Executor<any> } = {
  'tickets.reply': replyExecutor,
  'tickets.create': createTicketExecutor,
  // ...
};
```

**Executor authoring rules**

- Writes: open a Drizzle transaction, call the matching server mutator from `createServerMutators()` (so post-commit Inngest tasks fire), return canonical post-write state read inside the same transaction.
- Reads: hand-rolled Drizzle query against the workspace-scoped row set. Pagination defaults to `limit=50`, max `200`.
- Auth: the executor relies on `ctx.auth` populated by middleware; permission helpers from `packages/mutators/src/auth.ts` are reused (they're already transport-agnostic).
- Idempotency (where required): wrap the executor with a middleware that checks `(workspaceID, idempotencyKey, action.id)` against a dedup table — see §6.

**Why a separate registry + contracts package**

Putting executors in `apps/api/src/actions/` is fine if we never want CLI or web to import the *contracts* without dragging in the server. Splitting `packages/action-contracts` (lightweight: Zod schemas + metadata) from `packages/action-executor` (heavy: DB, mutators, server logic) lets the API client and CLI re-use schemas for input parsing and validation locally, without pulling in `pg` or Drizzle.

---

## 5. Auth model

### 5.1 Two principal types

- **Personal access token (PAT).** Belongs to a real `member`. Audit events read `actor=user:<id>`.
- **Service account token.** Belongs to a synthetic `member` row marked `kind='service_account'`. Audit events read `actor=service:<id>`. Created and managed by workspace admins; named (`agent: triage-bot`).

Both look like `slv_pat_…` / `slv_svc_…` to clients (prefix lets us tell at a glance and helps secret-scanners).

### 5.2 Storage — shipped via Better Auth `apikey`

We use Better Auth's `apikey` table with two columns added on top: `principal_kind` and `principal_id`. The plugin's `references: 'organization'` config sets `referenceId = workspaceID`, hashing is `base64url(sha256(plaintext))` via the plugin's exported `defaultKeyHasher`, and it manages `enabled` / `expiresAt` / `lastRequest` / per-key `rateLimitMax` for free.

Effective columns we read on the client (Zero-mirrored, hash excluded):

```
apikey (
  id, referenceId AS workspaceID, name, prefix, start,
  enabled, expiresAt, lastRequest, createdAt,
  principal_kind ('user' | 'service_account'), principal_id
  -- not exposed: key (hash), permissions (raw JSON), metadata (raw JSON)
)
```

Plaintext is shown once on create; never returned by any read path. The plugin's `permissions` JSON parses to scopes via `scopesFromPermissionStatements()` in `apps/api/src/public-api/scopes.ts`.

The custom `api_token` schema described in earlier drafts of this RFC was not built — the plugin's table covers what we need with much less code.

### 5.3 Scopes (v1, coarse)

```
tickets:read    tickets:write
customers:read  customers:write
views:read      views:write
settings:read   settings:write
settings:email:write
```

Each action declares the scopes it requires. Middleware rejects with 403 if missing.

### 5.4 Better Auth API Key plugin — confirmed (Phase A)

Spike landed: the plugin's permissions/scopes/expiry/revocation model fits. Configuration in `apps/api/src/auth.ts`: `references: 'organization'`, `defaultPrefix: 'slv_pat_'`, `enableMetadata: true`, rate limit `60/min`, `keyExpiration: { defaultExpiresIn: null, minExpiresIn: 1, maxExpiresIn: 365 }`, `startingCharactersConfig.shouldStore: true` (12 chars → `start` column for the UI's last-4-style display).

Two things we don't use the plugin for and instead do ourselves:
1. **Inserting key rows** for both PATs and service accounts — direct insert with `defaultKeyHasher`. Reason: the plugin enforces an org-admin-role check on the `userId` we pass; service-account synthetic users are deliberately `member.role='member'`, and we want full control over the `principal_kind`/`principal_id` columns we added. `verifyApiKey()` finds these rows the same way it finds plugin-created ones (same hash, same column layout).
2. **Reading the list of tokens** — we use Zero queries (`apiTokensForCurrentUser`, `serviceAccounts`, `serviceAccountTokens`) instead of `auth.api.listApiKeys`. Workspace-scoped via `applyWorkspaceScope`, principal-scoped via the `principal_kind`/`principal_id` columns.

`auth.api.verifyApiKey({ body: { key: token } })` is what the bearer middleware calls per request — that's working as expected.

### 5.5 Middleware

Add a path through `apps/api/src/middleware.ts` that recognises `Authorization: Bearer slv_*` and resolves to the same `c.var.auth` shape (`{ sub, workspaceID, role, scopes? }`). Cookie path stays for the web app. Middleware order: bearer → cookie → unauthenticated.

`role` for a service account is `agent` (or a new `service` role if we want to lock service accounts out of certain admin actions). Recommendation: ship as `agent` for v1, gate destructive workspace-level admin actions on `principalKind != 'service_account'` if needed.

### 5.6 CLI auth flow

**v1: paste-token flow.** Faster to ship and dead-simple to debug:

1. User goes to `Settings → API tokens` in the web app, clicks `Create personal access token`, names it (e.g. "laptop-cli"), picks scopes, hits create.
2. UI shows the full `slv_pat_…` token *once*, with a "copy" button.
3. User runs `opendesk login`. CLI prompts: `Paste your token:` (input is masked).
4. CLI writes `~/.config/opendesk/auth.json` (`{ token, workspaceId, apiBaseUrl }`).
5. `opendesk whoami` confirms.

CI: `OPENDESK_TOKEN` env var takes precedence; no login step needed.

**Future (v2 if needed): browser-handoff device flow.** `opendesk login` opens a browser to `/auth/cli/init?port=<local>`, the page POSTs a freshly-minted PAT back to `http://localhost:<port>/callback`. Standard Vercel/`gh` UX. We hold this back from v1 because it requires a `/auth/cli/init` page and a localhost-callback flow that's measurably more code; the paste flow is the same UX as Stripe and Resend's CLIs and works fine.

---

## 6. Idempotency

Agents retry. Without idempotency keys, network blips create duplicate tickets and double-send replies. This is **functional correctness, not logging** — but the storage design needs to keep DB cost bounded so it doesn't become a Postgres bloat problem.

### 6.1 What it's actually for

A small example. An agent calls `POST /v1/tickets/123/replies` with `Idempotency-Key: abc`. We send the email. The HTTP response gets lost on the way back (timeout, gateway hiccup, whatever). The agent retries the same call. **Without** an idempotency record we'd send a second email — and the customer sees a duplicate. **With** one, we look up `(workspaceID, key=abc)`, find we already processed this, and return the original response without re-running the executor.

This matters most for externally-observable side effects: emails sent, payments charged, tickets created. For internal state changes that are naturally idempotent (e.g. "set status to closed" — running it twice has the same outcome) the cost-benefit is weaker.

### 6.2 Three things people get wrong about this

1. **"It's a log table."** It's not — logs we throw away; idempotency records gate writes. But the *storage shape* is logging-like, which is what makes the user's instinct correct that we should be careful.
2. **"It needs to store the full response."** Stripe does, but only because their responses are ground truth. We don't have to — if a retry hits, we can re-derive the canonical state by reading the affected row(s). This shrinks each record by ~80%.
3. **"It needs a forever-history."** It doesn't — 24h is the standard window because that's longer than any reasonable retry chain. After 24h the record is dead weight.

### 6.3 Volume math

Worst-case theoretical: 60 req/min rate limit × write-fraction × required-fraction.

- 60 rpm × 60 min × 24 hr = 86,400 req/day per fully-saturated token.
- Write actions that *require* idempotency in the v1 matrix: 9 of 45 (`tickets.create`, `tickets.reply`, `tickets.note`, customer notes, view create, settings creates, …). Calls to optional/none-idempotency actions don't insert.
- Realistic write share: ~30%, with maybe half carrying a key. Steady-state: **~13K rows/day per fully-saturated token, max.**

At 1 token: ~13K rows × ~250B (with the slimmed schema below) = ~3.3 MB/day. 24h window = ~3.3 MB steady-state.

At 100 active tokens averaging 5 rpm (realistic, not saturated): ~36 MB steady-state.

Comparable to what Postgres absorbs without noticing — the `auditEvent` table will grow faster than this. Not a "Postgres-as-a-log-pipeline" scenario.

### 6.4 Storage schema — shipped (Phase A)

What's actually in the DB (`packages/db/src/schema/api.ts`, migration 0010):

```sql
CREATE TABLE idempotency_record (
  workspace_id     text         NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  action_id        text         NOT NULL,            -- e.g. 'tickets.reply'
  key              text         NOT NULL,            -- client-supplied UUID/ULID
  request_hash     text         NOT NULL,            -- sha256 of normalised input, base64url
  response_status  integer      NULL,                -- null while in-flight
  response_body    jsonb        NULL,                -- cached response for replay
  created_at       timestamptz  NOT NULL DEFAULT now(),
  updated_at       timestamptz  NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, action_id, key)
);
CREATE INDEX idempotency_record_created_at_idx ON idempotency_record (created_at);
```

Differences from the v2 design that was sketched here earlier:

- **PK is `(workspace_id, action_id, key)`**, not `(workspace_id, key)`. Cleaner per-action namespace; matches the §17 risk we already noted.
- **Response is stored in full** (`response_body jsonb`). The §6.4 v2 plan dropped this in favour of `(resource_kind, resource_id)` + re-derive on replay. We kept the full body because (a) the wrapper already handles replay correctly with it, (b) volume is zero today, and (c) re-derivation requires every action to declare which resource it produced — a complication we don't need yet. Worth revisiting if the table grows.
- **No partitioning.** A btree index on `created_at` is enough at v1 volume. Pruning is a nightly Inngest job that does a `DELETE … WHERE created_at < now() - interval '24 hours'`; if WAL churn becomes visible we switch to daily partition-drop without changing the wrapper API.

The wrapper itself (`apps/api/src/public-api/middleware/idempotency-store.ts`) is the load-bearing piece — it uses `INSERT … ON CONFLICT DO NOTHING` to claim, reads back on conflict to detect mismatch / in-progress / replay, and on executor failure deletes the placeholder so retries can claim again. Stale-pending recovery (>60s) reclaims via CAS update. Concurrent same-key calls are tested.

### 6.5 Pruning — Inngest nightly DELETE for now

Single Inngest cron (`prune_idempotency_records`, to be added when first action wires up `withIdempotency`) does `DELETE … WHERE created_at < now() - interval '24 hours'` per workspace. At expected volume (see §6.3) the table sits at ~36 MB across 100 active tokens — VACUUM handles it.

Promote to daily-partitioned + drop-old-partition (the original §6.5 design) **only if** observed bloat / WAL pressure becomes a problem after Phase D wires up real action traffic. Defer until forced.

### 6.6 Contract

- `Idempotency-Key: <client-generated-uuid>` header on every write request.
- Required for actions where `idempotency: 'required'` (creates, sends, externally-observable side effects). Optional elsewhere — if the client doesn't send a key on an `optional` action, we don't insert anything.
- 24h dedup window.

### 6.7 Behaviour

- **First call:** insert row with `response_status=null` placeholder; run executor; update row with `resource_id` + `response_status`; return.
- **Second call same key:** if `request_hash` matches → re-fetch resource by `(resource_kind, resource_id)`, format response, return. If `request_hash` differs → 409 `idempotency_key_reused_with_different_request`.
- **Concurrent calls same key:** advisory lock on `(workspace_id, key)`; second waiter blocks until first commits, then reads.
- **Crashed first call (placeholder row, no resource_id):** treat as expired after 60s; second call can retry from scratch.

### 6.8 Reads

GETs are naturally idempotent and don't need keys.

### 6.9 Is this critical for functionality?

**Yes for `idempotency: 'required'` actions** (creates, replies, notes, view creates, settings creates) — without it, retries create duplicates. Real bug, customer-visible.

**No for `idempotency: 'none'`** — most reads, and writes that are naturally idempotent (close, reopen, snooze, assign — running them twice produces the same outcome).

**Optional for the middle group** — most updates and tags. The client can opt in by sending a key.

The right v1 cut: enforce keys on the ~9 `required` actions, allow them on the ~30 optional actions, skip them entirely on the ~6 naturally-idempotent ones. This keeps the table small without sacrificing the correctness guarantees that matter.

---

## 7. Audit and the agent principal — shipped (Phase A)

`auditEvent.actorKind` (`user` | `service_account`) shipped in migration 0010. Threaded through:

- `AuthData.principalKind` (`packages/zero-schema/src/schema.ts`) and `AuthContext.principalKind` (`apps/api/src/middleware.ts`).
- `auditActorKind(authData)` helper (`packages/mutators/src/auth.ts:25`) — every audit-emitting mutator (`ticket.*`, `customer.*`, `customField.*`, `tag.*`) calls it.
- The bearer middleware sets `principalKind` from the apikey row's `principal_kind` column; the cookie path defaults to `'user'`.

Audit-rendering surfaces (timeline, customer profile, settings activity log) don't yet filter or differentiate by `actorKind` — column carries correct data going forward; UI is a Phase 4 polish item, not a blocker.

---

## 8. REST API conventions

`/api/v1/**`. Hono routes generated programmatically from the contracts registry.

### 8.1 Naming

Resource-oriented. Actions on the resource are sub-paths (POST verbs, not GET):

```
GET    /v1/tickets
POST   /v1/tickets
GET    /v1/tickets/:id
PATCH  /v1/tickets/:id
POST   /v1/tickets/:id/replies
POST   /v1/tickets/:id/notes
POST   /v1/tickets/:id/assign         body: { assigneeId }
POST   /v1/tickets/:id/close
POST   /v1/tickets/:id/reopen
POST   /v1/tickets/:id/snooze         body: { until }
POST   /v1/tickets/:id/tags           body: { tagIds: [...] }      // add
PUT    /v1/tickets/:id/tags           body: { tagIds: [...] }      // replace
DELETE /v1/tickets/:id/tags/:tagId

GET    /v1/customers
GET    /v1/customers/:id
PATCH  /v1/customers/:id
POST   /v1/customers/:id/notes
POST   /v1/customers/:id/events       // already exists; fold into /v1

GET    /v1/views
POST   /v1/views
GET    /v1/views/:id
PATCH  /v1/views/:id
DELETE /v1/views/:id
GET    /v1/views/:id/tickets

POST   /v1/settings/email/domains
POST   /v1/settings/email/domains/:id/addresses
POST   /v1/settings/email/channels/:id/routing-rules
GET    /v1/settings/tags
POST   /v1/settings/tags
GET    /v1/settings/custom-fields
POST   /v1/settings/custom-fields
```

### 8.2 Headers

| Header | Direction | Notes |
|---|---|---|
| `Authorization: Bearer slv_…` | request | Required on all `/v1` routes |
| `Idempotency-Key: <uuid>` | request | Required on writes where `idempotency: 'required'` |
| `X-Request-Id` | request/response | Echoed; we generate one if absent |
| `X-Opendesk-Workspace` | request (optional) | Pin workspace explicitly; otherwise from token |

### 8.3 Pagination

Cursor-based, opaque cursors:

```json
{ "data": [...], "nextCursor": "eyJpZCI6...", "hasMore": true }
```

Query params: `?limit=50&cursor=…`. Default 50, max 200.

### 8.4 Errors

```json
{
  "error": {
    "type": "validation_error",
    "code": "ticket.assignee_not_in_workspace",
    "message": "Human-readable message",
    "field": "assigneeId",
    "requestId": "req_..."
  }
}
```

`type` is one of `validation_error | unauthorized | forbidden | not_found | conflict | rate_limited | internal_error`. `code` is stable, machine-readable, for client branching.

### 8.5 Versioning

URL-versioned (`/v1`). Breaking changes ship `/v2`. Deprecation: `Sunset` header + 6-month overlap.

### 8.6 Documentation

OpenAPI 3.1 generated from the action registry at build time. `apps/api/src/public-api/openapi.ts` walks the registry. Hosted at `/v1/openapi.json`.

---

## 9. Mutator gaps to close in v1

These ship as both new shared mutators (so the web app gets them too) and corresponding actions:

1. **`ticket.resolve`** — sets status to `resolved`, stamps `resolvedAt`, `resolvedByID`. Audit: `ticket.status_changed`.
2. **`ticket.markInProgress`** — sets status to `in_progress`. Audit: `ticket.status_changed`.
3. **`message.update`** — edits an existing message body (only by author, only within N minutes of creation, configurable). Audit: `message.edited`.
4. **`message.delete`** — soft-delete by author. Audit: `message.deleted`. Outbound delivery: if already sent, mark deleted on our side only.

Each lands as a separate PR before any action work, so the mutator registry is complete before we wrap it.

### 9.1 Bulk operations — deferred to v2

Earlier drafts proposed `tickets.bulk.close` / `bulk.assign` / `bulk.tag` for v1. **Deferred.** Bulk operations look simple but accumulate hidden complexity that's better thought through deliberately:

- **Partial failure semantics.** When 3 of 100 rows fail, do we commit the 97 successes and return per-row results, or roll back? Each choice has UX consequences (partial = users have to inspect a results array; all-or-nothing = "one bad apple" failures are common).
- **Per-row permission checks.** Auth helpers in `packages/mutators/src/auth.ts` are designed for single-row checks. Running them inside a bulk operation either does N lookups (slow) or skips per-row checks (unsafe).
- **Audit explosion.** A 100-row bulk close produces 100 `ticket.status_changed` events. That's correct but floods activity feeds; the right shape might be a single `ticket.bulk_status_changed` event with a list payload — which means a new audit kind, new renderers, new filters.
- **Idempotency across rows.** A retry of a bulk call that succeeded for 60 rows and failed for 40: do we re-attempt all 100, just the 40, or trust the idempotency key to dedupe at the bulk-call level? All three are defensible; none is obvious.
- **Side-effect amplification.** `bulk.close` for 100 tickets where some have queued outbound messages: do those send? Get cancelled? The single-row mutator answers this implicitly; bulk has to answer it explicitly.
- **Long-running calls.** 100 rows × ~30ms = 3s; at 500 rows, we're hitting HTTP timeouts and connection-pool pressure. Bulk wants async-job semantics (job ID, polling), which is a much bigger surface than "another action."

V1 callers can loop. The CLI and MCP can do this client-side cleanly (`for ticket in tickets: client.tickets.close(ticket.id)`); idempotency keys per call dedupe retries. If looping turns out to be unacceptable for real workflows, v2 introduces a proper batch-job action with a job-status table — a much more honest shape than a synchronous bulk endpoint.

---

## 10. Settings convergence

`apps/api/src/settings/email-domains.ts` writes domain/address/routing-rule rows directly via Drizzle, outside the mutator system. Three handlers; only one has an external API dependency:

| Handler | External calls | Shape |
|---|---|---|
| `handleEmailDomainAdd` | SES `CreateEmailIdentityCommand` + `PutEmailIdentityMailFromAttributesCommand` (~1-2s blocking) | mostly DB |
| `handleEmailAddressAdd` | none | pure DB |
| `handleEmailRoutingRuleUpsert` | none | pure DB |

**Decision: promote all three to mutators.** Use the same pattern as `message.send` — mutator writes the DB rows synchronously, server wrapper appends a `postCommitTask` that dispatches an Inngest event for any external work.

### 10.1 `settings.email.domain.create`

Today the SES call happens inline before the DB tx, so the response synchronously returns DKIM tokens. We restructure it the same way `message.send` works for outbound email:

1. **Mutator (sync, fast):**
   - Insert `sending_domain` with `dns_status='pending'` and `dkim_tokens=[]`.
   - Insert `channel` + `email_channel`.
   - Server wrapper appends `postCommitTask` → `DOMAIN_EVENT.PROVISION_REQUESTED`.
   - Returns `{ id, status: 'pending' }`.
2. **New Inngest function `provisionDomain`** (sibling of the existing `verifyDomain`):
   - Calls `CreateEmailIdentityCommand` + `PutEmailIdentityMailFromAttributesCommand`.
   - Writes `dkim_tokens` and flips `dns_status` (or a new `provision_status` column) to reflect completion.
   - On `AlreadyExistsException`: re-fetch tokens via `GetEmailIdentityCommand` and continue. Idempotent under retry.
   - On permanent failure after retries: set `provision_status='failed'` with an error; surface in UI.
   - Optionally chains to `DOMAIN_EVENT.VERIFICATION_REQUESTED` once tokens are written.

**What changes for callers:** today's response carries DKIM tokens; the new shape returns `{ id, status: 'pending' }` immediately and the client polls (or watches via Zero in the web app). The DNS-records UI shows "Provisioning..." for a beat, then renders the tokens when they arrive. This matches Vercel/GitHub-style async provisioning and removes the 1-2s request stall.

**Why this is better than keeping the inline SES call:**
- One pattern across the codebase for "DB write + external side-effect" — `message.send` and `domain.create` work the same way.
- Inngest handles transient SES failures via automatic retry. Today a single SES blip 500s the request.
- Mutator returns in <100ms instead of blocking on SES.
- Public API (`POST /v1/settings/email/domains`) and web UI use the same mutator, no drift risk.

Schema impact is small: one column (`provision_status` enum, or extending `dns_status` with `provisioning`/`provision_failed` values). One Drizzle migration.

### 10.2 `settings.email.address.create` and `settings.email.routingRule.upsert`

Pure DB writes today; trivial to lift into mutators with the existing `assert*` helpers from `packages/mutators/src/auth.ts`. No Inngest needed. The cross-table validation that `handleEmailRoutingRuleUpsert` does (assignAgent must be a workspace member) becomes an `assertCanAssignAgent` helper.

### 10.3 Migration plan

1. Land `provisionDomain` Inngest function and the `provision_status` column.
2. Add the three mutators to `packages/mutators/src/settings/email.ts`.
3. Wire server wrappers in `apps/api/src/server-mutators.ts` (only `domain.create` needs a `postCommitTask`).
4. Replace the bodies of `handleEmailDomainAdd`/`handleEmailAddressAdd`/`handleEmailRoutingRuleUpsert` with thin forwarders that call the mutator dispatcher — or, once the action executor exists, delete the Hono handlers and route the legacy `/api/settings/email/**` paths to it for backwards compat.
5. UI updates: domain-add flow becomes optimistic (write succeeds → status `pending` → DKIM tokens arrive via Zero subscription → DNS records render). Probably one component change.

---

## 11. CLI design

`gh`-style noun × verb tree. Commander.js or Citty (lighter; tree-shakable). Bundled via `tsdown` into a single Node binary distributed via npm.

### 11.1 Command shape

```
opendesk login                          # prompts: paste your slv_pat_… token
opendesk logout                         # clears ~/.config/opendesk/auth.json
opendesk whoami
opendesk workspace list
opendesk workspace use <slug>           # writes ~/.config/opendesk/config.json

opendesk tickets list [--view <id>] [--status open] [--assignee me] [--json]
opendesk tickets show <id>
opendesk tickets create --customer <email> --title <t> [--body <b>] [--priority p2]
opendesk tickets reply <id> --body-file reply.md [--internal]
opendesk tickets note <id> --body "..."
opendesk tickets assign <id> <userId|me|none>
opendesk tickets close <id>
opendesk tickets reopen <id>
opendesk tickets snooze <id> --until 2026-05-10
opendesk tickets tags add <id> <tag>...
opendesk tickets tags replace <id> <tag>...

opendesk customers list [--search …]
opendesk customers show <id>
opendesk customers update <id> --name "…"

opendesk views list
opendesk views show <id>
opendesk views tickets <id>            # paged tickets in that view

opendesk settings email domains list
opendesk settings email domains add <domain>
opendesk settings email addresses add <domain-id> <localPart>
opendesk settings tags list
opendesk settings custom-fields list

opendesk api <METHOD> <PATH> [--body @file.json]   # gh-style escape hatch
```

### 11.2 Output

- Default: human-pretty TTY tables (`cli-table3`).
- `--json`: stable JSON, same shape as REST response `data` field.
- `--jsonl`: line-delimited for streaming / piping.
- Detect `!isTTY || $CI` and default to JSON automatically.

### 11.3 Project context (deferred)

Like `gh`'s implicit repo, we could read `.opendesk/config.json` from cwd to set default workspace. Not needed for v1 — `opendesk workspace use` global default is enough.

### 11.4 Listen (deferred to post-v1)

`opendesk listen --ticket <id>` streaming SSE on Postgres `LISTEN`/`NOTIFY`. Stripe-style. High-leverage CLI feature but needs an event taxonomy decision (which events, what shape) — RFC follow-up.

---

## 12. MCP design

`@modelcontextprotocol/sdk` server. Local stdio transport for v1; remote HTTP-SSE in v2 if hosted MCP becomes a product.

### 12.1 Tools (curated, not 1:1)

Aim for ~20-25 intent-shaped tools, not one-per-mutator. Linear's MCP burns ~13k tokens at connect because of full-schema dump; we should not.

```
opendesk.tickets.search          (query, filters, view)
opendesk.tickets.get             (id) → full ticket + recent messages + customer
opendesk.tickets.create
opendesk.tickets.reply
opendesk.tickets.add_note
opendesk.tickets.assign
opendesk.tickets.set_tags
opendesk.tickets.close
opendesk.tickets.snooze

opendesk.customers.search
opendesk.customers.get
opendesk.customers.update

opendesk.views.list
opendesk.views.tickets

opendesk.settings.tags.list
opendesk.settings.custom_fields.list
opendesk.settings.email_domain.create
```

### 12.2 Composite tools

Beyond per-mutator wrappers, expose composite intent-level tools:

- `opendesk.tickets.triage(ticketId)` → returns suggested tags, suggested assignee, draft reply (LLM-side decision is the agent's; we just gather context).
- `opendesk.tickets.summarize_thread(ticketId)` → returns the conversation history packaged for summarization.

These are "view" composites — read-only assemblies. Write composites (e.g. "triage and act") are deliberately not provided in v1; we want the agent to make explicit individual write calls so audit attribution stays clear.

### 12.3 Resources

URI-addressable read-only data so agents can navigate without spending tool calls:

```
opendesk://ticket/<id>
opendesk://customer/<id>
opendesk://view/<id>
```

The MCP host fetches these on demand; the agent references them by URI in conversation.

### 12.4 Prompts

3-5 templated multi-step workflows, user-controlled (not auto-invoked):

- `triage-inbox` — walk the open queue, suggest disposition for each.
- `summarize-thread` — compact a long conversation for handoff.
- `draft-reply` — generate a reply draft given a ticket and tone.

### 12.5 Auth

OAuth-capable per the 2025-03-26 MCP spec, but for v1 ship simple: API token via `OPENDESK_TOKEN` env var, same scopes as REST. Local stdio means the user's local environment provides the token.

### 12.6 Safety

- Tools where `mcp.destructive=true` (close, delete-message, archive) include explicit warnings in their tool descriptions and return confirmation hints.
- Action executor enforces scopes regardless of MCP tool — if the token lacks `tickets:write`, the tool errors before any side-effect.
- Idempotency keys generated by the MCP server per tool call (UUID v4) so the agent can retry safely.

---

## 13. Package & file layout

```
packages/
  action-contracts/                    NEW
    src/
      types.ts                         ActionContract, ActionInput/Output
      scopes.ts                        Scope union, scopeImplies()
      registry.ts                      ALL_ACTIONS = [...]
      tickets.ts                       contracts: tickets.create, .reply, etc.
      customers.ts
      views.ts
      settings/
        email.ts
        tags.ts
        custom-fields.ts
    package.json                       deps: zod only

  action-executor/                     NEW
    src/
      registry.ts                      executors: { [actionId]: Executor }
      ctx.ts                           ExecutorCtx, transaction helper
      idempotency.ts                   middleware
      tickets.ts                       executor functions
      customers.ts
      views.ts
      settings/...
    package.json                       deps: action-contracts, mutators,
                                              server-mutators, db, drizzle

  api-client/                          NEW
    src/
      client.ts                        OpenDeskClient; auth, retry, request IDs
      tickets.ts                       client.tickets.create(), etc.
      customers.ts
      ...
      types.ts                         re-exports from action-contracts
    package.json                       deps: action-contracts, undici

  mutators/                            EXISTING — close gaps from §9 here
  zero-schema/                         EXISTING
  db/                                  EXISTING

apps/
  api/
    src/
      public-api/                      NEW
        index.ts                       mountPublicApi(hono)
        middleware/
          auth-bearer.ts               Authorization: Bearer slv_*
          scopes.ts                    requireScopes(actionContract)
          idempotency.ts               wraps executor calls
          errors.ts                    zod → 400; AppError → typed JSON
        routes/
          tickets.ts                   builds Hono routes from contracts
          customers.ts
          ...
        openapi.ts                     generate /v1/openapi.json
      services/                        NEW
        email-domains.ts               extracted from settings/email-domains.ts
      server-mutators.ts               EXISTING — gain entries for new mutators
      server.ts                        mounts publicApi alongside existing routes

  cli/                                 NEW
    src/
      bin/opendesk.ts                  entrypoint
      commands/
        tickets.ts
        customers.ts
        views.ts
        settings/
        api.ts                         escape hatch
      auth/
        login.ts                       paste-token prompt
        config.ts                      ~/.config/opendesk/auth.json
      output/
        format.ts                      tty table | json | jsonl
    package.json                       deps: api-client, citty, cli-table3

  mcp/                                 NEW
    src/
      server.ts                        MCP server bootstrap
      tools/
        tickets.ts
        customers.ts
        composite.ts                   triage, summarize_thread
      resources.ts                     ticket://, customer://, view://
      prompts/
        triage-inbox.ts
        summarize-thread.ts
        draft-reply.ts
    package.json                       deps: api-client, @modelcontextprotocol/sdk

  web/                                 EXISTING — unchanged
```

---

## 14. Sequencing

Eight phases. Each is independently shippable to `main`; the web app keeps working throughout.

### Phase A — Foundations ✅ shipped 2026-05-05

**A1. Auth backend — Better Auth API Key plugin.** ✅ Configured in `apps/api/src/auth.ts`. Plugin spike confirmed scopes/expiry/revocation/rate-limit all work. See §5.4 for what we keep the plugin for and what we do directly.

**A2. Service-account principal type.** ✅ `member.kind` column (`'user'` | `'service_account'`, default `'user'`) — migration 0010, threaded through `AuthData` and audit emission.

**A3. Token storage.** ✅ Better Auth's `apikey` table + our `principal_kind` / `principal_id` columns (migration 0011). Token format `slv_pat_<base64url>` for PATs, `slv_svc_<base64url>` for service accounts (~64-char body). Hashing: `defaultKeyHasher` from the plugin (`base64url(sha256(plaintext))`).

**A4. Token write endpoints.** ✅ `POST /api/settings/api-tokens`, `DELETE /api/settings/api-tokens/:id`, `POST /api/settings/service-accounts`, `DELETE /api/settings/service-accounts/:id` (`apps/api/src/public-api/api-tokens.ts`). Cookie auth (you don't mint tokens with a token). **Reads are NOT REST** — they go via Zero queries (see deviation #1 in §0a). Both create handlers do direct apikey-row inserts using the plugin's `defaultKeyHasher`; service-account creation does user + member + apikey in one transaction.

**A5. Token-management UI.** ✅ `/app/settings/api-tokens` (`apps/web/src/routes/app/settings.api-tokens.tsx`) — `useQuery(queries.apiTokensForCurrentUser)`, `useQuery(queries.serviceAccounts)`, `<SettingsSheet>` create flow with scope checkboxes, reveal dialog, optimistic updates. Settings nav has a `Developer` group with `API tokens` entry.

**A6. Bearer middleware.** ✅ `apps/api/src/middleware.ts:79-181`. Recognises `slv_pat_*` / `slv_svc_*`, calls `auth.api.verifyApiKey`, parses metadata to set `principalKind`, populates `c.var.auth` with `scopes` from the plugin's `permissions` JSON via `scopesFromPermissionStatements`. Cookie path unchanged. Order: bearer → cookie → unauthenticated.

**A7. `auditEvent.actorKind`.** ✅ Migration 0010. Populated by every audit-emitting mutator via `auditActorKind()` in `packages/mutators/src/auth.ts:25`.

**A8. `idempotency_record` + `withIdempotency()`.** ✅ Table at `packages/db/src/schema/api.ts`; wrapper at `apps/api/src/public-api/middleware/idempotency-store.ts`. Five integration-tested paths: fresh insert, replay (same hash), mismatch, executor-throws-and-cleans-up, concurrent-same-key. Schema differs from v2 sketch — see §6.4. Not yet wired to any route; happens in Phase D.

**A9. `/v1/_meta/whoami`.** ✅ Bearer-only smoke route, `apps/api/src/public-api/whoami.ts`. Returns `{ userId, email, workspaceId, role, principalKind, memberId, apiKeyId, scopes, requestId }`. Mounts `requestIDMiddleware` so `X-Request-Id` is always echoed.

**Ship checklist verified end-to-end:** sign up → create org → switch workspace → mint PAT in Settings → curl whoami with `Authorization: Bearer slv_pat_…` → get full auth context. Service-account tokens work the same way. Cross-user isolation tested (Bob can't see/revoke Alice's PAT, gets 404). Expired-token rejection tested (backdated `expiresAt`, 401). Bearer-only enforcement on whoami tested (cookie auth gets 401 with `auth.bearer_required` code). Idempotency-store unit-tested. Web app type-checks, builds, ships the new chunk at ~12 kB. Nothing user-facing breaks.

### Phase B — Mutator gap closures ⏳ active

1. **`ticket.resolve`** — sets status to `resolved`, stamps `resolvedAt` and `resolvedByID`. Audit: `ticket.status_changed` (or a new `ticket.resolved` kind — pick one).
2. **`ticket.markInProgress`** — sets status to `in_progress`. Audit: `ticket.status_changed`.
3. **`message.update`** — edits an existing message body, author-only, within N minutes of creation (configurable; suggest 15). Audit: `message.edited`. The web composer needs to expose this — small UI follow-up, not blocking the mutator.
4. **`message.delete`** — soft-delete by author (`deletedAt` column or status flag). Audit: `message.deleted`. If the outbound delivery already sent: leave the email at the customer; mark deleted on our side only and keep the row for audit.

**Author the mutators in `packages/mutators/src/`** the same way existing ones are written: Zod arg schema + `assertCanModifyTicket`/`assertCanModifyMessage` (write a message-author helper) + audit emit using `auditActorKind(authData)`. Server wrappers in `apps/api/src/server-mutators.ts` only if there's a side-effect (probably no — these are pure DB writes).

Ship: web app gets new affordances ("Resolve" button on ticket header, edit/delete on the message hover menu). Mutator registry is complete for v1. Bulk operations deferred to v2 (see §9.1).

### Phase C — Action contracts package (week 3)

9. Define `ActionContract` and friends in `packages/action-contracts`.
10. Author contracts for the v1 matrix (§17).
11. Zero executors yet; just types + Zod schemas.

Ship: type-only package. Imported by future code.

### Phase D — Action executor + first slice of REST (week 3-4)

12. `packages/action-executor` skeleton + `ExecutorCtx`.
13. Executors for `tickets.*` actions wrapping `createServerMutators()`.
14. `apps/api/src/public-api` boots; mounts `/v1/tickets/**`.
15. OpenAPI generator stub.

Ship: `/v1/tickets/**` is live. Internal users can curl it.

### Phase E — Remaining domains (week 4-5)

16. Customers, views, customer-notes, custom-field values executors + routes.
17. Settings: tags, custom-fields contracts.
18. Settings: email domain/address/routing — extract `services/email-domains.ts` and write thin executors over it (option (b) from §10).

Ship: `/v1/**` is feature-complete.

### Phase F — API client (week 5)

19. `packages/api-client` typed wrapper.
20. Auto-retry on 5xx + idempotency-key generation per write call.
21. Generated TS types from contracts.

Ship: an importable SDK. Internal teams can write integrations.

### Phase G — CLI (week 5-6)

22. `apps/cli` skeleton; login flow; `opendesk tickets list/show/create`.
23. Reply, note, assign, close, snooze, tags.
24. Customers, views, settings.
25. `opendesk api` escape hatch.
26. `--json`/`--jsonl`, TTY detection.
27. Distribution: `npm publish opendesk`.

Ship: public CLI.

### Phase H — MCP (week 6-7)

28. `apps/mcp` server with the curated tool list.
29. Composite read tools (`triage`, `summarize_thread`).
30. Resources + prompts.
31. Distribution: npm + `claude_desktop_config.json` instructions.

Ship: agents can drive opendesk.

### Post-v1

32. **Bulk operations as a proper batch-job system** (not synchronous bulk endpoints) — `tickets.bulk.close`/`assign`/`tag` return a `jobId`; a `job_status` table tracks per-row progress; `GET /v1/jobs/:id` polls. Avoids every pitfall in §9.1.
33. **Outbound webhooks** — new schema (`event_subscription` + delivery worker); HMAC-signed; retry with exponential backoff.
34. **`opendesk listen` SSE stream** on Postgres `LISTEN`/`NOTIFY` once event taxonomy is decided.
35. **Browser-handoff CLI auth** if paste-token UX becomes painful.
36. **Remote HTTP-SSE MCP** if hosted MCP becomes a product offering.
37. **Fine-grained scopes** (`tickets.assign` vs. `tickets:write`) if coarse ones prove insufficient in practice.

---

## 15. Initial action matrix (v1)

`I` = idempotency required, `o` = optional, `–` = none (read or naturally idempotent).

| Action ID | Method + Path | Scopes | Idem | Audit |
|---|---|---|---|---|
| `tickets.list` | GET /tickets | `tickets:read` | – | – |
| `tickets.get` | GET /tickets/:id | `tickets:read` | – | – |
| `tickets.create` | POST /tickets | `tickets:write` | I | `ticket.created` |
| `tickets.update` | PATCH /tickets/:id | `tickets:write` | o | `ticket.updated` |
| `tickets.assign` | POST /tickets/:id/assign | `tickets:write` | o | `ticket.assigned` |
| `tickets.snooze` | POST /tickets/:id/snooze | `tickets:write` | o | `ticket.snoozed` |
| `tickets.markInProgress` | POST /tickets/:id/in-progress | `tickets:write` | o | `ticket.status_changed` |
| `tickets.resolve` | POST /tickets/:id/resolve | `tickets:write` | o | `ticket.status_changed` |
| `tickets.close` | POST /tickets/:id/close | `tickets:write` | o | `ticket.status_changed` |
| `tickets.reopen` | POST /tickets/:id/reopen | `tickets:write` | o | `ticket.status_changed` |
| `tickets.reply` | POST /tickets/:id/replies | `tickets:write` | I | `message.sent` |
| `tickets.note` | POST /tickets/:id/notes | `tickets:write` | I | `message.note_added` |
| `tickets.message.update` | PATCH /tickets/:id/messages/:mid | `tickets:write` | o | `message.edited` |
| `tickets.message.delete` | DELETE /tickets/:id/messages/:mid | `tickets:write` | o | `message.deleted` |
| `tickets.tags.add` | POST /tickets/:id/tags | `tickets:write` | o | `ticket.tag_added` |
| `tickets.tags.replace` | PUT /tickets/:id/tags | `tickets:write` | o | `ticket.tag_added`/`removed` |
| `tickets.tags.remove` | DELETE /tickets/:id/tags/:tagId | `tickets:write` | o | `ticket.tag_removed` |
| `tickets.customField.set` | PUT /tickets/:id/custom-fields/:fieldKey | `tickets:write` | o | `ticket.custom_field_changed` |
| `customers.list` | GET /customers | `customers:read` | – | – |
| `customers.get` | GET /customers/:id | `customers:read` | – | – |
| `customers.update` | PATCH /customers/:id | `customers:write` | o | `customer.updated` |
| `customers.notes.create` | POST /customers/:id/notes | `customers:write` | I | `customer.note_created` |
| `customers.notes.update` | PATCH /customer-notes/:id | `customers:write` | o | `customer.note_updated` |
| `customers.notes.delete` | DELETE /customer-notes/:id | `customers:write` | o | `customer.note_deleted` |
| `customers.tags.add` | POST /customers/:id/tags | `customers:write` | o | `customer.tag_added` |
| `customers.tags.remove` | DELETE /customers/:id/tags/:tagId | `customers:write` | o | `customer.tag_removed` |
| `customers.events.ingest` | POST /customers/:id/events | `customers:write` | I | – |
| `views.list` | GET /views | `views:read` | – | – |
| `views.get` | GET /views/:id | `views:read` | – | – |
| `views.create` | POST /views | `views:write` | I | – |
| `views.update` | PATCH /views/:id | `views:write` | o | – |
| `views.delete` | DELETE /views/:id | `views:write` | o | – |
| `views.tickets` | GET /views/:id/tickets | `views:read`, `tickets:read` | – | – |
| `settings.tags.list` | GET /settings/tags | `settings:read` | – | – |
| `settings.tags.create` | POST /settings/tags | `settings:write` | I | – |
| `settings.tags.update` | PATCH /settings/tags/:id | `settings:write` | o | – |
| `settings.tags.archive` | DELETE /settings/tags/:id | `settings:write` | o | – |
| `settings.tagGroups.*` | … | `settings:write` | … | – |
| `settings.customFields.list` | GET /settings/custom-fields | `settings:read` | – | – |
| `settings.customFields.create` | POST /settings/custom-fields | `settings:write` | I | – |
| `settings.customFields.update` | PATCH /settings/custom-fields/:id | `settings:write` | o | – |
| `settings.customFields.archive` | DELETE /settings/custom-fields/:id | `settings:write` | o | – |
| `settings.email.domains.create` | POST /settings/email/domains | `settings:email:write` | I | – |
| `settings.email.addresses.create` | POST /settings/email/domains/:id/addresses | `settings:email:write` | I | – |
| `settings.email.routingRules.upsert` | POST /settings/email/channels/:id/routing-rules | `settings:email:write` | I | – |
| `settings.apiTokens.list` | GET /settings/api-tokens | `settings:read` | – | – |
| `settings.apiTokens.create` | POST /settings/api-tokens | `settings:write` | I | – |
| `settings.apiTokens.revoke` | DELETE /settings/api-tokens/:id | `settings:write` | o | – |

~45 actions. Realistic v1 surface. Bulk variants deliberately absent — see §9.1.

---

## 16. Decisions

### 16.1 Settled

1. **Auth backend — Better Auth API Key plugin.** ✅ Shipped. Plugin owns `apikey`; we add `principal_kind` / `principal_id` columns and do direct row inserts. See §5.4.
2. **Service accounts ship in v1.** ✅ Shipped. `member.kind`, `actorKind` on audit, `slv_pat_` / `slv_svc_` prefixes all live.
3. **Coarse scopes for v1.** ✅ Shipped. `API_SCOPES` enum in `apps/api/src/public-api/scopes.ts`. `requireApiScopes` middleware exists; will be wired to actions in Phase D.
4. **Email-domain provisioning — promote to mutators with async SES via Inngest.** ⏳ Deferred to Phase E (settings actions). Schema cost: one new `provision_status` column.
5. **CLI auth — paste-token flow.** ⏳ For Phase G. Settings UI is shipped (Phase A); CLI itself isn't.
6. **Bulk operations are NOT in v1.** Confirmed. See §9.1.

### 16.2 Working defaults (proceed unless flagged)

These were never blockers; the listed default carries unless someone objects during Phase A.

7. **Read implementation strategy.** Hand-rolled Drizzle queries in `packages/action-executor/src/reads/` for v1. Accept the duplication with Zero queries; revisit a shared filter-builder if duplication exceeds ~3 queries (§2.3 option 3).
8. **MCP transport — local stdio v1.** Each user runs the MCP server locally; auth via `OPENDESK_TOKEN` env var. Remote HTTP-SSE deferred to v2 if hosted MCP becomes a product.
9. **No composite write tools in MCP v1.** Read composites only (`triage`, `summarize_thread`). Write composites (`triage_and_act`) would obscure audit attribution; agents make individual write calls so each shows up cleanly in the audit log.
10. **OpenAPI schema published at `/v1/openapi.json`.** Generated from contracts at build time; CI fails if generated spec drifts from committed snapshot.
11. **Idempotency window — 24h.** Same as Stripe. Stored in `idempotency_record`; Inngest cron prunes nightly.
12. **Rate limits — per-token, 60 req/min default.** Configurable per token row (Better Auth plugin supports this if we go that route). Per-workspace ceiling deferred — start with per-token, add workspace-level if we see token-scattering abuse.

### 16.3 Items explicitly NOT decided here

- **Bulk job system shape (v2).** Job table schema, max parallelism, retry policy, partial-success rollup, and CLI/MCP UX for "submit job and watch it" all need their own RFC.
- **Outbound webhooks.** Schema, signing scheme, retry policy. Separate v2 RFC.
- **Event taxonomy for `opendesk listen`.** Which events, what payloads, how filterable. Separate post-v1 RFC.
- **Workspace admin actions over the API** (member invites, role changes, billing). v1 surfaces only support-domain operations; admin surface is its own design.

---

## 17. Risks and mitigations

- **Risk:** action layer becomes a thin pass-through that adds work without buying anything. **Mitigation:** require every action to declare scopes + idempotency policy; require executors to call server mutators (not bare ones). The forced declaration is the value.
- **Risk:** duplication between Zero queries and Drizzle reads. **Mitigation:** factor predicate construction into a shared helper if duplication exceeds ~3 queries. Don't pre-abstract.
- **Risk:** API contract drift over time. **Mitigation:** OpenAPI generated at build time; CI fails if generated spec doesn't match committed snapshot.
- **Risk:** MCP tool count balloons. **Mitigation:** cap at 25 tools for v1; new tools require RFC.
- **Risk:** idempotency key collision across actions. **Mitigation:** dedup table keyed on `(workspaceID, actionID, key)`, not just `(workspaceID, key)`.
- **Risk:** service-account permissions creep. **Mitigation:** ship coarse scopes only; admins can audit token scopes in settings.
- **Risk:** Better Auth plugin changes upstream. **Mitigation:** wrap behind our own thin interface; if the plugin shifts, swap the impl without touching callers.
- **Risk:** customers want bulk operations and looping client-side feels insufficient. **Mitigation:** v2 introduces a proper batch-job system (§9.1, §14 post-v1 #32). The cost of waiting is N HTTP calls per N rows, which is acceptable for the integration surfaces we see in v1; the cost of shipping bulk wrong is partial-failure UX bugs that haunt forever.
- **Risk:** paste-token CLI auth feels low-rent vs. `gh auth login`. **Mitigation:** measure adoption; if friction is real, ship the device flow as a v1.1 add-on — it's purely additive and doesn't break existing tokens.

---

## 18. What this RFC does not cover

- The `opendesk listen` event taxonomy (post-v1, separate RFC).
- Outbound webhooks schema and delivery worker (post-v1, separate RFC).
- Hosted MCP / multi-tenant remote MCP (v2).
- Fine-grained scopes (v2 if needed).
- Workspace-level admin actions (member invites, role changes, billing). v1 surfaces only support-domain operations.
- Internationalisation of error messages.
- Webhook signature verification helpers in `packages/api-client`.

---

## 19. Glossary

- **Action** — a single typed, scoped, idempotent operation. The unit of public API.
- **Action contract** — Zod schemas + metadata describing one action.
- **Action executor** — server-side function that runs an action against the DB.
- **Server mutator** — wrapped client mutator from `apps/api/src/server-mutators.ts` that adds post-commit side-effects.
- **Principal** — the actor. Either a user or a service account.
- **Scope** — a coarse permission like `tickets:write`. Tokens carry scopes.
- **Idempotency key** — client-generated UUID that lets the server dedupe retries.
- **Zero** — Rocicorp's sync engine. Runs the web client's local replica. Internal to the web app post-v1.

---

## 20. Appendix: example contract + executor

```ts
// packages/action-contracts/src/tickets.ts
export const ticketsReply = {
  id: 'tickets.reply',
  summary: 'Send a reply or internal note on a ticket.',
  inputSchema: z.object({
    ticketId: z.string().min(1),
    bodyHtml: z.string().min(1),
    bodyText: z.string().min(1),
    isInternal: z.boolean().default(false),
    attachments: z.array(attachmentRef).optional(),
  }),
  outputSchema: z.object({
    id: z.string(),
    ticketId: z.string(),
    createdAt: z.number(),
  }),
  scopes: ['tickets:write'] as const,
  idempotency: 'required',
  auditEventKind: 'message.sent',
  rest: { method: 'POST', path: '/tickets/:ticketId/replies' },
  cli:  { command: ['tickets', 'reply'], positionals: ['ticketId'] },
  mcp:  { toolName: 'opendesk.tickets.reply' },
} satisfies ActionContract<any, any>;
```

```ts
// packages/action-executor/src/tickets.ts
export const replyExecutor: Executor<typeof ticketsReply> = async (ctx, input) => {
  return ctx.tx(async (tx) => {
    const messageId = nanoid();
    await ctx.serverMutators.message.send.fn({
      tx,
      args: {
        id: messageId,
        ticketID: input.ticketId,
        bodyHTML: input.bodyHtml,
        bodyText: input.bodyText,
        isInternal: input.isInternal,
        attachments: input.attachments ?? [],
      },
      ctx: ctx.auth,
    });
    const row = await tx.query.message.findFirst({ where: eq(message.id, messageId) });
    return { id: row!.id, ticketId: row!.ticketId, createdAt: row!.createdAt };
  });
};
```

That's the model: contract declares the public shape, executor delegates to the server mutator. Three lines of REST/CLI/MCP wiring per action. Audit, scope, and idempotency are middleware.

---

End of RFC. Phase A is shipped (see §0a, §14). Phase B is the next pickup point — `ticket.resolve` / `markInProgress` / `message.update` / `message.delete` mutators per §9, then onward through C → H.
