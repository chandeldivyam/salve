// Migration subsystem schema.
//
// `migration_run` is one row per migration attempt per workspace; carries
// status + counters + parameters.
//
// `migration_external_id_map` is the idempotency primitive: every row written
// by an importer is keyed by (workspace, source, entity_type, source_id) so
// re-runs and retries find existing target rows instead of duplicating.
//
// `migration_webhook_subscription` and `migration_event_inbox` power the
// Phase 4a delta-sync pipeline. See docs/atlas-migration-rfc.md §16.4.
//
// Secrets live in the `secrets` schema (`secrets.migration_credential`,
// `secrets.migration_webhook_credential`) so they are NOT replicated into
// zero-cache. Zero's default Postgres publication is `FOR TABLES IN SCHEMA
// public`, which excludes any non-public schema. This is enforced by schema
// boundary, not by column-list filtering on the publication — column lists
// over a schema-wide publication compose by union, so excluding columns from
// `public` would have to list every other table explicitly, which is a
// maintenance trap.

import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgSchema,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { organization } from './auth.js';

/**
 * Non-public schema for credentials. Zero never replicates this — see the
 * file header comment for why this lives off-schema instead of as a
 * column-restricted publication.
 */
const secretsSchema = pgSchema('secrets');

export const migrationRunStatus = pgEnum('migration_run_status', [
  'pending',
  'discovering',
  'backfilling',
  'completed',
  'failed',
  'cancelled',
]);

export const migrationRun = pgTable(
  'migration_run',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    source: text('source').notNull(),
    status: migrationRunStatus('status').notNull().default('pending'),
    // Free-form bag: api host, api key (encrypted later), maxTickets, etc.
    params: jsonb('params').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    counters: jsonb('counters').$type<Record<string, number>>().notNull().default(sql`'{}'::jsonb`),
    /** True iff `params.apiKey` is set; safe to expose to the UI so we can
     *  gate "Add webhook" buttons without leaking the key itself. */
    hasApiKey: boolean('has_api_key').notNull().default(false),
    error: text('error'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    workspaceIdx: index('migration_run_workspace_idx').on(t.workspaceId, t.startedAt),
  }),
);

export const migrationExternalIdMap = pgTable(
  'migration_external_id_map',
  {
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    source: text('source').notNull(),
    entityType: text('entity_type').notNull(),
    sourceId: text('source_id').notNull(),
    targetId: text('target_id').notNull(),
    runId: text('run_id'),
    payloadHash: text('payload_hash'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: uniqueIndex('migration_eim_pk').on(t.workspaceId, t.source, t.entityType, t.sourceId),
    targetIdx: index('migration_eim_target_idx').on(
      t.workspaceId,
      t.source,
      t.entityType,
      t.targetId,
    ),
    // Used by the read-only mirror gate in server-mutators.ts on every
    // customer reply. The predicate there is (workspace, entity_type,
    // target_id) — source-agnostic by intent so a future non-Atlas source
    // also enforces read-only mirroring — so this is a dedicated covering
    // index rather than relying on a skip-scan of `migration_eim_target_idx`.
    importedTicketGateIdx: index('migration_eim_imported_ticket_gate_idx').on(
      t.workspaceId,
      t.entityType,
      t.targetId,
    ),
  }),
);

// One row per Atlas event subscription. Created when the operator toggles an
// event on; deactivated when toggled off (we also call Atlas to deactivate).
// `signing_secret` lives in `secrets.migration_webhook_credential` so it is
// never replicated to zero-cache.
export const migrationWebhookSubscription = pgTable(
  'migration_webhook_subscription',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    runId: text('run_id'),
    source: text('source').notNull(),
    event: text('event').notNull(),
    remoteId: text('remote_id').notNull(),
    endpoint: text('endpoint').notNull(),
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    unique: uniqueIndex('migration_webhook_sub_unique').on(t.workspaceId, t.source, t.event),
  }),
);

// Inbound event queue. Every webhook POST inserts here, returns 200, then
// Inngest applies. Dedup'd via `delivery_key` (sha256 of ws+sub+ts+body) since
// Atlas does not send a delivery id.
export const migrationEventInbox = pgTable(
  'migration_event_inbox',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    runId: text('run_id'),
    source: text('source').notNull(),
    subscriptionId: text('subscription_id'),
    eventType: text('event_type').notNull(),
    deliveryKey: text('delivery_key').notNull(),
    atlasTimestamp: text('atlas_timestamp').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    attemptCount: integer('attempt_count').notNull().default(0),
    error: text('error'),
    errorKind: text('error_kind'),
  },
  (t) => ({
    dedup: uniqueIndex('migration_event_inbox_dedup').on(t.workspaceId, t.deliveryKey),
    // Partial index — most inbox rows reach processed_at quickly; the worker
    // sweep only ever cares about rows that haven't been processed yet.
    pending: index('migration_event_inbox_pending')
      .on(t.workspaceId, t.processedAt)
      .where(sql`processed_at IS NULL`),
  }),
);

// ---------- Secrets (off-public schema, not replicated to zero-cache) ----------

/**
 * One row per migration_run that has an Atlas API key. Splitting from
 * migration_run keeps the key out of the Zero replication path while
 * preserving `migration_run.has_api_key` as the UI-safe boolean projection.
 */
export const migrationCredential = secretsSchema.table('migration_credential', {
  // PK = migration_run.id (cascade delete when the run is removed).
  runId: text('run_id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  apiKey: text('api_key').notNull(),
  baseUrl: text('base_url'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * One row per webhook subscription that has an active signing secret.
 * Atlas issues secrets once on create; rotating means recreate.
 */
export const migrationWebhookCredential = secretsSchema.table('migration_webhook_credential', {
  subscriptionId: text('subscription_id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  signingSecret: text('signing_secret').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
