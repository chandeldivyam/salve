# Salve — CI/CD & Production Infrastructure Plan

**Status:** Draft for review · **Author:** Claude (with research) · **Date:** 2026-05-06
**Scope:** Everything except `npm publish` of `@salve/cli` and `salve-mcp`. That covers `apps/web`, `apps/api`, `apps/zero-cache`, the SES inbound pipeline, Postgres, Inngest Cloud wiring, DNS/TLS, secrets, GitHub Actions, and rollback.

---

## 0. Read this first — three corrections before we start

1. **`INNGEST_API_KEY` in `.env` is the wrong key for the runtime.** Inngest's SDK + serve handler need:
   - `INNGEST_EVENT_KEY` — used by `inngest.send(...)` to publish events.
   - `INNGEST_SIGNING_KEY` — used by `serve()` to verify Cloud's webhook calls into our `/api/inngest` endpoint, and by the SDK to authenticate its config-sync calls.

   What's labeled `INNGEST_API_KEY` in the dashboard is the **Inngest Management API token** — Bearer token for `https://api.inngest.com/v2/...`. We'll only use it from CI to call `/apps/sync` after a deploy. So: keep the existing `INNGEST_API_KEY`, but also fetch the Event Key + Signing Key from the Inngest dashboard ("Production" environment → Manage → Signing Keys / Event Keys) and add them to AWS Secrets Manager (not `.env` in the repo).

2. **The `.env` AWS keys are the bootstrap-only path.** We'll use them for the very first `sst deploy` to provision the IAM role for GitHub OIDC. After that, the long-lived `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` should be **rotated and removed from local `.env`**. CI authenticates to AWS via short-lived OIDC tokens. Keep the keys in your local `.env` only as long as you're running `sst deploy` from your laptop.

3. **`docs/` is currently in `.gitignore`** (committed in `4d273c1`). This file lives in `docs/` per your request, but to track it long-term you'll need to either remove `docs/` from `.gitignore` or add an explicit allowlist (`!docs/cicd-plan.md`). I recommend the allowlist — your local research notes can stay private.

---

## 1. Recommendation

**IaC: SST v3 (Ion). CI: GitHub Actions.**

- The canonical plan (`~/.claude/plans/...buzzing-reddy.md`) and `AGENTS.md` already commit to SST v3, so we follow through.
- SST v3 components map cleanly onto our shape: `StaticSite` (web), `Service` on `Cluster` (api + zero-cache), `Postgres` / direct Aurora component, `Bucket`, `Email`, `Queue`, `Function` (the SES → Inngest bridge), `Secret`, `Router`. One `sst.config.ts` graph, one `sst deploy --stage prod` command.
- `Linkable` automatically wires least-privilege IAM and injects typed env vars via `Resource.<name>.value` — far less boilerplate than raw Terraform/Pulumi.
- GitHub Actions stays simple because SST does the heavy lifting; one workflow file per stage.

**Alternatives considered:**
- *Raw Terraform / OpenTofu*: more portable, but doubles the LOC for what we need; no advantage given we're AWS-only.
- *AWS CDK*: viable, but SST already uses Pulumi underneath and gives us a higher-level vocabulary tuned to web apps.
- *SST Console Autodeploy*: SST's preferred path in 2026 — runs deploys in your AWS account via CodeBuild, no GHA OIDC bootstrap required. Worth revisiting in 6 months. We're choosing GHA now because the team already lives there and we want public PR/CI logs as an OSS project.

---

## 2. Account, region, DNS

**Decisions confirmed (2026-05-06):**

- **Stages**: **`prod` only**. No standing `dev` stage — saves ~$130–185/mo. On-demand `staging` when needed (`sst deploy --stage staging` → exercise → `sst remove --stage staging`). Mitigations: mandatory `sst diff` + manual approval before every prod deploy; on-demand staging when shipping risky migrations or SES changes.
- **Account topology**: single AWS account.
- **Primary region**: `us-east-1`. SES inbound is region-limited; `us-east-1` is cheapest and most feature-complete; ACM certs for CloudFront must live there regardless.
- **Secondary region for DR**: not in scope for v1.

**DNS (Route 53)**

Hosted zone `usesalve.com` is already in Route 53. We'll add the following records (managed by SST):

| Subdomain                | Points to                           | TLS         |
|--------------------------|-------------------------------------|-------------|
| `usesalve.com`           | Marketing site (later) / redirect   | CloudFront  |
| `app.usesalve.com`       | CloudFront → S3 (Vite SPA)          | ACM us-east-1 |
| `api.usesalve.com`       | ALB (Hono Fargate service)          | ACM regional |
| `sync.usesalve.com`      | ALB (zero-cache view-syncer)        | ACM regional |
| `in.usesalve.com`        | SES MX (`inbound-smtp.<region>`)    | n/a (SMTP)  |
| `reply.usesalve.com`     | SES MX                              | n/a         |
| `mail.usesalve.com`      | SES custom MAIL FROM (system mail)  | DKIM CNAMEs |

When we spin up an on-demand staging stage, SST appends the stage name to subdomains: `app-staging.usesalve.com`, etc. Per-PR ephemeral previews are out of scope for v1.

---

## 3. Component-by-component architecture

### 3.1 `apps/web` — Vite SPA

- **Build artifact**: `apps/web/dist/` (static).
- **Hosting**: `sst.aws.StaticSite` → S3 bucket + CloudFront distribution. `index.html` SPA fallback for TanStack Router. Cache: hashed assets `Cache-Control: public, max-age=31536000, immutable`; `index.html` `no-cache`.
- **Build-time env vars**: Vite bakes `VITE_*` into the bundle. We need `VITE_API_URL`, `VITE_ZERO_CACHE_URL`, `VITE_INBOUND_EMAIL_DOMAIN`, `VITE_REPLY_EMAIL_DOMAIN`. SST passes these via the `environment` field on `StaticSite`; the build step in CI runs after the values are computed (they reference other components by URL). Each stage rebuilds the bundle.
- **Notes**: cookies are cross-subdomain (`.usesalve.com`) for `app` ↔ `api` ↔ `sync`. Configure better-auth `cookie.domain = '.usesalve.com'` in prod.

### 3.2 `apps/api` — Hono on Fargate

Currently `tsx watch src/server.ts`. There is **no production build step** today (`build` is `tsc --noEmit`). We add one.

- **Production runtime**: Node 22 Alpine in a Docker container. We do **not** Lambda-ify Hono in v1 — Zero already needs Fargate, and the Hono server is the same Inngest serve endpoint, so co-locating saves cold-start pain and keeps `127.0.0.1` reads to zero-cache cheap.
- **Build approach**: Bundle to a single `dist/server.mjs` with `tsdown` (already used by `cli` + `mcp`) or `esbuild`. Avoids shipping `node_modules` for the entire monorepo. Multi-stage Dockerfile:
  1. `pnpm install --frozen-lockfile` in build stage.
  2. `pnpm --filter @salve/api... build` (incl. workspace deps).
  3. Copy bundle + `package.json` + (if needed) `node_modules` for non-bundlable native deps (`postgres`, `nodemailer`).
  4. Final image: `node:22-alpine`, `CMD ["node", "dist/server.mjs"]`.
- **SST shape**: `sst.aws.Service` on a shared `Cluster`, public ALB, `domain: 'api.usesalve.com'`, `cpu: '0.5 vCPU'`, `memory: '1 GB'`, `scaling: { min: 1, max: 4, cpuUtilization: 70 }`. Health check: `/healthz`. Linked to: `Bucket` (attachments), `Bucket` (raw email), `Postgres`, `Secret` (auth, inngest, ses, oauth), `Queue` (inbound email if we use SQS bridge).
- **VPC**: API runs in private subnets, ALB in public. Outbound NAT gateway for SES/Inngest API calls.

### 3.3 `apps/zero-cache` — Rocicorp Zero on Fargate

This is the trickiest piece. Per `https://zero.rocicorp.dev/docs/deployment` (2026):

- **Single-node** is the recommended starting topology. View-syncer + replication-manager + Litestream all in one container. Sufficient until we hit a few thousand concurrent client connections.
- **Image**: `rocicorp/zero:1.3.0` (or pinned digest). **Litestream is built into the image** — set `ZERO_LITESTREAM_BACKUP_URL=s3://salve-zero-replicas-prod/v1` and the container runs `litestream restore` on boot, `litestream replicate` continuously.
- **Sizing**: `1 vCPU` / `2 GB`, `arm64` (cheaper, image supports it). One task. EBS-backed ephemeral storage (the SQLite replica file lives in container FS; Litestream replicates to S3). No EFS — IOPS matters for query hydration.
- **ALB**: public, **sticky cookie** session affinity required. SST exposes this via the `Service` component's load-balancer rules. **TODO during implementation:** confirm whether SST exposes `stickiness` as a first-class field on `loadBalancer.rules` or whether we need to drop into `transform.targetGroup`. The expected target-group config:
  ```ts
  stickiness: { enabled: true, type: 'lb_cookie', cookieDuration: 120 }
  ```
- **Health check**: `/keepalive` (per Zero docs). WebSockets must be passed through (ALB does this natively for HTTP/1.1 Upgrade).
- **Required env vars (single-node)**:
  - `ZERO_UPSTREAM_DB` — Aurora connection string (postgres protocol).
  - `ZERO_CVR_DB` — same Aurora endpoint, separate logical DB or schema. (We'll use the same DB; Zero stores its CVR in its own tables.)
  - `ZERO_CHANGE_DB` — same.
  - `ZERO_REPLICA_FILE` — `/data/replica.db` (ephemeral).
  - `ZERO_AUTH_SECRET` — same secret the Hono API signs with.
  - `ZERO_QUERY_URL` — `https://api.usesalve.com/api/zero/query` (Hono endpoint).
  - `ZERO_MUTATE_URL` — `https://api.usesalve.com/api/zero/mutate`.
  - `ZERO_PORT` — `4848` (container port; ALB target port).
  - `ZERO_LITESTREAM_BACKUP_URL` — S3 URL.
  - `ZERO_LOG_LEVEL=info`, `ZERO_LOG_FORMAT=json` for prod.
- **Postgres parameter group requirements** (Aurora Postgres 16 cluster parameter group, requires reboot):
  - `rds.logical_replication = 1` (Aurora's wrapper that sets `wal_level=logical`).
  - `max_replication_slots = 10`.
  - `max_wal_senders = 10`.
- **Permissions**: `definePermissions` is deprecated in 1.x with custom mutators. We **don't** run `zero-deploy-permissions` in CI — permissions live in the Hono mutator endpoints + `applyWorkspaceScope` query helpers. Schema changes deploy purely via the client bundle and the mutator code path; no schema-deploy step needed beyond the standard Drizzle migration.
- **Deploy ordering** (when we eventually scale out): replication-manager first, then view-syncers, never the other way. Generous shutdown grace period (60s) so WebSocket clients drain.
- **Backups**: Litestream → S3 (continuous). Aurora is the source of truth; the replica file is rebuildable from Postgres. Litestream is for fast restart, not data durability.

### 3.4 Database — Aurora Postgres 16

- **Engine**: Aurora Postgres 16 (logical replication required, see above).
- **Topology**: single writer, **`db.t4g.medium`** (2 vCPU, 4 GB, burstable, ~$50/mo). No reader replica in v1 — Aurora's storage layer is replicated, so durability is fine; we only add a reader when we have a query workload that justifies it. Aurora Serverless v2 is tempting cheaper but has cold-start tax that's painful for Zero's persistent replication slot.
- **Caveat — burstable + Zero**: Zero's logical replication decoder runs continuously and burns CPU credits on a `t4g`. If we sustain >40% CPU baseline, T-instances throttle once credits drain. **Mitigation**: enable "Unlimited" mode on the parameter group (Aurora's `t4g` supports it; charges for credits used above baseline at ~$0.075/vCPU-hour). Watch the `CPUCreditBalance` metric for the first month; if we're consistently in unlimited mode, graduate to `db.m7g.large` (~$130/mo, non-burstable).
- **Storage**: Aurora's default (auto-scaling).
- **RDS Proxy**: only useful if we move API to Lambda. Currently API is long-lived Fargate, so direct connection with a `postgres` driver pool is fine. Skip RDS Proxy in v1.
- **Secrets**: master credentials in Secrets Manager (rotated every 30 days). App user is a separate role with `LOGIN`, `REPLICATION` (for Zero), and per-schema CRUD.
- **Migrations**: Drizzle migrations in `packages/db/src/migrations/`. Run via a one-off ECS task (see §6.2).
- **Backups**: Aurora automated backups (7 days) + manual snapshot before each prod deploy that ships a migration.

### 3.5 Cache — ElastiCache Serverless Redis

- Used for: rate limiting, idempotency-store, short caches (per the agent-platform guidelines).
- ElastiCache Serverless: pay-per-use, no instance management. Connection from API via VPC interface endpoint.
- Single env var: `REDIS_URL`. Linked via SST.

### 3.6 S3 buckets

| Bucket                       | Purpose                                   | Retention      | Public |
|------------------------------|-------------------------------------------|----------------|--------|
| `salve-attachments-prod`     | Customer-uploaded attachments             | Indefinite     | No (signed URLs) |
| `salve-raw-email-prod`       | SES inbound raw RFC822 (compliance archive)| 7 years        | No     |
| `salve-zero-replicas-prod`   | Litestream replicas of zero-cache SQLite  | 30 days        | No     |
| `salve-web-prod`             | Vite SPA static files (managed by SST)    | n/a            | No (CF) |
| `salve-cf-logs-prod`         | CloudFront access logs                    | 90 days        | No     |

Versioning: ON for attachments + raw-email. Lifecycle: transition to S3 IA at 90 days for raw-email; expire zero-replicas at 30 days.

### 3.7 Secrets

`sst.Secret` for each:
- `AUTH_SECRET` (32-byte hex, also used as `ZERO_AUTH_SECRET`).
- `DATABASE_URL` (resolved from RDS component, but stored as Secret for the migration job).
- `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`, `INNGEST_API_KEY` (the management one, used in CI sync step).
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (better-auth OAuth).
- `SES_WEBHOOK_SECRET` (for SNS signature verification on our webhook endpoint).

Set with `sst secret set <NAME> --stage prod`. Read in code via `process.env.<NAME>` after SST `link`.

### 3.8 SES — outbound

- **Per-tenant** identities are created **at runtime** by the `provision-domain` Inngest function (`apps/api/src/inngest/functions/`). They are **not** in IaC.
- **System identities** (created by SST) for our own outbound:
  - `salve-system@usesalve.com` (system mail) with custom MAIL FROM `mail.usesalve.com`.
  - DKIM CNAMEs in Route 53.
- **Configuration set**: one shared SST-managed configuration set with SNS event destinations for `Bounce`, `Complaint`, `Delivery`, `Reject`, `Open`, `Click`. SNS topic → SQS queue → Lambda → Inngest event `provider/webhook.received`.
- **Production access**: new AWS accounts ship in SES sandbox (200/day, verified recipients only). **Request prod access on day 1** of the bootstrap; 24–72h lead time. (Owner: Divyam.)

### 3.9 SES — inbound

- **Receipt rule sets** (SST-managed, one per stage):
  - `*@in.usesalve.com` → S3 (raw RFC822) + SNS topic `salve-inbound-prod`.
  - `*@reply.usesalve.com` → S3 + same SNS topic (different prefix).
- **MX records** in Route 53 for `in.usesalve.com` and `reply.usesalve.com` pointing at SES's regional inbound endpoint.
- **Bridge to Inngest**: SNS → SQS → Lambda. The Lambda parses the SNS payload, fetches metadata, and calls `inngest.send('inbound/message.received', { s3Key, ... })` using `INNGEST_EVENT_KEY`. The Lambda is the **only** Lambda in the stack — we keep it because it's the cheapest way to bridge from AWS event-source → Inngest Cloud's HTTP API and SES has no native Inngest integration.
- The actual `route-inbound-message` Inngest function still runs inside the Hono `serve` endpoint on Fargate. The Lambda does *only* the SNS → Inngest hop.

### 3.10 Inngest Cloud

- **One environment per stage**: `production` and `dev` (Inngest's free tier includes both).
- **Serve URL registration**: `https://api.usesalve.com/api/inngest`.
- **Sync flow** (in CI, after `sst deploy` succeeds):
  ```bash
  curl -fsSL -X PUT \
    -H "Authorization: Bearer $INNGEST_API_KEY" \
    "https://api.inngest.com/v2/apps/sync?url=https://api.usesalve.com/api/inngest"
  ```
  Inngest then GETs the serve URL once, reads the function manifest, registers them. If we skip this step, functions still register lazily on first event but it's slower and the dashboard is empty. Use the sync step.
- **Branch environments** (post-v1): set `INNGEST_ENV=branch-name` for ephemeral PR previews.

### 3.11 Observability (Phase 1 — minimal)

- **CloudWatch logs** on every Fargate service + Lambda. 7-day retention for dev, 30-day for prod.
- **CloudWatch metrics** + alarms on:
  - ALB 5xx rate > 1% over 5 min.
  - Aurora CPU > 80% over 10 min.
  - Aurora replication slot inactive (this is the canary for Zero falling behind).
  - SQS DLQ depth > 0 (inbound email).
- **Sentry / Better Stack**: env-only flag wired in code now (`SENTRY_DSN`); not provisioned by IaC. Skip until post-launch.

### 3.12 What we are explicitly **not** doing in v1

- WAF (revisit when we have a public widget surface).
- VPC flow logs (revisit for SOC2).
- AWS Config / GuardDuty (later).
- Multi-region failover.
- PR-preview ephemeral environments.
- Self-hosted Inngest.

---

## 4. Repo layout

```
salve/
├── infra/
│   ├── sst.config.ts                # entrypoint, stage routing
│   ├── components/
│   │   ├── network.ts               # VPC + subnets
│   │   ├── postgres.ts              # Aurora cluster + parameter group + secret
│   │   ├── redis.ts                 # ElastiCache Serverless
│   │   ├── buckets.ts               # 5 S3 buckets
│   │   ├── secrets.ts               # sst.Secret declarations
│   │   ├── ses.ts                   # outbound + inbound + receipt rules + SNS + SQS + Lambda
│   │   ├── api.ts                   # Hono Service on Fargate + ALB + domain
│   │   ├── zero-cache.ts            # Zero Service on Fargate + ALB + sticky cookie
│   │   ├── web.ts                   # StaticSite for Vite SPA
│   │   ├── migrate.ts               # ECS one-off task definition for drizzle-kit
│   │   └── monitoring.ts            # CloudWatch alarms + SNS topic for ops email
│   └── README.md
├── apps/
│   ├── api/
│   │   ├── Dockerfile               # multi-stage, bundles via tsdown
│   │   └── ...
│   ├── web/
│   │   └── ...                      # already has vite.config.ts
│   ├── zero-cache/
│   │   └── Dockerfile               # FROM rocicorp/zero:1.3.0 (or thin wrapper)
│   └── inngest-bridge/              # new: SES SNS → Inngest Lambda
│       ├── src/handler.ts
│       └── package.json
├── .github/
│   └── workflows/
│       ├── ci.yml                   # PR: type-check, biome, build, file-size
│       ├── deploy.yml               # main → sst diff → manual approve → sst deploy --stage prod
│       └── staging.yml              # manual workflow_dispatch: spin up / tear down on-demand staging
└── scripts/
    └── inngest-sync.sh              # called from CI after deploy
```

`apps/inngest-bridge` is a new app — it's the SES SNS → Inngest Cloud Lambda. It can't live in `apps/inngest` because that workspace is currently a placeholder; we keep them distinct because the bridge has a fundamentally different runtime (Lambda, AWS-event-driven) than the rest of the Inngest functions (Fargate, Inngest-Cloud-driven).

---

## 5. Bootstrap (one-time, manual, on Divyam's laptop)

Run once, in order. Each step is reversible.

### 5.1 SES production access
1. AWS Console → SES → "Account dashboard" → Request production access.
2. Use case: "Transactional support emails for B2B SaaS, opt-in customers only, bounce/complaint <0.1%". Include link to deliverability commitments.
3. **Wait 24–72h** before continuing past §5.7.

### 5.2 AWS CLI sanity check
```bash
aws sts get-caller-identity   # confirms .env keys work
aws sts get-caller-identity --region us-east-1
```

### 5.3 Install SST
```bash
pnpm add -D -w sst
mkdir -p infra
# Scaffold the config — see §6.1 for the file body
```

### 5.4 Initialize SST in account
```bash
cd infra
pnpm sst init                    # bootstraps the SSM-backed state
pnpm sst deploy --stage staging  # smoke test with a placeholder component
pnpm sst remove --stage staging  # tear it down — no standing dev stage
```

### 5.5 Hosted zone import
The hosted zone for `usesalve.com` already exists in Route 53. SST's `domain` field on `StaticSite` / `Service` will look it up by name automatically — no import step needed if we reference `'app.usesalve.com'` directly. Confirm the zone ID matches (`aws route53 list-hosted-zones`).

### 5.6 Inngest Cloud setup
1. https://app.inngest.com → create or open `salve` app.
2. Production environment → Manage → copy:
   - Event Key → `sst secret set INNGEST_EVENT_KEY --stage prod`.
   - Signing Key → `sst secret set INNGEST_SIGNING_KEY --stage prod`.
   - **Management API Key** (the one currently in `.env`) → `sst secret set INNGEST_API_KEY --stage prod`. Also mirror to the GH secret (§6.5).
3. When you spin up an on-demand `staging` stage, use Inngest's "branch environment" feature instead of a separate fixed env: set `INNGEST_ENV=staging` at runtime.

### 5.7 GitHub OIDC setup
After the first successful manual `sst deploy --stage prod`:
1. Provision an IAM role in `sst.config.ts` whose trust policy allows `token.actions.githubusercontent.com` for the repo `chandeldivyam/salve`.
2. Trust policy condition pins to `repo:chandeldivyam/salve:environment:production` (uses the GH `production` Environment for manual approval before the role is even assumable).
3. Role ARN → GitHub repo Settings → Secrets → `AWS_DEPLOY_ROLE`.
4. Rotate and **delete** the long-lived `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` from local `.env`.

### 5.8 First end-to-end deploy
```bash
sst deploy --stage prod    # provisions everything except per-tenant SES identities
```
Then manually:
- Verify the system DKIM CNAMEs in Route 53 (SST creates them automatically; check `dig +short CNAME ses-...` resolves).
- Hit `https://api.usesalve.com/healthz` → expect `{"status":"ok"}`.
- Open `https://app.usesalve.com` → SPA loads.

---

## 6. CI/CD workflows

### 6.1 `ci.yml` — runs on PRs, gated by GitHub's outside-collaborator approval

We're OSS, so anyone can open a PR. To avoid burning minutes on arbitrary fork code, we lean on GitHub's built-in approval gate:

**Setting applied** (2026-05-06, via `gh api`):
```
PUT /repos/chandeldivyam/salve/actions/permissions/fork-pr-contributor-approval
{ "approval_policy": "all_external_contributors" }
```

Effect: maintainer PRs run automatically; every external PR sits in "Workflows awaiting approval" until a maintainer clicks approve.

The `ci.yml` file:
- Trigger: `pull_request: branches: [main]` and `push: branches: [main]` (the `push` on main catches the case where someone bypasses PRs).
- Never use `pull_request_target` — that's the dangerous variant because it runs in the base-repo context with secrets.
- Jobs:
  1. **Setup**: `actions/checkout@v4`, `pnpm/action-setup@v4`, `actions/setup-node@v4` with `cache: pnpm`.
  2. `pnpm install --frozen-lockfile`.
  3. `pnpm run check` (Biome).
  4. `pnpm run type-check`.
  5. `pnpm run build`.
  6. `pnpm run check:file-sizes`.
  7. **(Optional)** `pnpm run test` once we have meaningful tests.

No secrets used. No deploys. If a PR's diff is risky, the approval gate gives us a beat to read the diff before code runs.

### 6.2 `deploy.yml` — push to `main` → `sst diff` → manual approve → deploy prod

Single deploy workflow, two jobs separated by a manual approval gate.

- Trigger: `push: branches: [main]`.
- Concurrency: `group: deploy-prod`, `cancel-in-progress: false`.
- Job 1: **`diff`** (no approval needed, no AWS write access)
  1. Setup (checkout + pnpm + node + install).
  2. `aws-actions/configure-aws-credentials@v4` assuming a **read-only** role (`AWS_DIFF_ROLE`).
  3. `pnpm sst diff --stage prod` — captures the IaC plan.
  4. Post the diff as a workflow summary so the approver can read it before clicking approve. Optionally `gh pr comment` if the deploy was triggered by a PR-merge.
- Job 2: **`apply`**
  1. `needs: diff`.
  2. `environment: production` — this is the GH-native approval gate. The job won't start until you click "Approve and run" in the Actions UI.
  3. Setup again (artifacts can be passed if needed).
  4. `configure-aws-credentials` with the **deploy** role (`AWS_DEPLOY_ROLE`). The role's trust policy requires `environment:production` so it's literally unassumable until the gate is passed.
  5. **(Migration step)**: only if `packages/db/src/migrations/` changed since last deploy:
     ```yaml
     - name: Detect migration changes
       id: migrations
       run: |
         git diff --name-only ${{ github.event.before }} ${{ github.sha }} \
           | grep -q 'packages/db/src/migrations/' \
           && echo "run=true" >> $GITHUB_OUTPUT \
           || echo "run=false" >> $GITHUB_OUTPUT
     - name: Run migrations
       if: steps.migrations.outputs.run == 'true'
       run: aws ecs run-task --cluster salve-prod --task-definition salve-migrate-prod ...
     ```
     Migrations run **before** the new code rolls out. Drizzle migrations are forward-only by convention; destructive migrations must be called out in the commit message.
  6. `pnpm sst deploy --stage prod` from `infra/`.
  7. **(Inngest sync)**: `bash scripts/inngest-sync.sh prod`.

Rollback: forward-only. If a deploy or migration breaks prod, cut a fix-forward commit. Aurora point-in-time restore is the escape hatch for data corruption (5-minute granularity).

### 6.3 `staging.yml` — manual on-demand staging

For risky changes (big migrations, SES rule changes, IaC refactors). Triggered manually via the Actions UI.

- Trigger: `workflow_dispatch` with two inputs: `action` (`deploy` | `remove`) and `ref` (the git ref to deploy).
- Same shape as the prod `apply` job but `--stage staging`.
- Uses the same `AWS_DEPLOY_ROLE` (the trust policy allows `environment:staging` *or* `environment:production` so we don't need a second role).
- Subdomains: `app-staging.usesalve.com`, `api-staging.usesalve.com`, `sync-staging.usesalve.com`. SST appends the stage name automatically when configured.
- **Always run `sst remove --stage staging` when done.** A forgotten staging stage is the most likely way this plan turns into a $200/mo line item.

### 6.4 Required GitHub secrets

| Secret              | Used by      | Notes                                                |
|---------------------|--------------|------------------------------------------------------|
| `AWS_DIFF_ROLE`     | deploy.yml   | OIDC role ARN, **read-only** (ListAll, DescribeAll, GetTemplate). No environment gate — runs on every push. |
| `AWS_DEPLOY_ROLE`   | deploy.yml + staging.yml | OIDC role ARN with full provisioning rights. Trust policy gates on `environment:production` or `environment:staging`. |
| `INNGEST_API_KEY`   | deploy.yml   | Inngest management API token for the post-deploy app sync. |

All other runtime secrets live in `sst.Secret` / AWS Secrets Manager — never in GitHub.

### 6.5 `inngest-sync.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail
STAGE="${1:?stage required}"
case "$STAGE" in
  prod)    URL="https://api.usesalve.com/api/inngest" ;;
  staging) URL="https://api-staging.usesalve.com/api/inngest" ;;
  *)       echo "unknown stage: $STAGE" >&2; exit 1 ;;
esac
curl -fsSL -X PUT \
  -H "Authorization: Bearer $INNGEST_API_KEY" \
  "https://api.inngest.com/v2/apps/sync?url=$URL"
```

---

## 7. Implementation roadmap (sequenced PRs)

Each PR is ~½–1 day of focused work. Each ends with a runnable, verifiable state.

All PRs deploy directly against the `prod` stage on merge to `main` (after `sst diff` + manual approval). For risky changes, spin up `staging` first via `staging.yml`, exercise it, tear it down, then merge to main. The `production` GitHub Environment protection ensures no PR auto-deploys without your approval click.

| PR  | Title                                              | Verification                                                    |
|-----|----------------------------------------------------|------------------------------------------------------------------|
| 1   | Bootstrap SST + smoke `staging` stage              | `sst deploy --stage staging` succeeds; placeholder bucket created; `sst remove --stage staging` clean |
| 2   | VPC + Aurora Postgres + parameter group            | Connect from a bastion; `SHOW wal_level` → `logical`             |
| 3   | ECR repo + `apps/api` Dockerfile + bundle script   | `docker build` succeeds locally; image runs against local DB     |
| 4   | API `Service` with public ALB + domain             | `curl https://api.usesalve.com/healthz` → `200`                  |
| 5   | `apps/web` `StaticSite` with VITE_* envs           | `https://app.usesalve.com` loads, points at api                  |
| 6   | `apps/zero-cache` Dockerfile + `Service` + sticky  | Two browser tabs sync via `sync.usesalve.com`                    |
| 7   | Migration task + GH workflow gating                | Ship a no-op migration via `staging`; verify in DB; then prod    |
| 8   | Secrets Manager + sst.Secret wiring                | `process.env.AUTH_SECRET` resolves in deployed API               |
| 9   | SES outbound system identity + DKIM CNAMEs         | DKIM `Verified` in SES console; mail-tester score ≥9             |
| 10  | SES inbound rule set + S3 + SNS + SQS + Lambda     | Send mail to `inbound+...@in.usesalve.com` → S3 object lands     |
| 11  | Inngest Cloud sync step + production env wiring    | Inngest dashboard shows function manifest after CI run           |
| 12  | GitHub OIDC roles (diff + deploy) + `deploy.yml`   | Push to main → diff posted → manual approve → green deploy       |
| 13  | `staging.yml` workflow_dispatch                    | Manual trigger spins up + tears down a staging stage             |
| 14  | CloudWatch alarms + SNS ops topic                  | Force a 5xx → ops email arrives                                  |
| 15  | Cutover: rotate AWS root keys, delete from `.env`  | OIDC remains green; old keys revoked                             |

---

## 8. Cost rough-cut (monthly, us-east-1, prod-only)

Assuming **~10 active workspaces, ~1k DAU, low email volume** (post-launch, pre-scale). One stage only — staging is on-demand and tears down after use, so it doesn't appear here.

| Component                       | Estimate    |
|---------------------------------|-------------|
| Aurora `db.t4g.medium` (1 writer, burstable, Unlimited mode) | $50–70 (depends on CPU credit usage) |
| Fargate API (1 task, 0.5/1)     | $15         |
| Fargate zero-cache (1 task, 1/2)| $30         |
| ALB × 2 (api + sync)            | $35         |
| CloudFront + S3 (low traffic)   | $5          |
| ElastiCache Serverless          | $25         |
| SES (10k emails)                | $1          |
| Route 53 + ACM                  | $1          |
| NAT Gateway                     | $35         |
| CloudWatch logs/metrics         | $15         |
| **Total**                       | **~$210/mo** |

Inngest Cloud free tier covers initial volume (50k steps/month). Above that, $20/mo Pro tier.

**When to upgrade the DB**: graduate from `t4g.medium` to `m7g.large` ($130/mo) once we see sustained CPUUtilization >40% over a week, or `CPUCreditBalance` consistently at 0. Add a reader replica (`m7g.large` × 2) when we need to offload analytics queries — not before.

At 100k DAU we revisit the whole stack: split zero-cache view-syncer/replication-manager, scale Fargate, add Aurora reader.

---

## 9. Open questions / decisions needed before kickoff

All decisions locked (2026-05-06):

- **Stages**: prod-only with on-demand staging.
- **Account**: single AWS account.
- **Region**: `us-east-1`.
- **CI**: GitHub Actions (not SST Console).
- **External-PR approval**: enabled (`all_external_contributors`).
- **SES production access**: deferred to PR 10. Sandbox is sufficient for PRs 1–9.
- **Apex `usesalve.com`**: 301 redirect → `app.usesalve.com`.
- **Backups SLA**: Aurora default 7-day automated retention.
- **Sentry / Better Stack**: env-flag-only for v1 (no IaC); revisit post-launch.

---

## 10. What to verify during implementation (the gotchas)

These are the things that tend to bite at deploy time. Pinned here so we don't relearn them:

1. **SST `Service` stickiness API** — confirm whether `loadBalancer.stickiness` is a first-class field or whether we need `transform.targetGroup` to set `lb_cookie`. Load-bearing for zero-cache. Check on `https://sst.dev/docs/component/aws/service` at PR 6.
2. **`aws-actions/configure-aws-credentials`** — confirm v4 vs v5 at PR 12.
3. **Aurora Postgres 16 cluster parameter group** must use `rds.logical_replication=1` (the Aurora-specific knob), not `wal_level=logical` directly. Reboot required.
4. **CloudFront ↔ ACM region**: SPA cert must be in `us-east-1`; ALB cert must be in the deployment region. SST handles this if we name the right component, but we'll watch for it.
5. **Better-auth cookie domain**: must be `.usesalve.com` (note leading dot) so `app.` and `api.` share the JWT cookie. Easy to miss.
6. **Vite build-time env vars**: changing `VITE_API_URL` requires a full rebuild of the web bundle. CI must invalidate CloudFront after S3 sync (SST does this automatically).
7. **IPv6 / `localhost`**: on Fargate the same `127.0.0.1` lesson from `AGENTS.md` doesn't apply (containers are isolated), but the Hono server **must bind `0.0.0.0`**, not `127.0.0.1`. Sanity-check `serve({ hostname: '0.0.0.0', port: 3001 })` in `server.ts` before PR 4.
8. **Inngest serve URL**: must include `process.env.INNGEST_SERVE_ORIGIN` matching the public URL (`https://api.usesalve.com`) so signature verification works behind the ALB.
9. **Postgres replication slot leaks**: if we ever change `ZERO_APP_ID` or replace zero-cache without releasing slots, Postgres slowly fills its WAL. Add the CloudWatch alarm on `pg_replication_slots.active=false AND restart_lsn` lag (PR 14).

---

## 11. Rollback strategy

- **App rollback**: `sst deploy --stage prod` from a previous git ref. SST diffs and rolls forward; ALB target groups swap atomically.
- **Migration rollback**: forward-only. If a migration breaks prod, cut a fix-forward PR. We don't ship `down` migrations because they're rarely correct under concurrent load.
- **DNS rollback**: Route 53 records are managed by SST. To pin DNS during a hot incident, we can manually edit the record TTL down to 60s ahead of any risky deploy.
- **Aurora rollback**: point-in-time restore (5-minute granularity). Cuts a new cluster; we update `DATABASE_URL` secret and redeploy.

---

## 12. Launch checklist (flip these before going public)

We're in **pre-launch mode** right now: every resource is destroyable so we can iterate on IaC quickly. Before opening the doors to real users, walk this list:

- [ ] `sst.config.ts`: change `removal: 'remove'` → `input?.stage === 'prod' ? 'retain' : 'remove'`. Stops `sst remove --stage prod` from nuking data.
- [ ] `sst.config.ts`: change `protect: false` → `input?.stage === 'prod'`. Requires explicit code change before any prod resource can be removed.
- [ ] Aurora: enable deletion protection on the cluster (`deletionProtection: true` in the postgres component).
- [ ] Aurora: enable point-in-time recovery + extend backup retention from 7 days → 30 days.
- [ ] S3 buckets: confirm `Versioning: Enabled` on attachments, raw-email.
- [ ] SES: production access granted (out of sandbox).
- [ ] CloudFront: enable WAF (rate-limit rule + AWS managed bot-control rule).
- [ ] Aurora: rotate master credentials, confirm Secrets Manager rotation schedule.
- [ ] GitHub: enable branch protection on `main` (require PR + 1 reviewer + status checks pass).
- [ ] Audit IAM roles for least privilege (the deploy role is broad during bootstrap).
- [ ] CloudWatch alarms wired to a real SNS topic with on-call email.

Until this list is checked off, the `protect`/`retain` flags are off and `sst remove --stage prod` will delete everything. That's intentional during build-out.

---

## 13. References

- Canonical project plan: `~/.claude/plans/https-zero-rocicorp-dev-docs-introductio-buzzing-reddy.md`
- AGENTS.md (`#deployment topology` section, `#email subsystem`)
- Rocicorp Zero deployment: https://zero.rocicorp.dev/docs/deployment
- Rocicorp Zero config: https://zero.rocicorp.dev/docs/zero-cache-config
- SST v3 components: https://sst.dev/docs/component/aws/service · https://sst.dev/docs/component/aws/static-site · https://sst.dev/docs/component/aws/cluster
- Inngest Cloud serve: https://www.inngest.com/docs/sdk/serve
- Inngest signing keys: https://www.inngest.com/docs/platform/signing-keys
- Inngest app sync API: `PUT https://api.inngest.com/v2/apps/sync`
- Hello-Zero reference: `/tmp/hello-zero-fresh/sst.config.ts` (when available locally)

---

**Next action**: review §9 open questions, give thumbs up, then I can start cutting PR 1 (bootstrap SST + dev-stage smoke component).
