# packages/db · AGENTS.md

Drizzle is the source of truth for Postgres DDL. Read root `AGENTS.md` first.

## Layout

```
src/
├── client.ts              # exports `db` Drizzle client (postgres driver)
├── index.ts               # public exports: db client + schema barrel
├── schema/
│   ├── index.ts           # barrel re-exporting auth + domain + email
│   ├── auth.ts            # better-auth tables (user, session, account, verification, organization, member, invitation)
│   ├── domain.ts          # core domain tables (customer, ticket, message, attachment, audit_event, legacy outbox)
│   └── email.ts           # polymorphic channel + email delivery tables
└── migrations/
    ├── 0000_*.sql         # auth tables
    ├── 0001_rainy_venus.sql       # domain tables + ticket short_id trigger
    ├── 0002_*.sql         # legacy outbox table
    ├── 0003_*.sql         # initial email/domain tables
    ├── 0004_*.sql         # polymorphic channel + outbound delivery contract
    └── meta/              # drizzle-kit snapshot files
drizzle.config.ts          # points to schema barrel + migrations dir
```

## Notable patterns

- **Driver is `postgres`, not `pg`.** Faster, better types, Drizzle's modern recommendation. The `db` client in `src/client.ts` reads `DATABASE_URL` and constructs a `postgres()` client.
- All tenant-owned tables carry `workspace_id text not null` (FK to better-auth's `organization.id`, cascading on delete). Multi-tenant boundary.
- Per-workspace incrementing `short_id` lives in a Postgres trigger (not the application). See `migrations/0001_rainy_venus.sql` — `assign_ticket_short_id()` plpgsql function + `BEFORE INSERT` trigger. Manually appended after `drizzle-kit generate` ran.
- Status / priority / author-type are Postgres enums via `pgEnum(...)`. Mirrored in Zero schema as `enumeration<...>()`.
- Indexes that matter: `(workspace_id, status, updated_at desc)` on ticket (inbox); `(workspace_id, assignee_id, status)` on ticket (my-tickets); partial idx `(workspace_id, sla_deadline_at) WHERE status NOT IN ('resolved','closed')` (Phase 4 SLA scanner); `(ticket_id, created_at)` on message; `(workspace_id, kind)` on `channel`; `(workspace_id, status, created_at)` on `outbound_message`.
- For UUID columns use `crypto.randomUUID()` at insertion sites — **not** `nanoid`. Postgres rejects nanoid's character set as `invalid input syntax for type uuid`.

## Scripts

```
pnpm db:generate   # drizzle-kit generate (diff schema → SQL)
pnpm db:migrate    # drizzle-kit migrate (apply pending SQL)
pnpm db:push       # drizzle-kit push (skip migration files; dev only)
pnpm db:studio     # drizzle-kit studio (web UI)
```

Hoisted to root `package.json` for convenience: `pnpm db:generate` from anywhere works.

## Gotchas hit

- `tsconfig.base.json` has `allowImportingTsExtensions: false`. Imports like `from './schema/index.ts'` fail type-check; use `'./schema/index.js'` (TS bundler resolution maps `.js` → `.ts` source).
- `@types/node` must be in this package's devDeps and `tsconfig.json` `types: ["node"]`, otherwise `process.env` in `client.ts` doesn't type-check.
- `drizzle-kit generate` doesn't include triggers/functions. Append raw SQL to the generated migration manually for triggers — that's how the `short_id` trigger lands.
- Migration filenames are auto-generated nonsense (`0001_rainy_venus.sql`). Don't rename them; drizzle-kit's metadata in `migrations/meta/` references the filenames.

## Phase 3a delivery schema

Per the plan's "Email subsystem" section, `src/schema/email.ts` owns `channel`, `email_channel`, `email_address`, `sending_domain`, `outbound_message`, `suppression`, `webhook_event`, and `customer_channel_identity`. `domain.ts` owns shared ticket/customer additions such as `customer.alternate_emails`, `customer.display_name`, `ticket.closed_at`, and `ticket.closed_by_id`.

## Where to look

| File | What it is |
|---|---|
| `src/schema/auth.ts` | better-auth Drizzle tables (codegen-aligned). |
| `src/schema/domain.ts` | Core domain tables + enums + indexes. |
| `src/schema/email.ts` | Polymorphic delivery and email-specific tables. |
| `src/migrations/` | Append-only SQL migration files; don't edit history. |
| `drizzle.config.ts` | drizzle-kit config (schema, out, dialect, dbCredentials). |
| `.env.example` | `DATABASE_URL` reference. |
