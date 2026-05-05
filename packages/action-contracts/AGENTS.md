# packages/action-contracts · AGENTS.md

The single source of truth for every public action: input schema, output schema, scopes, idempotency, and the metadata that drives REST routes, CLI commands, MCP tools, and OpenAPI generation. Read root `AGENTS.md` and `guidelines/agent-platform.md` first.

## Layout

```
src/
├── index.ts          # public re-exports + ALL_ACTIONS aggregation
├── registry.ts       # ALL_ACTIONS array used by executor/cli/mcp/openapi
├── types.ts          # defineAction generic + helper types (ActionInput, ActionOutput)
├── scopes.ts         # SCOPES const + Scope type + scopeImplies()
├── meta.ts           # rest/cli/mcp metadata field types
├── openapi.ts        # OpenAPI generation from contracts (Zod → JSON Schema via z.toJSONSchema)
├── tickets.ts        # tickets.* actions
├── customers.ts      # customers.* actions
├── views.ts          # views.* actions
└── settings.ts       # settings.* actions (tags, custom fields, email domains)
```

## Notable patterns

- **Two id schemas per file.** `idSchema = z.string().min(1)` is for **output** nested ids we generate. `uuidSchema = z.string().uuid()` is for **input** user-supplied ids. Mixing them is the bug class that produces 500s instead of 400s — see post-H hardening 2026-05-05. Every new contract MUST use `uuidSchema` for inputs.
- **`defineAction(...)`** is the single constructor. It validates that `rest.pathParams` is a subset of input-schema required keys and returns a strongly-typed contract. Never construct contracts by object literal.
- **`scopes`** must be drawn from `scopes.ts`'s `SCOPES` array. Read scopes end in `:read`, write scopes in `:write`. The MCP `readOnlyHint` is auto-derived from "any scope ends in `:read`."
- **`idempotency`** values: `'none'` (reads only), `'optional'` (idempotent updates like resolve/close), `'required'` (creates with side-effects: send, ingest, dispatch). Required actions get a key minted client-side; optional actions can supply one.
- **`auditEventKind`** fires on success; the executor never calls audit emission directly.

## What metadata drives what

- `rest: { method, path, pathParams }` — drives `apps/api/src/public-api/<domain>.ts` route registration and OpenAPI doc.
- `cli: { command, positionals }` — drives the `apps/cli` verb tree. `command: ['tickets', 'resolve']` becomes `salve tickets resolve`. Required input keys not in `positionals` become `--flags`.
- `mcp: { toolName, destructive? }` — opt-in. Omit to hide from the MCP server. Convention: `salve.<namespace>.<verb>` with snake_case after the namespace (`salve.tickets.add_note`).

## OpenAPI

`openapi.ts` walks `ALL_ACTIONS`, runs each input/output schema through Zod 4's native `z.toJSONSchema()`, and produces a stable OpenAPI 3.1 doc served at `/v1/openapi.json`. Adding a new action automatically populates the doc — no manual yaml.

## Gotchas hit

- **`z.toJSONSchema()` is native to Zod 4**, not from a separate package. Pin `zod@4.x`. The MCP server uses the same call to build per-tool input schemas.
- **Don't add Zod refinements that JSON-Schema can't express** (custom `.refine(...)` callbacks) on input schemas without checking the MCP `compactInputSchema` output. Refinements still run server-side; they just won't appear in the tool manifest, which is acceptable.
- **Once an action `id` ships, never rename it.** It's keyed in `idempotency_record`, audit logs, and external integrations.
- **Output schemas should return the canonical resource**, not `{ ok: true }`. CLIs and MCP render the response; saving a follow-up GET is worth the bytes.

## Where to look

| File | What it is |
|---|---|
| `src/types.ts` | `defineAction` + `AnyActionContract` + helper generics. |
| `src/registry.ts` | `ALL_ACTIONS` aggregation; consumed by `@salve/action-executor` registry, `apps/cli`, `apps/mcp`, OpenAPI. |
| `src/scopes.ts` | Closed enum of allowed scope strings. |
| `src/openapi.ts` | OpenAPI doc generator. |
| `src/<domain>.ts` | The actual contract definitions per domain. |

Reference: `guidelines/agent-platform.md` §2 (contract anatomy) and §10 (common refactors).
