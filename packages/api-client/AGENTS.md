# packages/api-client · AGENTS.md

Typed JS/TS SDK for `/v1`. Powers the CLI, the MCP server, and any external integration that wants types instead of raw fetch. Read root `AGENTS.md` and `guidelines/agent-platform.md` first.

## Layout

```
src/
├── index.ts        # public exports: SalveClient, SalveApiError, hintForErrorCode, …
├── client.ts       # SalveClient: namespaced surface + low-level client.action(...)
├── fetch.ts        # fetchAction core: validation, idempotency-key minting, retries, error unwrap
├── errors.ts       # SalveApiError class (matches /v1 error envelope)
├── hints.ts        # hintForErrorCode() — shared advice strings consumed by CLI/MCP error formatters
├── pagination.ts   # listAll() helper — walks `{nextCursor, hasMore}` lists
├── types.ts        # SalveRequestOptions, action payload helpers, internal types
└── client.test.ts  # contract coverage + idempotency + retry semantics + error-envelope unwrap
```

## Notable patterns

- **Two ways to call.** Typed namespaced methods (`client.tickets.resolve(ticketId)`, `client.customers.search({…})`) for ergonomics, plus the escape hatch `client.action(actionID, input, options)` that takes any registered action without a per-method binding. CLI and MCP use the escape hatch by default; users prefer the namespace.
- **Idempotency keys are minted automatically** for any contract whose `idempotency === 'required'`. The minted key is reused across retries of the same call, which is what makes 5xx-retry safe.
- **Retries.** 5xx responses and network errors retry up to twice with exponential backoff. The reused idempotency key dedupes server-side. Don't add retry logic on top — it's already there.
- **Error envelope unwrap.** `{error: {type, code, message, requestId, field?}}` becomes a `SalveApiError`. Match on `error.code`, never on `error.message`.
- **Input validation runs client-side.** `contract.inputSchema.parse(input)` runs before the network call so a `ZodError` surfaces synchronously. CLI and MCP both have `ZodError` branches in their error formatters.
- **`baseUrl` may point at the API origin (`http://localhost:3001`) or the versioned root (`http://localhost:3001/v1`).** The client normalises either form. Default is `https://api.usesalve.com`.

## Hint table — single source of truth

`hints.ts` exports `hintForErrorCode(code: string): string | undefined`. The CLI formatter (`apps/cli/src/error.ts`), the MCP formatter (`apps/mcp/src/error.ts`), and any future SDK consumer all read from this table. **Never inline a hint string** in a formatter — add it here so all three surfaces stay consistent.

When you add an error code to a contract or executor, add a hint here in the same PR.

## Pagination

`listAll(client, listFn, params)` walks cursor-paginated endpoints. Accepts `{maxPages, perPage, signal}`. Use it for "give me everything" workflows (CLI export, full-corpus MCP context) rather than hand-rolling cursor loops.

## Versioning

The client's API is committed; renaming a public method without a deprecation cycle breaks every CLI/MCP build. Adding a new namespace method is additive and safe.

## Gotchas hit

- **Don't import `@opendesk/zero-schema` or `@opendesk/mutators` from this package.** It must be runnable in any Node environment without the Zero stack.
- **`SalveApiError.message` mutates over time** as we tweak server messages; only the `code` is contract.
- **Service-account vs PAT tokens.** The client doesn't care which prefix the bearer token has; the server differentiates. The CLI's `salve login` paths are user-PAT-only; service-account credentials get pasted as raw env vars in headless contexts.

## Tests

`pnpm --filter @opendesk/api-client test` (Node native test runner via `tsx --test`):

- Asserts every action contract has either a namespace method *or* falls through to `client.action`.
- Idempotency-key reuse across retries.
- 5xx retry behaviour.
- `baseUrl` accepting both `/` and `/v1` suffixes.
- Cursor-walking via `listAll`.
- Error envelope unwrap.

Add a test next to any new namespace method.

## Where to look

| File | What it is |
|---|---|
| `src/client.ts` | The public surface: namespace methods + `client.action(...)` escape hatch. |
| `src/fetch.ts` | The core. Don't duplicate this logic in CLI or MCP — call into it. |
| `src/hints.ts` | The shared error-hint table. |
| `src/client.test.ts` | The patterns to mirror when adding tests. |

Reference: `guidelines/agent-platform.md` §5 (api-client) and §8 (errors).
