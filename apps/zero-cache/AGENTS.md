# apps/zero-cache · AGENTS.md

Thin runner workspace whose only job is to invoke `zero-cache-dev` against `@opendesk/zero-schema`. Read root `AGENTS.md` first.

## What it does

The Zero sync server (`view-syncer` + `replication-manager`, single-node in dev) sits between browser clients and Postgres. It consumes Postgres logical replication, maintains per-client SQLite replicas with IVM-computed views, and pushes ZQL deltas to connected clients over WebSocket.

In dev: one `zero-cache-dev` Node process at `:4848`. In prod (Phase 6): containerized on Fargate per `/tmp/hello-zero-fresh/sst.config.ts`.

## Notable patterns

- This workspace has **no source code of its own** beyond a placeholder; it depends on `@opendesk/zero-schema` and runs the bundled `zero-cache-dev` CLI.
- Schema path passed via flag: `zero-cache-dev --schema-path ../../packages/zero-schema/src/schema.ts`.
- Replica file (`zero.db`) lives at the workspace root; gitignored. `pnpm dev:clean` (root script) deletes it.
- The mutator + query endpoints zero-cache calls live in `apps/api`. Configured via `ZERO_MUTATE_URL` and `ZERO_QUERY_URL`.

## Env

```
ZERO_UPSTREAM_DB=postgresql://opendesk:opendesk@127.0.0.1:5432/opendesk
ZERO_REPLICA_FILE=./zero.db
ZERO_AUTH_SECRET=<same as AUTH_SECRET in apps/api>
ZERO_PORT=4848
ZERO_QUERY_FORWARD_COOKIES=1
ZERO_MUTATE_FORWARD_COOKIES=1
ZERO_MUTATE_URL=http://127.0.0.1:3001/api/zero/mutate
ZERO_QUERY_URL=http://127.0.0.1:3001/api/zero/query
```

**Use `127.0.0.1`, not `localhost`** — `@hono/node-server` (in apps/api) binds IPv4 only and Node's fetch tries `::1` first. We hit `UND_ERR_SOCKET / ECONNREFUSED` until we corrected this.

## Gotchas hit

- `@rocicorp/zero-sqlite3` and `protobufjs` are native bindings. They must be in root `package.json`'s `pnpm.onlyBuiltDependencies` array or `pnpm install` won't compile them.
- `ZERO_AUTH_SECRET` is logged at startup as deprecated in favor of cookie-based auth + auth tokens. We're already on the cookie path; revisit at the next minor bump.
- Schema-format breaking changes between Zero versions require a full re-sync (delete `zero.db` and let it rebuild). Plan a 30-min "re-sync window" maintenance pattern in prod.
- Postgres logical-replication slots leak if you change `ZERO_APP_ID` mid-stream without releasing the old slot. Document a runbook before going to prod.

## Where to look

| File | What it is |
|---|---|
| `package.json` | The `dev` script + zero-cache deps |
| `.env` | Local env (gitignored) |
| `src/_keep.ts` | Placeholder so the workspace has a TS file |
| `../../packages/zero-schema/src/schema.ts` | The actual schema this serves |
