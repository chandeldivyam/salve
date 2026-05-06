# syntax=docker/dockerfile:1.7

# Multi-stage build for @salve/api.
#   1. base   — node:22-alpine + pnpm via corepack
#   2. deps   — full monorepo install (uses workspace lockfile)
#   3. build  — runs `tsdown` to bundle src/server.ts → dist/server.mjs
#   4. prod   — `pnpm deploy --prod` extracts api + only its prod deps
#   5. final  — node:22-alpine with bundle + minimal node_modules
#
# The runtime image is ~150 MB (vs ~600 MB if we copied the whole monorepo).

FROM node:22-alpine AS base
ENV PNPM_HOME=/usr/local/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate

FROM base AS deps
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/cli/package.json apps/cli/
COPY apps/inngest/package.json apps/inngest/
COPY apps/mcp/package.json apps/mcp/
COPY apps/web/package.json apps/web/
COPY apps/zero-cache/package.json apps/zero-cache/
COPY packages/action-contracts/package.json packages/action-contracts/
COPY packages/action-executor/package.json packages/action-executor/
COPY packages/api-client/package.json packages/api-client/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/mutators/package.json packages/mutators/
COPY packages/ui/package.json packages/ui/
COPY packages/zero-schema/package.json packages/zero-schema/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm --filter @salve/api build

FROM build AS prod
# `pnpm deploy --prod` resolves the workspace + ships only prod deps.
# `--legacy` is required on pnpm 10+ when `inject-workspace-packages` is off
# (default). Workspace deps are already inlined into dist/server.mjs by tsdown,
# so we don't need them in node_modules — `deploy --prod` correctly excludes them.
RUN pnpm --filter @salve/api deploy --prod --legacy /out

FROM node:22-alpine AS final
WORKDIR /app
RUN apk add --no-cache tini && addgroup -S salve && adduser -S salve -G salve
COPY --from=prod --chown=salve:salve /out/node_modules ./node_modules
COPY --from=prod --chown=salve:salve /out/package.json ./package.json
COPY --from=build --chown=salve:salve /repo/apps/api/dist ./dist
USER salve
ENV NODE_ENV=production
ENV PORT=3001
EXPOSE 3001
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.mjs"]

# ----------------------------------------------------------------------------
# Migration runner — used by infra/components/migrate.ts (sst.aws.Task).
# Reuses the `build` stage (has dev deps including drizzle-kit). Triggered via
# `aws ecs run-task` after a deploy; reads DATABASE_URL from env, applies any
# pending Drizzle migrations to Aurora, exits.
# ----------------------------------------------------------------------------
FROM build AS migrate
WORKDIR /repo/packages/db
ENV NODE_ENV=production
CMD ["node", "scripts/migrate-prod.mjs"]
