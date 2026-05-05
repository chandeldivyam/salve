# apps/mcp · AGENTS.md

The `salve-mcp` server. stdio MCP server that exposes every action contract with `mcp` metadata as a tool, plus three composite read-tools, three resource templates, and three workflow prompts. Read root `AGENTS.md` and `guidelines/agent-platform.md` first.

## Layout

```
src/
├── bin/
│   └── salve-mcp.ts        # entrypoint — boot, attach stdio transport, handle SIGINT
├── server.ts                # buildServer({context}): McpServer factory + registration
├── client.ts                # createClientContext(): resolves token + workspace, calls whoami
├── error.ts                 # mcpErrorResult / formatError: SalveApiError + ZodError + Error
├── types.ts                 # SalveMcpContext, SalveMcpAuth
├── server.test.ts           # in-memory transport harness, manifest size budget, annotation checks
├── tools/
│   ├── registry.ts          # auto-derive tools from ALL_ACTIONS.filter(a => a.mcp)
│   ├── describe.ts          # per-action prose descriptions (tuned for LLM ergonomics)
│   ├── execute.ts           # runActionTool: client.action(...) + structuredContent return
│   ├── schema.ts            # compactInputSchema: zod → JSON-Schema → compact zod
│   └── composite.ts         # salve.tickets.triage / summarize_thread / customers.context (markdown)
├── prompts/
│   └── registry.ts          # salve.{triage-inbox, summarize-thread, draft-reply}
├── resources/
│   └── registry.ts          # salve://ticket/{id}, salve://customer/{id}, salve://view/{id}
└── tsdown.config.ts         # single ESM bundle build
```

## Notable patterns

- **Auto-derive everything possible.** `tools/registry.ts` walks `ALL_ACTIONS.filter(a => a.mcp)` and registers a tool for each; annotations are derived from contract metadata. Adding an action to the MCP surface is a metadata change in `@salve/action-contracts`, not a code change here.
- **Annotations** map mechanically:
  - `readOnlyHint: true` ← any action scope ends in `:read`
  - `destructiveHint: true` ← `mcp.destructive === true` (close, delete, …)
  - `idempotentHint: true` ← `idempotency !== 'none'`
- **Token-budget discipline.** `tools/list` payload must stay under **16 KB** (the unit test asserts this). The `compactInputSchema` helper collapses Zod refinements that JSON-Schema can't express into the lowest-fidelity Zod type that still validates the JSON-Schema shape — server-side parsing still enforces the full schema, so refinements aren't lost. Don't fight this; just keep contract `summary` strings tight.
- **Composite tools** (`tools/composite.ts`) are handcrafted: `salve.tickets.triage`, `salve.tickets.summarize_thread`, `salve.customers.context`. They fan out 2–3 reads, format markdown, and stay under the per-tool token budget. Add a composite when an LLM would otherwise call 3+ read tools in series for the same data.
- **Resources** are URI templates with `list: undefined` so `resources/list` returns empty (per MCP spec) — clients fetch by id via `resources/read`. Use them when the agent needs the full canonical resource without paginating; tools when the agent needs a summary or to perform an action.
- **Prompts** are templated workflows. They guide an LLM through a sequence of tool/resource calls. Keep them short and free of hallucinated tool names (the unit test now lists all three by name; check there if you rename one).
- **Errors render through `formatError`** — `SalveApiError` → `(status type) [code] / Reason / Field / Request / Hint` lines; `ZodError` → header + `path: message` lines; bare `Error` → `request.failed / Reason`. Mirror the CLI's pattern.

## Auth resolution

`client.ts` resolves the bearer token in this order:

1. `SALVE_TOKEN` env var (set by host config).
2. `SALVE_TOKEN` env var (legacy).
3. `~/.config/salve/auth.json` (the CLI's `salve login` output).

Workspace id resolution:

1. `SALVE_WORKSPACE_ID` env var.
2. `~/.config/salve/config.json` (the CLI's `salve workspace use <id>` output).
3. The token's default workspace (resolved server-side).

The `SALVE_CONFIG_DIR` env var overrides the config root.

## Tests

`pnpm --filter @salve/mcp test` (Node native test runner via `tsx --test`):

- `tools/list` includes every action with `mcp` metadata + the three composites; manifest under 16 KB.
- Action tool invocation routes through `client.action(...)` with idempotency-key generation for `'required'` actions.
- Composite tools emit markdown with the expected headers; resources return JSON; prompts render templated text.
- Error formatter handles `SalveApiError`, `ZodError`, and bare `Error` correctly (with hint-table integration).

The harness uses `InMemoryTransport.createLinkedPair()` so the real `Client` drives the real `McpServer` — no mocks of MCP internals.

## Live testing

Build with `pnpm --filter @salve/mcp build` and exercise the binary against a running `apps/api`:

- Wire into Claude Desktop / Cursor / Cline by pointing `command: "node", args: [".../dist/salve-mcp.mjs"], env: { SALVE_TOKEN, SALVE_API_URL }`.
- For programmatic harnessing, spawn the bin via `StdioClientTransport({command, args, env})` and drive with the SDK's `Client`.
- Live test before declaring a phase done — every shipped phase has caught bugs the unit tests didn't.

## Build & distribution

`tsdown` produces `dist/salve-mcp.mjs` (~52 KB). `package.json` `bin` exposes it as `salve-mcp`. We bundle `@salve/*` workspaces (`alwaysBundle: [/^@salve\//]`) so the published artifact is self-contained.

The README documents Claude Desktop / Cursor / Cline configs. Future work (not done): publish to npm under `@salve/mcp` so `npx -y @salve/mcp` works out of the box.

## Gotchas hit

- **`tools/list` resource enumeration**: resource templates with `list: undefined` correctly return 0 from `resources/list`. Clients fetch by `resources/read` with a constructed URI.
- **Tool-name collisions**: don't double up on dotted/snake-case mixing within the same namespace. Convention is `salve.<namespace>.<verb_in_snake_case>`.
- **`compactInputSchema` is lossy on refinements**, but only on the manifest the LLM sees. The server still enforces the full Zod schema. Don't rely on tool-side validation for security; rely on the executor's `inputSchema.parse`.
- **stdio mode writes only protocol messages to stdout**. Logs and diagnostics go to stderr. The bin entrypoint stdouts nothing on startup; failures write to stderr and `process.exitCode = 1`.

## Where to look

| File | What it is |
|---|---|
| `src/server.ts` | The factory. Test harness passes a fake context; production resolves it via `client.ts`. |
| `src/tools/registry.ts` | The auto-derive surface — touch this when you change how *all* tools render. |
| `src/tools/composite.ts` | The handcrafted markdown tools — add new ones here. |
| `src/tools/schema.ts` | Zod ↔ JSON-Schema ↔ Zod round-trip. |
| `src/server.test.ts` | The patterns to mirror when adding tests. |

Reference: `guidelines/agent-platform.md` §7 (MCP), §8 (errors), §9 (testing).
