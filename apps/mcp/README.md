# Salve MCP Server

Internal workspace package for the local `salve-mcp` server. It is published later as `@salve/mcp`, while the monorepo keeps the package under `@opendesk/mcp`.

The server uses stdio transport and writes protocol messages only to stdout. Diagnostics and startup failures go to stderr.

## Local Development

```sh
SALVE_TOKEN=slv_pat_... SALVE_API_URL=http://127.0.0.1:3001 pnpm --filter @opendesk/mcp dev
```

If `SALVE_TOKEN` is not set, the server falls back to the CLI auth file written by `salve login` at `~/.config/salve/auth.json`. It also reads `~/.config/salve/config.json` so the workspace selected by `salve workspace use` is honored. `SALVE_API_URL` overrides the production API origin.

## Claude Desktop

macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`

Windows: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "salve": {
      "command": "npx",
      "args": ["-y", "@salve/mcp"],
      "env": {
        "SALVE_TOKEN": "slv_pat_..."
      }
    }
  }
}
```

## Cursor

`~/.cursor/mcp.json`

```json
{
  "mcpServers": {
    "salve": {
      "command": "npx",
      "args": ["-y", "@salve/mcp"],
      "env": {
        "SALVE_TOKEN": "slv_pat_..."
      }
    }
  }
}
```

## Cline / Continue

Use the extension settings UI and add a stdio MCP server:

```json
{
  "command": "npx",
  "args": ["-y", "@salve/mcp"],
  "env": {
    "SALVE_TOKEN": "slv_pat_..."
  }
}
```

The server exposes Salve actions as MCP tools, read-only ticket/customer/view resources, and workflow prompts for triage, thread summaries, and reply drafts. All domain calls go through `@opendesk/api-client`; scope checks, idempotency, and audit attribution remain enforced by the public API.
