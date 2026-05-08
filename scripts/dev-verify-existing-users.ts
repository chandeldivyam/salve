// dev-only one-shot script: marks all existing unverified users as emailVerified = true.
// Run once after enabling requireEmailVerification so pre-existing dev accounts can still sign in.
//
// Usage: DATABASE_URL=<url> npx tsx scripts/dev-verify-existing-users.ts --i-really-mean-it
// Guard: refuses to run in production AND requires the --i-really-mean-it flag.

import postgres from 'postgres';

const args = process.argv.slice(2);
if (!args.includes('--i-really-mean-it')) {
  console.error(
    'Refused: pass --i-really-mean-it to confirm you want to run this dev-only script.',
  );
  process.exit(1);
}

if (process.env.NODE_ENV === 'production') {
  console.error('Refused: this script must not run in production.');
  process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

async function run() {
  const sql = postgres(databaseUrl as string);
  try {
    const result = await sql`
      UPDATE "user"
      SET "emailVerified" = true
      WHERE "emailVerified" IS NULL OR "emailVerified" = false
    `;
    console.log(`Updated ${result.count} user(s) to emailVerified = true.`);
  } finally {
    await sql.end();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
