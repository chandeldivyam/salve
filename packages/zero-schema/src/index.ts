// @opendesk/zero-schema — Zero schema, custom queries, and permission helpers.
// Shared between apps/web (typed Zero client) and apps/api (zero-cache + permission deploy).
//
// TODO Phase 2: Define the real schema.ts mirroring packages/db (Drizzle source-of-truth).
// Until then this file just exports the schema name; zero-cache-dev is intentionally NOT
// wired into `pnpm dev` yet — it has nothing to read.

export const ZERO_SCHEMA_NAME = 'opendesk' as const;
export const ZERO_SCHEMA_VERSION = 0 as const;
