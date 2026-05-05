# apps/api · AGENTS.md

Hono 4 server. Hosts (1) the **session-cookie API** at `/api/*` for the web app (auth, Zero server-mutators, files, Inngest, webhooks), and (2) the **public REST API** at `/v1/*` for external + agent consumers (CLI, MCP, integrations). Runs on `tsx watch` at `:3001` in dev. Read root `AGENTS.md`, `guidelines/architecture.md`, and `guidelines/agent-platform.md` first.

## Endpoints

### Session-cookie API (the web app)

| Path | Purpose |
|---|---|
| `GET /healthz` | Liveness. Returns `{status, service, version}`. |
| `GET /` | Hello-world fallback. |
| `/api/auth/*` | better-auth handler — sign-up/in/out, sessions, organization plugin. |
| `POST /api/auth/switch-workspace` | Verifies membership for target org, re-issues JWT with new claims. Mounted **before** the better-auth catch-all so it isn't shadowed. |
| `POST /api/zero/mutate` | Zero server-mutator entry — runs custom mutators with server context. |
| `POST /api/zero/query` | Zero custom-query entry — runs `defineQueries` server-side. |
| `POST /api/files/presign` | Returns presigned PUT URL to MinIO (dev) / S3 (prod). Mime allowlist + 25MB cap. Workspace-scoped key prefix. |
| `POST /api/files/get` | Returns presigned GET URL. Verifies caller's workspace prefix on the key. |
| `/api/inngest` | Inngest function endpoint. |

### Public REST API at `/v1/*` (CLI, MCP, integrations)

| Path | Purpose |
|---|---|
| `GET /v1/_meta/whoami` | Identifies the principal (user / service-account), workspace, role, scopes, requestId. Smoke-test endpoint. |
| `GET /v1/_meta/workspaces` | Lists workspaces visible to the token. |
| `GET /v1/openapi.json` | OpenAPI 3.1 doc auto-generated from action contracts (see `packages/action-contracts/src/openapi.ts`). |
| `/v1/tickets/*` | Ticket actions (list/get/create/update/assign/snooze/markInProgress/resolve/close/reopen/reply/note/message.{update,delete}/tags.{add,replace,remove}/customField.set). |
| `/v1/customers/*` | Customer actions + notes + events + custom fields + tags. |
| `/v1/customer-notes/*` | Note update/delete (notes have flat ids). |
| `/v1/views/*` | Saved views: list/delete + view-tickets pagination. |
| `/v1/settings/*` | Tag groups, custom-field defs, email-domain create. |

The `/v1` routers are mounted in `src/server.ts` (`app.route('/v1/<domain>', <domain>Router)`) and live in `src/public-api/<domain>.ts`. Each route is one `actionHandler(contract, executor, extractInput)` line — see `guidelines/agent-platform.md` §4.

## Notable patterns

### Session-cookie auth (`/api/*`)

- **Two-pass auth middleware** in `src/middleware.ts`: pre-`next()` resolves the better-auth session from request headers and stamps `c.var.auth`; post-`next()` re-resolves against any newly-set `Set-Cookie` so the very first sign-up/sign-in request emits our JWT cookie alongside better-auth's session cookie.
- **JWT issuance** (`src/jwt.ts`): HS256 with `AUTH_SECRET`. Same value is `ZERO_AUTH_SECRET` for zero-cache to verify. Claims: `{ sub, workspaceID, role, iat, exp }`. Cookie `jwt`, `HttpOnly`, `SameSite=Lax`, `Secure` only when `NODE_ENV=production`, 7-day expiry.
- **Workspace switch** re-issues JWT with refreshed claims after verifying `member` table for the target org.
- **Server-mutators** (`src/server-mutators.ts`): `defineMutators(clientMutators, { ... })` wrapping pattern from zbugs `server/server-mutators.ts:25-80`. Each override calls the shared client impl via `mutators.<ns>.<action>.fn({tx,args,ctx})`, then runs server-only post-commit logic such as Inngest dispatch. Delivery uses post-commit `inngest.send`, not an outbox poller.
- **Zero server adapter**: `zeroPostgresJS(schema, connectionString)` from `@rocicorp/zero/server`. We pass the connection string (not a constructed `postgres` client) to avoid driver-version-mismatch type clashes.
- **CORS**: `hono/cors` mounted on `/api/*` gated to `BETTER_AUTH_TRUSTED_ORIGINS` (comma-separated env). In dev, the Vite proxy makes this unnecessary; CORS only kicks in for prod cross-origin.

### Public REST API (`/v1/*`)

- **Bearer auth** via `src/public-api/middleware/bearer.ts`. Tokens come from better-auth's API-key plugin; we differentiate `slv_pat_…` (user PAT) vs. `slv_svc_…` (service account) by inspecting the `principal_kind` column we added to the `apikey` table.
- **Scope enforcement** via `requireApiScopes(contract.scopes)` middleware. The action contract declares scopes (`tickets:write`, etc.); the middleware checks against the token's granted scopes. Scope vocabulary lives in `packages/action-contracts/src/scopes.ts`.
- **Idempotency** is two-layered:
  - HTTP `Idempotency-Key` header → `idempotencyKeyMiddleware` extracts → `withIdempotency(...)` in `src/public-api/middleware/idempotency-store.ts` records the request hash and replays the response on retry. Mismatched body returns `409 idempotency_key.reused_with_different_request`. In-progress retries return `409 idempotency_key.in_progress`. Replays carry `Idempotency-Replayed: true`.
  - Resource-id derivation via `actionResourceID(ctx, actionID, suffix)` in `@opendesk/action-executor` produces a deterministic UUID so even unique-constraint collisions are recoverable.
- **`actionMiddlewares(contract)`** (in `src/public-api/action-route.ts`) returns the standard chain: `requestIDMiddleware` → `requireBearerAuth` → `requireApiScopes(contract.scopes)` → `idempotencyKeyMiddleware(contract.idempotency)`.
- **`actionHandler(contract, executor, extractInput, successStatus?)`** parses the body with `contract.inputSchema.safeParse`, routes to the executor, wraps in the idempotency store if applicable, and serializes the response. One-line per route.
- **Error mapping** in `src/public-api/errors.ts`: `PublicApiError`, `ActionExecutorError`, `MutationError`, `ZodError` each get a typed mapping; everything else falls to `500 internal_error` with the requestId logged. *Don't* swallow errors at the executor level — let them propagate; the handler maps cleanly.
- **OpenAPI** at `/v1/openapi.json` is auto-generated from action contracts via `packages/action-contracts/src/openapi.ts` (Zod 4's native `z.toJSONSchema`). Adding a contract automatically updates the doc.
- **Mutator runner** (`src/public-api/mutator-runner.ts`) is the bridge from action executors to Zero server-mutators. `ctx.runMutation('<ns>.<action>', args)` runs the same `defineMutators` code the web app does, including post-commit Inngest dispatch and audit emission. **Always go through this**, never raw `ctx.db.insert(...)` for domain tables.

For the full action-pipeline narrative see `docs/agent-platform-rfc.md`. For the build-an-action playbook see `guidelines/agent-platform.md`.

## Gotchas hit

- **`localhost` resolves to IPv6 `::1` first** but `@hono/node-server` binds IPv4 only. Use `127.0.0.1` for inter-process URLs in env vars (zero-cache → api). Cost us a debug session.
- **Catch-all route ordering**: `app.on(['GET','POST'], '/api/auth/*', ...)` swallows `/api/auth/switch-workspace`. Register custom routes **before** the catch-all.
- **`tsx` doesn't load `.env` automatically.** Dev script is `tsx watch --env-file=.env src/server.ts`.
- **better-auth + Hono response cookies**: better-auth returns its own `Response` from `auth.handler(...)`. Cookies set via `c.header()` *before* `next()` are lost. Mutate `c.res.headers` *after* `next()` to append our JWT cookie.
- **better-auth org plugin requires `Origin` header** on `organization/create`. The React client sends one automatically; curl tests need `-H 'Origin: http://localhost:5173'`.

## Env

`.env.example` documents the surface:

```
PORT=3001
DATABASE_URL=postgresql://opendesk:opendesk@localhost:5432/opendesk
AUTH_SECRET=<32-byte hex>
ZERO_AUTH_SECRET=$AUTH_SECRET                     # same value
BETTER_AUTH_URL=http://localhost:3001
BETTER_AUTH_TRUSTED_ORIGINS=http://localhost:5173 # comma-separated for prod
NODE_ENV=development
GOOGLE_CLIENT_ID=                                  # optional, gated
GOOGLE_CLIENT_SECRET=
```

Phase 3a adds `MAILER_BACKEND={mailpit|ses}`, SES region/webhook vars, and same-origin settings endpoints for email domains and addresses.

## Where to look

| File | What it is |
|---|---|
| `src/server.ts` | Hono entry; route mounting; CORS; auth + zero + files endpoints. |
| `src/auth.ts` | better-auth config (Drizzle adapter, email+password, magic-link, organization plugin, Google gated on env). |
| `src/jwt.ts` | HS256 issue/verify helpers + cookie builders. |
| `src/middleware.ts` | The two-pass auth middleware + `requireUser` / `requireWorkspace` guards. |
| `src/server-mutators.ts` | Server-side wrapping of `@opendesk/mutators`. |
| `src/files.ts` | S3/MinIO presign endpoints. |
| `src/inngest/events.ts` | Channel-agnostic Inngest event names and payload schemas. |
| `src/inngest/functions/` | Delivery, domain verification, webhook processing, and recovery functions. |
| `src/settings/email-domains.ts` | Email domain/address settings endpoints. |
| `src/webhooks/ses.ts` | SES SNS webhook intake. |
| `src/public-api/action-route.ts` | The `/v1` action handler factory: `actionMiddlewares` + `actionHandler` + `readJsonBody`. |
| `src/public-api/middleware/bearer.ts` | PAT / service-account bearer-token validation. |
| `src/public-api/middleware/scopes.ts` | Scope enforcement against `contract.scopes`. |
| `src/public-api/middleware/idempotency.ts` | Extracts `Idempotency-Key` header into `c.var.idempotencyKey`. |
| `src/public-api/middleware/idempotency-store.ts` | Record-and-replay layer keyed on `(workspaceID, actionID, key, requestHash)`. |
| `src/public-api/mutator-runner.ts` | The bridge from action executors to `defineMutators` (web parity). |
| `src/public-api/errors.ts` | Maps `PublicApiError`, `ActionExecutorError`, `MutationError`, `ZodError` to HTTP. |
| `src/public-api/<domain>.ts` | Per-domain Hono routers: tickets, customers, customer-notes, views, settings. |
| `src/public-api/whoami.ts` | `/v1/_meta/whoami` and `/v1/_meta/workspaces` smoke endpoints. |
| `src/public-api/openapi.ts` | `/v1/openapi.json` handler (delegates to contracts package). |
| `src/public-api/api-tokens.ts` | Internal helpers for the better-auth API-key plugin (PAT prefix, hashing). |
