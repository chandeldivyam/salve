// drizzle-kit configuration. Points at the split schema in src/schema/index.ts.
// Run via `pnpm db:generate` (creates migration files) and `pnpm db:migrate`
// (applies pending migrations) from the repo root or this package.

import { defineConfig } from 'drizzle-kit';

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgres://opendesk:opendesk@localhost:5433/opendesk';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './src/migrations',
  dbCredentials: {
    url: databaseUrl,
  },
  // Reduce noise during interactive `db:push`.
  strict: true,
  verbose: true,
});
