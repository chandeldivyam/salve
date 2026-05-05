// @salve/db — Drizzle schema, client, and migrations.
// Phase 1: better-auth tables (user/session/account/verification, organization/member/invitation).
// Phase 2 will mirror the help-desk domain (tickets, messages, etc.) into the schema.

export const DB_PACKAGE = '@salve/db' as const;

export { type Database, getClient, getDb, schema } from './client.js';
export * as authSchema from './schema/auth.js';
