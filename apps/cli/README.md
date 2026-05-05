# Salve CLI

Internal workspace package for the `salve` command. It is published later as `@salve/cli`, while the monorepo keeps the package under `@salve/cli`.

```sh
pnpm --filter @salve/cli dev -- login
pnpm --filter @salve/cli dev -- whoami --api-base-url http://127.0.0.1:3001
pnpm --filter @salve/cli dev -- tickets list --status open
```

Set `SALVE_TOKEN` for CI or run `salve login` to store a token in `~/.config/salve/auth.json` with `0600` permissions. `SALVE_API_URL` overrides the default API origin, and `SALVE_WORKSPACE_ID` overrides the active workspace header.

Human output defaults to tables on a TTY. Use `--json` for stable JSON or `--jsonl` for one object per line. Errors are printed to stderr and use exit code `1` for validation/auth failures and `2` for network or server failures.

The CLI is intentionally thin: all domain operations use `@salve/api-client`. The `salve api <METHOD> <PATH>` escape hatch also runs through the SDK so auth, retries, idempotency, and error formatting stay consistent.

Example `tickets list` output:

```text
┌────┬────────────────────────┬─────────────┬────────────────────┬──────────────────────┐
│ #  │ TITLE                  │ STATUS      │ CUSTOMER           │ UPDATED              │
├────┼────────────────────────┼─────────────┼────────────────────┼──────────────────────┤
│ 42 │ Refund follow-up       │ open        │ carol@example.com  │ 2026-05-05T10:15:00Z │
│ 43 │ Billing email bounced  │ in_progress │ ops@example.com    │ 2026-05-05T10:20:00Z │
└────┴────────────────────────┴─────────────┴────────────────────┴──────────────────────┘
```
