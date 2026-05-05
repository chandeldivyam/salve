// @salve/db — Drizzle client built from process.env.DATABASE_URL.
// Uses the `postgres` driver (not `pg`) per Drizzle's modern recommendation.

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.js';

function readDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Configure it in your env (apps/api/.env for the API server).',
    );
  }
  return url;
}

// Lazily create the connection so importing the module never crashes when env
// is absent (e.g. during type-check). The first DB call triggers connection.
let _client: postgres.Sql | undefined;
let _db: ReturnType<typeof drizzle<typeof schema>> | undefined;

export function getClient(): postgres.Sql {
  if (!_client) {
    _client = postgres(readDatabaseUrl(), {
      max: 10,
      // The `idle_timeout` keeps long-running dev processes (tsx watch) clean.
      idle_timeout: 20,
    });
  }
  return _client;
}

export function getDb() {
  if (!_db) {
    _db = drizzle(getClient(), { schema });
  }
  return _db;
}

export type Database = ReturnType<typeof getDb>;
export { schema };
