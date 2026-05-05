# apps/cli · AGENTS.md

The `salve` CLI. Auto-derives commands from `@opendesk/action-contracts` `cli` metadata + a small dispatcher for custom rendering. Built with `tsdown`; ships as a single `dist/salve.mjs`. Read root `AGENTS.md` and `guidelines/agent-platform.md` first.

## Layout

```
src/
├── bin/
│   └── salve.ts        # entrypoint — boot, dispatch, exit codes
├── auth/               # `salve login`, workspace selection, ~/.config/salve/{auth,config}.json
├── output/             # renderers per format (json, jsonl, pretty, yaml, table)
├── main.ts             # the dispatcher: maps argv → action → render
├── client.ts           # constructs SalveClient from env + auth files
├── args.ts             # custom flag parser (positionals + --flags + boolean negation)
├── error.ts            # formatError(): SalveApiError + ZodError + network failure → exit codes
├── io.ts               # stdout/stderr helpers, TTY detection
├── *.test.ts           # node native test runner
├── tsdown.config.ts    # build config (single ESM bundle)
└── package.json
```

## Notable patterns

- **Most commands are thin.** They read positionals + flags, call `client.<namespace>.<verb>(...)` (or `client.action(actionId, input)`), and hand the response to the right renderer. Adding a verb usually means adding metadata to the action contract and one branch to `main.ts` *only if* the response needs custom rendering (markdown, multi-table, etc.).
- **Output mode resolution** (in `output/mode.ts`): `--json` / `--jsonl` / `--pretty` / `--yaml` / `--table` flags win; otherwise `json` if stdout is not a TTY (pipe), `pretty` otherwise. `NO_COLOR=1` and `--no-color` disable ANSI.
- **Input parsing**: positionals come first, then `--key value` flags, then `--bool` / `--no-bool`. Custom — we don't use `commander`/`yargs` because they don't support TanStack-style nested verb trees cleanly.
- **JSON inputs to flags**: `--filter '{"status":"open"}'` is parsed as JSON loosely (single-quoted, double-quoted, or unquoted JSON-ish strings work). See `parseLooseJson` in `main.ts`.
- **Auth files** live at `~/.config/salve/{auth.json,config.json}` (override with `SALVE_CONFIG_DIR`). `auth.json` is mode 600; the loader rejects looser permissions. The MCP server reads the same files.
- **Idempotency**: `--idempotency-key <uuid>` overrides the api-client's auto-mint for `'required'` actions. Useful for replaying a known-good operation in support workflows.
- **Exit codes**: 0 = success; 1 = SalveApiError or ZodError (4xx-equivalent); 2 = network/transport failure or unknown error.

## Errors

`formatError(error)` (in `error.ts`) is the single rendering point:

- `SalveApiError` — one-line summary `(status type) [code]`, reason, optional `field`, `requestId`, hint from `hintForErrorCode` in `@opendesk/api-client`. Exit 1.
- `ZodError` — `validation_error (client-side)` header, then per-issue `path: message` lines, then a "fix the offending input and retry" tail. Exit 1.
- Network/transport failure (`fetch failed`, `ENOTFOUND`, etc.) — short message + check-`SALVE_API_URL`-and-network hint. Exit 2.
- Unknown error — `request.failed` + `String(error)`. Exit 2.

Don't add ad-hoc string-matching. New error types get a new branch in `formatError`.

## Tests

`pnpm --filter @opendesk/cli test` (Node native test runner via `tsx --test`):

- Argv parser (positionals, flags, booleans, negation, value extraction).
- Auth/workspace config: respects `SALVE_CONFIG_DIR`, enforces 600 permissions, round-trips correctly.
- Error formatter: all four branches (SalveApiError context, client-side ZodError, network failures, exit codes).
- Output mode resolver: TTY/pipe defaults, explicit-flag overrides, `NO_COLOR` / `--no-color`.
- JSONL row extraction for paginated responses.

When adding a verb that needs custom rendering, add a test next to `output/`.

## Build

`pnpm --filter @opendesk/cli build` produces `dist/salve.mjs` via `tsdown` — single minified ESM, ~52 KB gzipped. The `bin` field in `package.json` makes it `salve` after `pnpm link --global` or `npm install -g`.

For dev: `pnpm --filter @opendesk/cli dev <args...>` runs the source via `tsx`.

## Gotchas hit

- **`SALVE_API_URL` must be set in dev**, otherwise the client points at production (`https://api.usesalve.com`). Default `pnpm --filter @opendesk/cli dev login` against localhost requires `SALVE_API_URL=http://localhost:3001`.
- **Bash subshells don't persist `export VAR=...`** between separate `bash -c '...'` calls. Inline the env var on the command line for one-shots: `SALVE_TOKEN=… node dist/salve.mjs whoami`.
- **`zod@4.x`** is a runtime dep (the api-client's input validation throws `ZodError` instances; the CLI must instanceof-check them). Pin the same version as `@opendesk/api-client` so error formatting works.
- **Help output** is hand-curated in `main.ts` per command; when adding a verb, update the help string in the same PR.

## Where to look

| File | What it is |
|---|---|
| `src/main.ts` | Dispatcher + per-command branches + help text. The biggest file; keep branches short. |
| `src/error.ts` | The error formatter — the contract for what users see when things fail. |
| `src/client.ts` | Token resolution (env → `~/.config/salve/auth.json`), workspace resolution, base-URL normalization. |
| `src/auth/` | `salve login` flow, workspace selection. |
| `src/output/` | Pretty / JSON / JSONL / YAML / table renderers. |

Reference: `guidelines/agent-platform.md` §6 (CLI), §8 (errors).
