// Run Drizzle migrations programmatically — no spinner, errors print clearly.
// Used by the prod migrate Task; avoids drizzle-kit's TTY redraw which gets
// mangled in CloudWatch logs.

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const sql = postgres(databaseUrl, {
  max: 1,
  ssl: 'require',
  // Print every NOTICE so DDL trigger messages from Zero land in logs but
  // only at debug level — they're noise, not errors.
  onnotice: () => {},
});
const db = drizzle(sql);

// One-shot reset for pre-launch iteration. Drops public schema + reapplies
// all migrations. NEVER set this in production with real data.
if (process.env.RESET_SCHEMA === '1') {
  console.log('RESET_SCHEMA=1: dropping + recreating public schema...');
  try {
    // Zero installs DDL triggers in `_zero` schemas; drop those too so the
    // next zero-cache restart can recreate cleanly.
    await sql`DROP SCHEMA IF EXISTS public CASCADE`;
    await sql`CREATE SCHEMA public`;
    await sql`GRANT ALL ON SCHEMA public TO PUBLIC`;
    // CRITICAL: drizzle-orm/postgres-js/migrator records applied migrations
    // in `drizzle.__drizzle_migrations`. If we drop `public` but leave the
    // `drizzle` schema intact, the next `migrate()` call thinks every
    // migration is already applied and skips them — leaving public empty.
    // Drop drizzle's tracking schema too so migrations rerun from scratch.
    await sql`DROP SCHEMA IF EXISTS drizzle CASCADE`;
    // Drop any zero-managed schemas created by a previous zero-cache run.
    const zeroSchemas = await sql`
      SELECT schema_name FROM information_schema.schemata
      WHERE schema_name LIKE '\\_zero%' ESCAPE '\\' OR schema_name LIKE 'zero\\_%' ESCAPE '\\'
    `;
    for (const row of zeroSchemas) {
      await sql.unsafe(`DROP SCHEMA IF EXISTS "${row.schema_name}" CASCADE`);
      console.log(`  dropped schema ${row.schema_name}`);
    }
    console.log('Schema reset done.');
  } catch (err) {
    console.error('Schema reset failed:', err);
    await sql.end();
    process.exit(1);
  }
}

// Extensions normally installed by scripts/init-db.sql in dev. Aurora doesn't
// run init scripts, so we ensure them here. Idempotent (`IF NOT EXISTS`).
console.log('Ensuring required Postgres extensions...');
try {
  await sql`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`;
  await sql`CREATE EXTENSION IF NOT EXISTS "pg_trgm"`;
  await sql`CREATE EXTENSION IF NOT EXISTS "unaccent"`;
  await sql`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`;
  console.log('Extensions ready.');
} catch (err) {
  console.error('Extension setup failed:', err);
  await sql.end();
  process.exit(1);
}

console.log('Applying migrations from packages/db/src/migrations ...');
try {
  await migrate(db, { migrationsFolder: './src/migrations' });
  console.log('Migrations applied.');
  await sql.end();
  process.exit(0);
} catch (err) {
  console.error('Migration failed:');
  console.error(err);
  if (err && typeof err === 'object') {
    for (const [k, v] of Object.entries(err)) {
      console.error(`  ${k}: ${v}`);
    }
  }
  await sql.end();
  process.exit(1);
}
