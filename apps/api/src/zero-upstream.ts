import { schema } from '@opendesk/zero-schema';
import { zeroPostgresJS } from '@rocicorp/zero/server/adapters/postgresjs';

const upstreamDB = process.env.DATABASE_URL ?? '';
let zql: ReturnType<typeof zeroPostgresJS<typeof schema>> | undefined;

export function getZql() {
  if (!zql) {
    if (!upstreamDB) throw new Error('DATABASE_URL is not set; cannot init Zero server adapter');
    // Keep this postgres.js client independent from Drizzle. Zero's server
    // adapter expects its own transaction wrapper and pinned postgres version.
    zql = zeroPostgresJS(schema, upstreamDB);
  }
  return zql;
}
