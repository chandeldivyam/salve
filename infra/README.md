# Salve infrastructure

SST v4 (Ion) — see [`docs/cicd-plan.md`](../docs/cicd-plan.md) for the full
deployment topology and decision log.

## Layout

```
sst.config.ts                     # entrypoint (lives at repo root, SST convention)
infra/
├── components/                   # one file per AWS component, imported by sst.config.ts
│   ├── smoke.ts                  # PR 1 only — temporary S3 bucket to prove the deploy path
│   ├── network.ts                # PR 2 — VPC + subnets
│   ├── postgres.ts               # PR 2 — Aurora Postgres 16 cluster
│   ├── redis.ts                  # PR 2 — ElastiCache Serverless Redis
│   ├── buckets.ts                # PR 2 — S3 buckets (attachments, raw email, zero replicas)
│   ├── secrets.ts                # PR 8 — sst.Secret declarations
│   ├── api.ts                    # PR 4 — Hono Service on Fargate + ALB
│   ├── zero-cache.ts             # PR 6 — Zero Service on Fargate + sticky cookie
│   ├── web.ts                    # PR 5 — Vite SPA via StaticSite (app.usesalve.com)
│   ├── marketing.ts              # Next.js marketing site via sst.aws.Nextjs (apex usesalve.com)
│   ├── ses.ts                    # PR 9–10 — outbound + inbound + receipt rules + SNS + SQS + Lambda
│   ├── migrate.ts                # PR 7 — one-off ECS task for drizzle-kit migrate
│   └── monitoring.ts             # PR 14 — CloudWatch alarms + SNS ops topic
└── README.md                     # this file
```

## Stages

- **`prod`** — long-lived. Deploys exclusively via `.github/workflows/deploy.yml`
  with manual approval. Resources have `removal: retain` to prevent accidental
  destruction.
- **`staging`** — on-demand. Spin up for risky changes (migrations, SES rule
  changes, IaC refactors), exercise, then `sst remove --stage staging`. No
  standing dev stage — saves ~$130–185/mo.

## Local commands

```bash
# Bootstrap a staging stage (creates real AWS resources, costs apply while up):
pnpm sst:deploy:staging

# Tear it down:
pnpm sst:remove:staging

# Diff against prod (read-only, safe):
pnpm sst:diff:prod
```

The CI workflow in `.github/workflows/deploy.yml` uses `sst diff` followed by
manual approval gate on the `production` GitHub Environment, then `sst deploy
--stage prod`.
