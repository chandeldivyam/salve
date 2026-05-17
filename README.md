<div align="center">
  <a href="https://usesalve.com">
    <img src="https://usesalve.com/hero-loop-poster.webp" alt="Salve — Support platform built for AI agents" />
  </a>

  <h1>Salve</h1>

  <p><strong>Support platform built for AI agents.</strong><br/>
  Because agents now do real work.</p>

  <p>
    <a href="https://usesalve.com">Website</a> ·
    <a href="https://app.usesalve.com">App</a> ·
    <a href="docs/agent-platform-rfc.md">Architecture</a> ·
    <a href="https://github.com/chandeldivyam/salve/issues">Issues</a>
  </p>

  <p>
    <img alt="License: Apache 2.0" src="https://img.shields.io/badge/License-Apache_2.0-blue.svg" />
    <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-6.0-3178c6?logo=typescript&logoColor=white" />
    <img alt="React" src="https://img.shields.io/badge/React-19-149eca?logo=react&logoColor=white" />
    <img alt="Next.js" src="https://img.shields.io/badge/Next.js-15-000?logo=nextdotjs&logoColor=white" />
    <img alt="Postgres" src="https://img.shields.io/badge/Postgres-16-336791?logo=postgresql&logoColor=white" />
    <img alt="SST" src="https://img.shields.io/badge/SST-v4-e27152" />
  </p>
</div>

<br/>

<div align="center">

https://usesalve.com/hero-loop.mp4

</div>

> [!NOTE]
> If the embed above does not autoplay, watch the full hero loop at **[usesalve.com](https://usesalve.com)**.

---

## What is Salve?

Salve is an **open-source helpdesk** rebuilt around a single bet: **AI agents are about to outnumber human support reps by 100×**, and every tool in this category was designed before that was true.

So we built one that treats agents like first-class teammates — not chatbot widgets bolted onto a 2014 inbox. Same identity model. Same scoped permissions. Same audit trail. The keyboard-first, sync-engine-fast inbox your human team already wants — plus a public REST / CLI / MCP surface that any agent can drive end-to-end.

Open source. Self-hostable. Apache-2.0. Hosted at **[usesalve.com](https://usesalve.com)** for teams who want it managed.

---

## Why Salve

<table>
<tr>
<td width="50%" valign="top">

### 🤖 Agents are users, not features

Every agent gets a real identity — name, avatar, profile page. Scoped permissions bound to specific actions and dollar limits. Every read, draft, send, and escalation logged to the ticket. Forever.

</td>
<td width="50%" valign="top">

### ⌨️ Linear-grade speed

Local-first sync engine. `j`/`k` navigation, hover preload, optimistic everything. The inbox you'd actually want to use all day.

</td>
</tr>
<tr>
<td width="50%" valign="top">

### 🔌 REST · CLI · MCP, one surface

Action contracts compile into a public `/v1` REST API, a `salve` CLI, and a `salve-mcp` server — automatically. PATs (`slv_pat_*`), service accounts (`slv_svc_*`), scopes, idempotency keys, the lot.

</td>
<td width="50%" valign="top">

### 📬 Real channels, no pollers

Email via SES today — 6-layer threading, HMAC reply-plus tokens, RFC 8058 one-click unsubscribe. Polymorphic delivery layer (Inngest, event-driven) slots WhatsApp / SMS / chat in without schema changes.

</td>
</tr>
<tr>
<td width="50%" valign="top">

### 🏠 Own your data

Apache-2.0. Self-host on your own AWS account with the included SST stack, or run locally in Docker. No vendor lock-in, no per-seat pricing tax on your agents.

</td>
<td width="50%" valign="top">

### 🧱 Boring stack, built to last

TypeScript end to end. Postgres for state, Zero for sync, Hono for HTTP, Drizzle for SQL, Inngest for fan-out, Biome for everything else. Nothing exotic.

</td>
</tr>
</table>

---

## Quick start

You'll need **Node 20+**, **pnpm 10**, and **Docker**.

```bash
# 1. Clone
git clone https://github.com/chandeldivyam/salve.git
cd salve
pnpm install

# 2. Spin up Postgres + Redis + MinIO + Zero replica (single command)
pnpm dev:docker:up

# 3. Apply the schema
pnpm db:migrate

# 4. Run the stack in parallel — api · web · zero-cache
pnpm dev
```

Open **[localhost:5173](http://localhost:5173)** and you're in the inbox.

The marketing site runs separately on port 3100:

```bash
pnpm dev:marketing
```

To tear everything down and reset the databases:

```bash
pnpm dev:clean
```

---

## Architecture

Salve has **two write paths** that converge server-side. This boundary is the single most important thing to internalize before contributing.

```
                       ┌──────────────────────────┐
   apps/web (React) ──►│ Zero mutators (optimistic)│──┐
                       └──────────────────────────┘  │
                                                     ├──► defineMutators ──► Postgres
   apps/cli                                          │     (single source
   apps/mcp           ┌──────────────────────────┐  │      of truth)
   external SDK   ───►│ Action contracts → /v1 → │──┘
                      │ executor → ctx.runMutation│
                      └──────────────────────────┘
```

- **The web app never calls `/v1`.** It uses Zero subscriptions for reads and Zero mutators for writes. Optimistic UI lives in the local replica.
- **External consumers never call Zero.** They go through `/v1`, the typed action contracts, and bearer tokens with scopes.
- Both paths land in the same `defineMutators` code, so business logic stays in one place.

Full breakdown in [`guidelines/architecture.md`](guidelines/architecture.md). RFC for the public surface in [`docs/agent-platform-rfc.md`](docs/agent-platform-rfc.md).

---

## Repository layout

```
salve/
├── apps/
│   ├── web/             React 19 + TanStack Router inbox UI
│   ├── api/             Hono server — public /v1 + Zero server-mutators
│   ├── zero-cache/      Rocicorp Zero sync replica
│   ├── inngest/         Event-driven workers (delivery, audit, webhooks)
│   ├── cli/             `salve` binary — auto-derived from action contracts
│   ├── mcp/             `salve-mcp` — stdio MCP server for AI consumers
│   └── marketing/       usesalve.com (Next.js 15)
├── packages/
│   ├── db/              Drizzle schema — source of truth for DDL
│   ├── zero-schema/     Zero schema + query helpers (read side)
│   ├── mutators/        defineMutators (write side, both paths)
│   ├── action-contracts/ Zod input/output + scopes + idempotency
│   ├── action-executor/ Server-side runners for each contract
│   ├── api-client/      Typed client used by CLI/MCP/SDK
│   ├── core/            Shared utilities, types, errors
│   └── ui/              shadcn-derived component library
├── infra/               SST v4 component definitions (AWS)
├── docker/              Local dev containers
├── docs/                RFCs, audits, plans
└── guidelines/          Architecture, conventions, copy guide
```

Each `apps/*` and `packages/*` has its own `AGENTS.md` with module-specific guidance.

---

## The public surface

Salve ships three flavors of the same API on day one — they're all derived from a single set of typed action contracts in [`packages/action-contracts`](packages/action-contracts/).

**REST — `/v1`**

```bash
curl https://app.usesalve.com/v1/tickets \
  -H "Authorization: Bearer slv_pat_…" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{ "subject": "Refund duplicate charge", "body": "…" }'
```

**CLI — `salve`**

```bash
salve tickets create --subject "Refund duplicate charge" --body "…"
salve tickets list --status open --assignee aria
```

**MCP — `salve-mcp`**

```json
{
  "mcpServers": {
    "salve": { "command": "npx", "args": ["-y", "salve-mcp"] }
  }
}
```

Add `salve-mcp` to Claude, Cursor, or any MCP-compatible client. Every tool in the curated surface is scoped, idempotent, and audited the same way the REST endpoint is.

---

## Tech stack

| Layer | Choice |
|---|---|
| Language | TypeScript |
| Runtime | Node 20+ |
| Package manager | pnpm 10 + Turborepo |
| Web framework | React 19 + TanStack Router + Vite 8 |
| Styling | Tailwind v4 + shadcn-derived `@salve/ui` |
| Marketing site | Next.js 15 (App Router) |
| HTTP | Hono |
| Database | Postgres 16 (Aurora in prod) |
| ORM | Drizzle |
| Sync engine | [@rocicorp/zero](https://zero.rocicorp.dev) 1.3 |
| Background work | Inngest |
| Email | Amazon SES |
| Validation | Zod 4 |
| Lint / format | Biome 2.4 (Biome only — no ESLint, no Prettier) |
| Auth | better-auth + scoped API-key plugin |
| MCP | `@modelcontextprotocol/sdk` 1.x |
| Infra | SST v4 (Ion) on AWS |

---

## Self-hosting

The whole stack is defined as code in [`infra/`](infra/) using SST v4 (Pulumi-backed). One command deploys to your own AWS account:

```bash
pnpm sst:deploy:prod
```

You get: VPC, Aurora Postgres, ECS Fargate services for api / zero-cache / inngest-bridge, Lambda + CloudFront for the web and marketing apps, SES (sending + inbound), S3 buckets for attachments, and a Route 53 zone wired end-to-end.

A managed offering also exists at [app.usesalve.com](https://app.usesalve.com) if you'd rather not run it yourself.

---

## Status

Salve is **pre-1.0** and used in production by design partners. Today: email channel, public REST/CLI/MCP, multi-tenant workspaces, scoped agent identities. On the runway: pricing page, public changelog, demo seed script, WhatsApp/SMS/chat channels, reporting, SSO/SCIM. Project state lives in [`docs/`](docs/) — start with the latest audit.

---

## Contributing

Issues and PRs welcome. Before you start:

1. Read [`AGENTS.md`](AGENTS.md) — how this project operates.
2. Read [`guidelines/architecture.md`](guidelines/architecture.md) — the two-path boundary rule.
3. Run `pnpm check` and `pnpm type-check` before opening a PR.

The codebase is set up for AI-assisted development (Claude Code, Cursor, Codex) — every directory has an `AGENTS.md` with the context an agent needs to make a competent change.

---

## License

Apache License 2.0 © Salve contributors. (A `LICENSE` file will be added before the public 1.0.)

<div align="center">

<sub>Built by <a href="https://emergent.sh">Emergent</a>. Healing the help-desk.</sub>

</div>
