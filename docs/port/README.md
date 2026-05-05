# Atlas → Salve Port Plan

Port the email-support feature set from Atlas (`/Users/divyamchandel/Documents/atlas/app`) to salve, on top of the Zero live-query foundation we already have. Each phase doc is a self-contained sub-agent brief: read Atlas references, write code in salve, verify, hand back.

## Scope

- **Channel:** email only (chat/SMS/WhatsApp later — schema is already polymorphic)
- **Out of scope:** knowledge base, copilot, CSAT, broadcasts, analytics dashboards, session recording (the recording widget will arrive separately)

## Atlas references

- Frontend: `/Users/divyamchandel/Documents/atlas/app/jsapp/src/`
- Backend: `/Users/divyamchandel/Documents/atlas/app/webapp/web/`
- Atlas root `CLAUDE.md`: `/Users/divyamchandel/Documents/atlas/app/CLAUDE.md`

When a ticket references an Atlas file, the path is relative to one of those two roots unless prefixed.

## Salve references

- Plan of record: `~/.claude/plans/https-zero-rocicorp-dev-docs-introductio-buzzing-reddy.md`
- Repo conventions: `AGENTS.md` (root) plus per-area `AGENTS.md`
- Zero patterns to mirror: `/tmp/zero-mono/apps/zbugs/shared/{schema,queries,mutators,auth}.ts`
- Drizzle schema source-of-truth: `packages/db/src/schema/`
- Zero schema mirror: `packages/zero-schema/src/`
- Mutators: `packages/mutators/src/`
- Hono server-mutator hooks: `apps/api/src/server-mutators.ts`
- React app: `apps/web/src/`
- UI primitives: `packages/ui/src/`

## Phase order

Phases are numbered by priority for an email-support agent's daily life. Each phase is one sub-agent's worth of work (1–2 days of execution). Lower-numbered phases unblock later ones.

| # | Phase | File | Unblocks |
|---|---|---|---|
| 10 | Tags + Custom Fields | [`10-tags-and-custom-fields.md`](./10-tags-and-custom-fields.md) | 40, 50, 80 |
| 20 | Customer Profile + Timeline | [`20-customer-profile-and-timeline.md`](./20-customer-profile-and-timeline.md) | 30, 70 |
| 30 | Cmd+K + Hotkey Registry | [`30-cmdk-and-hotkey-registry.md`](./30-cmdk-and-hotkey-registry.md) | every later UI |
| 40 | Custom Inbox Views | [`40-custom-inbox-views.md`](./40-custom-inbox-views.md) | 50 |
| 50 | Bulk Actions + Soft Delete | [`50-bulk-actions-and-soft-delete.md`](./50-bulk-actions-and-soft-delete.md) | — |
| 60 | Drafts + Canned + Mentions | [`60-drafts-canned-mentions.md`](./60-drafts-canned-mentions.md) | 70 |
| 70 | Read State + Notifications + Activity | [`70-read-state-notifications-activity.md`](./70-read-state-notifications-activity.md) | 80 |
| 80 | Inbox Row Polish | [`80-inbox-row-polish.md`](./80-inbox-row-polish.md) | — |
| 90 | Snooze Auto-wake + Scheduled Send + Merge | [`90-snooze-scheduled-merge.md`](./90-snooze-scheduled-merge.md) | — |
| 95 | SLA + Teams + Shifts | [`95-sla-teams-shifts.md`](./95-sla-teams-shifts.md) | — |
| 99 | Email Channel Polish | [`99-email-polish.md`](./99-email-polish.md) | — |

## Cross-cutting Zero constraints

These shape every ticket; restate them in any sub-agent prompt:

1. **No `GROUP BY` / aggregation in ZQL.** Counts and group-by views materialize all rows client-side (fine <5k tickets) or call a sidecar `/api/counts` endpoint.
2. **No `LIMIT` in queries.** All queries return full result sets — narrow with status/date filters in the query body, never with LIMIT.
3. **No full-text search in Zero.** Search runs through a Hono endpoint backed by Postgres `pg_trgm` / FTS (already enabled in `scripts/init-db.sql`). Cmd+K mixes Zero entity navigation with `/api/search` results.
4. **All queries scoped via `applyWorkspaceScope`** in `packages/zero-schema/src/queries.ts`. Never write a raw `.where()` without it — that's the codebase's `alwaysFalse` pattern.
5. **Mutators run on client + server** automatically. Optimistic updates are free; do not reinvent MobX or wrap in tanstack-query. Just call `z.mutate(mutators.X.Y(...))` in a handler.
6. **Post-commit hooks** (notifications, SLA timers, scheduled sends) go through `apps/api/src/server-mutators.ts` → `inngest.send()`, mirroring `message.send` → `delivery/message.requested`.
7. **JSONB columns** are streamed by Zero as `unknown`. Filtering on JSONB happens server-side via Postgres GIN; Zero just replays the materialized rows.
8. **Idempotency keys** on every Inngest event: `<event>-<entity-id>` (see `apps/api/src/server-mutators.ts:45-92`).
9. **Audit events.** Every state change emits an `auditEvent` row with a stable `kind`. The activity timeline renders from this — design the kind taxonomy before writing the mutator.

## Per-phase doc structure

Every phase doc has the same shape:

1. **Goal** — what an agent gets after the phase ships.
2. **Atlas behavior** — concrete description with file:line citations so the sub-agent doesn't have to re-explore Atlas.
3. **Schema delta** — Drizzle migrations + Zero mirror columns.
4. **Zero queries** — exact query helpers to add to `packages/zero-schema/src/queries.ts`.
5. **Mutators** — names, args, server post-commit hooks.
6. **UI surfaces** — components and routes that change.
7. **Tickets** — `T-<phase><nn>` with title, Atlas reference, plan, acceptance criteria, dependencies.

## Working agreement for sub-agents

- Pin `@rocicorp/zero@1.3.0`. Don't bump.
- Mirror `zbugs` patterns; cite the file inline in PR messages.
- No Postgres pollers. Inngest only.
- No commits — parent commits.
- For UI work: run `agent-browser` and read the PNGs yourself.
- Verify type-check (`pnpm -w typecheck`) and Biome (`pnpm -w lint`) before reporting done.
- Don't write docs alongside code. This `docs/port/` tree is the spec; PRs are the implementation.

## Status

| Phase | Status | Notes |
|---|---|---|
| 0–3a | ✅ shipped | auth, schema, mutators, inbox, composer, outbound delivery, sending domains, HMAC reply tokens |
| 3b | ⚙ partial | inbound parsing/routing logic done; raw inbound timeline UI not wired |
| 3c | ⚙ partial | per-channel signature in schema, per-address signature UI todo, attachments todo |
| 10–99 | ⏳ planned | this folder |
