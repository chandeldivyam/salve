// Diagnostic: dump current DB connection target + schemas + key tables.
import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL missing');
  process.exit(1);
}
console.log('Connecting...');
const sql = postgres(url, { max: 1, ssl: 'require', onnotice: () => {} });

const [{ db }] = await sql`SELECT current_database() AS db`;
const [{ user }] = await sql`SELECT current_user AS user`;
const [{ search_path }] = await sql`SHOW search_path`;
console.log('database :', db);
console.log('user     :', user);
console.log('search_path:', search_path);

console.log('\n-- schemas --');
const schemas = await sql`SELECT schema_name FROM information_schema.schemata ORDER BY schema_name`;
for (const r of schemas) console.log(' ', r.schema_name);

console.log('\n-- public tables --');
const tables = await sql`
  SELECT table_schema, table_name
  FROM information_schema.tables
  WHERE table_schema NOT IN ('pg_catalog','information_schema')
  ORDER BY table_schema, table_name
`;
for (const r of tables) console.log(' ', r.table_schema, '.', r.table_name);

console.log('\n-- user table specifically --');
const u = await sql`
  SELECT table_schema, table_name
  FROM information_schema.tables
  WHERE table_name = 'user'
`;
console.log(JSON.stringify(u, null, 2));

console.log('\n-- drizzle migrations --');
try {
  const ms = await sql`SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id`;
  for (const r of ms) console.log(' ', r.id, r.hash.slice(0, 12), r.created_at);
} catch (e) {
  console.log(' err:', e.message);
}

await sql.end();
process.exit(0);
