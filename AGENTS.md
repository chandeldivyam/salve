# opendesk · AGENTS.md

Read this before touching anything. It's how the project operates and what we've learned along the way. Per-area details live in `AGENTS.md` files inside each `apps/*` and `packages/*`.

---

## Project at a glance

- **Internal name (folder, npm scope, env vars, repo, code identifiers): `opendesk`** — `@opendesk/*` packages, `OPENDESK_*` env vars.
- **Public brand: Salve** at `usesalve.com`. Tagline *"Healing the help-desk."* Used in customer-facing copy only — never in package names or code identifiers.
- **What it is**: B2B multi-tenant help-desk SaaS. Open-source alternative to Intercom/Zendesk.
- **Stack**: TypeScript + pnpm 10 + Turborepo + Vite 8 + React 19 + TanStack Router + Tailwind v4 + shadcn-derived UI + Hono + Drizzle + `@rocicorp/zero@1.3.0` + Inngest + Postgres + Biome 2.4. Hosting: AWS via SST v3 (Phase 6).
- **Linter/formatter**: **Biome only.** Do not introduce ESLint or Prettier.

## Where to read first

| File | What it is |
|---|---|
| `~/.claude/plans/https-zero-rocicorp-dev-docs-introductio-buzzing-reddy.md` | The canonical plan. Architecture, schema, phase order, deployment topology. **Source of truth.** |
| `tmp/research/atlas-email-deep-dive.md` | 7300-word recon of Atlas's email subsystem (Python/SendGrid). Threading, customer ID, loop detection, outbound rendering. Read before any email work. |
| `tmp/research/inngest-multichannel-design.md` | 6900-word design doc for the polymorphic delivery layer. Inngest event-driven patterns, multi-channel schema, no-poller architecture. Read before any Phase 3+ work. |
| `/tmp/zero-mono/apps/zbugs/shared/{schema,queries,mutators,auth}.ts` | Rocicorp's reference bug tracker (Zero 1.5). Idiomatic patterns for schema, query helpers, custom mutators, assertion-based auth. Mirror these. |
| `/tmp/hello-zero-fresh/` | Latest Zero starter. Canonical `zero-cache-dev` wiring, SST deploy, Postgres logical-replication Docker setup. |
| `~/.claude/projects/-Users-divyamchandel/memory/MEMORY.md` | User-level memory: workflow preferences, design-review pattern, naming, etc. |

## How we operate (the sub-agent workflow)

Read this exactly. Don't deviate without proposing first.

### The phase loop

1. **Plan** lives at the path above. Phases are numbered (Phase 0–7), each ends with a runnable, verified slice.
2. **Per phase, dispatch one Opus sub-agent** with the full slice (research + execution). Prompt should:
   - Cite the plan section + relevant research files as required reading.
   - Cite `zbugs` files for pattern parity.
   - List concrete deliverables, scoped tightly to the phase.
   - Specify verification: type-check, biome, **screenshot tests via `agent-browser`** for any UI phase.
   - Forbid commits — the parent commits.
3. **The agent reports back.** Don't trust the summary alone — **read the diff and screenshots yourself** before declaring done.
4. **Commit the phase** with a descriptive message that names the patterns mirrored from zbugs and any course corrections.
5. **Dispatch a Sonnet design-review agent** for any UI-touching phase. It uses `agent-browser` (CLI at `/opt/homebrew/bin/agent-browser`) to capture every new screen and produce a punch list. Save to `tmp/design-review/<phase>/`.
6. **Triage the punch list**, dispatch fixes via another Opus agent if blockers/highs exist, re-screenshot, re-commit.
7. **Move to next phase.**

### When to spawn what

- **Opus sub-agent (`general-purpose`)** for: scaffolding, schema, mutators, server logic, build phases, fix-cycles after design review. Always pass `model: "opus"`.
- **Sonnet sub-agent (`general-purpose`, `model: "sonnet"`)** for: UI design review with `agent-browser`. Lighter-weight, design-focused.
- **Explore agent** for: read-only research / reconnaissance of an unknown codebase (Atlas, Chatwoot, etc.). It can also do web research.
- **Plan agent** for: high-stakes architecture decisions where we want a second opinion before locking in.

### The agent-browser screenshot loop

```bash
agent-browser --help                         # full surface
agent-browser set viewport 1440 900
agent-browser open http://localhost:5173/auth/sign-in
agent-browser wait 'h1'
agent-browser screenshot tmp/design-review/phaseN/01-sign-in.png
agent-browser fill 'input[name=email]' 'a@b.com'
agent-browser find role button 'Sign in' click
```

**Always read the resulting PNGs with the Read tool yourself.** A passing screenshot test proves nothing if you don't look at it.

### Memory files we honor

- Verify against current docs (npm-latest + project's `agents.md` / `llms.txt`) before trusting local clones or training data — Zero, Inngest, etc. move fast.
- Code mirrors `zbugs` idioms; UI is design-reviewed every phase.
- No DB pollers when Inngest is in the stack. Polymorphic channels + multiple sending+receiving addresses from day one.
- Sub-agents do research + execution, report back, parent reviews + commits, dispatches next.

## Learnings along the way (bullets)

### Zero (rocicorp) 1.x

- Pin `@rocicorp/zero@1.3.0` exactly. 1.4/1.5 are canary. Run `npm view @rocicorp/zero version` before bumping.
- **`definePermissions` is deprecated** in 1.x with custom mutators — `zbugs` (the latest reference) makes zero calls to it. Permissions are enforced inline in queries (via `.where()` filters) and mutators (via assertion functions). The plan committed to assertion-based perms; we ship with `definePermissions` absent.
- `enableLegacyMutators: false` and `enableLegacyQueries: false` once `defineMutators` + `defineQueries` are wired. The `z.query` typed proxy disappears unless you do this.
- Timestamps from Postgres `timestamptz` map transparently to Zero `number()` (epoch ms via Zero's built-in pg-data-type conversion). No mirror columns or triggers needed.
- `<ZeroProvider>` requires a `context` prop matching `DefaultTypes.context` (we augment with `AuthData`).
- `--schema-path` flag to `zero-cache-dev` for the schema file location.
- Sticky load-balancer cookies + per-instance SQLite replicas are non-negotiable — don't aggressively rotate Fargate tasks in prod.

### Postgres + Drizzle

- Use the **`postgres`** driver, not `pg`. Drizzle's modern recommendation; better perf, better types.
- Drizzle is the source of truth for DDL. Zero schema is hand-mirrored. Plan a CI drift check.
- Logical replication needs `wal_level=logical`, `max_wal_senders=10`, `max_replication_slots=10`. Already in `docker/docker-compose.yml`.
- For UUID columns use `crypto.randomUUID()`, not `nanoid` (we tried; Postgres rejects nanoid as `invalid input syntax for type uuid`).
- Per-workspace incrementing `short_id` lives in a Postgres trigger, not the application. See `packages/db/src/migrations/0001_*.sql`.

### Hono + Node

- **`localhost` resolves to `::1` first**; `@hono/node-server` binds IPv4 only. Use `127.0.0.1` for inter-process URLs (zero-cache → api). Cost us a debug session.
- The auth middleware does a **two-pass resolve**: pre-`next()` reads the request cookie, post-`next()` re-reads the response's `Set-Cookie` so first-request sign-up/sign-in still emits the JWT cookie.
- CORS is unnecessary in dev — use `vite.config.ts`'s `server.proxy` to make `/api/**` same-origin. CORS lives in `apps/api` only for prod cross-origin.

### Tailwind v4 + UI

- Tailwind v4's auto-content detection misses workspace siblings. Add `@source "../../../packages/ui/src/**/*.tsx"` to `apps/web/src/styles.css`. Cost us "buttons render with no fill" in design review.
- Brand tokens (`--color-brand-{50,500,600,700,900}`) live in `@theme {}` in `styles.css`. Components in `@opendesk/ui` reference `brand-*` classes — never `slate-*` for accent colors.
- `<select>` natively styled is acceptable for Phase 1 utilities (workspace switcher) but **not** for help-desk-specific UI; replace with shadcn DropdownMenu by Phase 4.
- Forms: `noValidate` on `<form>` + `aria-invalid` on inputs + inline `<p className="text-sm text-red-600">` errors. Never the browser default tooltip — it's inconsistent with our card design.

### Email subsystem (planned for Phase 3)

- **No DB pollers.** Inngest is the durable queue. Server-mutator post-commit dispatches `inngest.send` with idempotency key on messageID. Recovery cron (30 min) is a no-op in healthy operation.
- **Channels are polymorphic from day one** — email today; chat / WhatsApp / SMS / IG drop in without schema migration. Event names never reference "email"; e.g. `delivery/message.requested`, not `email.send`.
- **Multiple sending + receiving addresses per tenant** — `support@`, `comms@`, `billing@` on one workspace, each with its own inbound routing. Don't bake a one-address-per-domain assumption anywhere.
- HMAC-sign reply-plus tokens (Atlas didn't, it's the most-cited gap in their security review).
- `List-Unsubscribe` + `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058) for Gmail/Yahoo bulk-sender compliance.
- 6-layer threading: `In-Reply-To` → `References` (30-day window) → HMAC `+t_` token → `To:`-domain routing → CSS-selector body markers → magic markers `::tid:<id>::`.
- Auto-responder detection: not just `Auto-Submitted` — also `Precedence: bulk|junk|list`, `X-Autoreply`, mailer-daemon From-addresses.

### Workflow

- **Verify versions before pinning.** Run `npm view <pkg> version` and check `dist-tags`. Old local clones lie.
- **Look at agents.md / llms.txt** on the project website before trusting docs — Zero publishes one specifically for AI agents. Saved us writing pre-1.0 patterns.
- **Read the screenshots, don't trust the agent's summary.** Browser-driven design review caught CORS blockers that curl tests missed.
- **Commit per phase, not per agent run** — but always commit a working state before dispatching the next phase. Six clean commits is better than one giant one.

## Repo navigation map

```
opendesk/
├── apps/
│   ├── api/            # Hono server: auth, JWT, /api/zero/*, /api/files/*, server-mutators
│   ├── web/            # React + Vite + TanStack Router + Tailwind v4 (the agent UI)
│   └── zero-cache/     # Thin runner; zero-cache-dev wired to packages/zero-schema
├── packages/
│   ├── core/           # Shared domain types/utils (placeholder, fills up Phase 3+)
│   ├── db/             # Drizzle schema + migrations + client (postgres driver)
│   ├── mutators/       # Custom mutators (defineMutators) — runs on client + server
│   ├── ui/             # shadcn-derived primitives, Tailwind v4 brand tokens
│   └── zero-schema/    # Zero schema mirror + defineQueries (applyWorkspaceScope)
├── docker/
│   └── docker-compose.yml  # postgres, redis, inngest, mailpit, minio, adminer
├── scripts/
│   └── init-db.sql     # extensions: uuid-ossp, pg_trgm, unaccent, pgcrypto
├── tmp/                # gitignored: research/, design-review/
└── biome.json, turbo.json, pnpm-workspace.yaml, tsconfig.base.json
```

`pnpm dev` runs web (5173) + api (3001) + zero-cache (4848) in parallel via Turbo.
`pnpm dev:docker:up` boots all backing services. `pnpm dev:clean` resets state.
