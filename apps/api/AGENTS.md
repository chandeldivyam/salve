# apps/api · AGENTS.md

Hono 4 server. Auth, JWT issuance, Zero server-mutators, file presign, webhooks (Phase 3+). Runs on `tsx watch` at `:3001` in dev. Read root `AGENTS.md` first.

## Endpoints

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
| `/api/inngest` (Phase 3) | Inngest function endpoint. |

## Notable patterns

- **Two-pass auth middleware** in `src/middleware.ts`: pre-`next()` resolves the better-auth session from request headers and stamps `c.var.auth`; post-`next()` re-resolves against any newly-set `Set-Cookie` so the very first sign-up/sign-in request emits our JWT cookie alongside better-auth's session cookie.
- **JWT issuance** (`src/jwt.ts`): HS256 with `AUTH_SECRET`. Same value is `ZERO_AUTH_SECRET` for zero-cache to verify. Claims: `{ sub, workspaceID, role, iat, exp }`. Cookie `jwt`, `HttpOnly`, `SameSite=Lax`, `Secure` only when `NODE_ENV=production`, 7-day expiry.
- **Workspace switch** re-issues JWT with refreshed claims after verifying `member` table for the target org.
- **Server-mutators** (`src/server-mutators.ts`): `defineMutators(clientMutators, { ... })` wrapping pattern from zbugs `server/server-mutators.ts:25-80`. Each override calls the shared client impl via `mutators.<ns>.<action>.fn({tx,args,ctx})`, then runs server-only post-commit logic such as Inngest dispatch. Delivery uses post-commit `inngest.send`, not an outbox poller.
- **Zero server adapter**: `zeroPostgresJS(schema, connectionString)` from `@rocicorp/zero/server`. We pass the connection string (not a constructed `postgres` client) to avoid driver-version-mismatch type clashes.
- **CORS**: `hono/cors` mounted on `/api/*` gated to `BETTER_AUTH_TRUSTED_ORIGINS` (comma-separated env). In dev, the Vite proxy makes this unnecessary; CORS only kicks in for prod cross-origin.

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
