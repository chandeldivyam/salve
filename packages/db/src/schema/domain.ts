// Phase 2a: domain entities for the help-desk MVP.
//
// Multi-tenant boundary: every row carries `workspaceId` (FK to better-auth's
// `organization.id`, which is a TEXT id). Postgres is the source of truth;
// Zero (in `@opendesk/zero-schema`) mirrors these tables.
//
// Notes:
// - Timestamps are `timestamptz` so Postgres knows the timezone. Zero's
//   PG → ZQL type map converts `timestamptz` to `number` (epoch ms,
//   floating point) automatically — no mirror columns needed. See
//   `packages/zero-schema/src/schema.ts` for the mirror declarations.
// - `ticket.shortId` is assigned per-workspace by a SQL trigger appended to
//   the migration (drizzle-kit doesn't model triggers natively).
// - Enums are real Postgres enum types so Zero can pick them up via
//   `enumeration<...>()`.
// - We DON'T cascade-delete on `workspaceId` because the better-auth
//   `organization` table is text-keyed and we want explicit cleanup paths;
//   we just declare the FK to enforce referential integrity.

import { sql } from 'drizzle-orm';
import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { organization, user } from './auth.js';

const tsvector = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'tsvector';
  },
});

// ---------- Enums ----------

export const ticketStatus = pgEnum('ticket_status', [
  'open',
  'in_progress',
  'snoozed',
  'resolved',
  'closed',
]);

export const ticketPriority = pgEnum('ticket_priority', ['low', 'normal', 'high', 'urgent']);

export const messageAuthorType = pgEnum('message_author_type', ['customer', 'agent', 'system']);

export const customerNoteObjectType = pgEnum('customer_note_object_type', ['customer', 'ticket']);

// ---------- Tables ----------

export const customer = pgTable(
  'customer',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    name: text('name'),
    // Phase 3a (research §3): a single human can have many addresses. Lookups
    // through `EmailCustomerMatcher`-equivalent (3b) check this column too.
    // Stored as JSONB array (not Postgres `text[]`) because Zero's SQLite
    // replica doesn't handle PG array types natively; JSONB round-trips fine.
    alternateEmails: jsonb('alternate_emails').notNull().default(sql`'[]'::jsonb`),
    displayName: text('display_name'),
    avatarUrl: text('avatar_url'),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    phone: text('phone'),
    location: text('location'),
    metadata: jsonb('metadata')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    searchVector: tsvector('search_vector').generatedAlwaysAs(
      sql`to_tsvector('simple', coalesce("name", '') || ' ' || coalesce("display_name", '') || ' ' || coalesce("email", ''))`,
    ),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    workspaceEmailIdx: index('customer_workspace_email_idx').on(t.workspaceId, t.email),
    workspaceEmailUnique: uniqueIndex('customer_workspace_email_unique').on(t.workspaceId, t.email),
    searchVectorIdx: index('customer_search_vector_idx').using('gin', t.searchVector),
    nameTrgmIdx: index('customer_name_trgm_idx').using('gin', t.name.op('gin_trgm_ops')),
    displayNameTrgmIdx: index('customer_display_name_trgm_idx').using(
      'gin',
      t.displayName.op('gin_trgm_ops'),
    ),
    emailTrgmIdx: index('customer_email_trgm_idx').using('gin', t.email.op('gin_trgm_ops')),
  }),
);

export const ticket = pgTable(
  'ticket',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    // Per-workspace incrementing integer; trigger fills this on insert when
    // the value is NULL or 0. Don't rely on the column default — the trigger
    // owns assignment so we get gap-free per-workspace numbering.
    shortId: integer('short_id').notNull().default(0),
    title: text('title').notNull(),
    description: text('description'),
    status: ticketStatus('status').notNull().default('open'),
    priority: ticketPriority('priority').notNull().default('normal'),
    customerId: uuid('customer_id').references(() => customer.id, { onDelete: 'set null' }),
    // better-auth user id is TEXT.
    assigneeId: text('assignee_id').references(() => user.id, { onDelete: 'set null' }),
    createdById: text('created_by_id').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    firstResponseAt: timestamp('first_response_at', { withTimezone: true }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    // Phase 3a: closed_at is read in Phase 3b's "closed-ticket reopen window"
    // logic (research §1). Stamped by `ticket.close` mutator on transition to
    // closed (resolved doesn't fill it).
    closedAt: timestamp('closed_at', { withTimezone: true }),
    closedById: text('closed_by_id').references(() => user.id, { onDelete: 'set null' }),
    searchVector: tsvector('search_vector').generatedAlwaysAs(
      sql`to_tsvector('simple', coalesce("title", '') || ' ' || coalesce("description", ''))`,
    ),
  },
  (t) => ({
    inboxIdx: index('ticket_inbox_idx').on(t.workspaceId, t.status, t.updatedAt),
    assigneeIdx: index('ticket_assignee_idx').on(t.workspaceId, t.assigneeId, t.status),
    createdAtIdx: index('ticket_created_at_idx').on(t.workspaceId, t.createdAt),
    searchVectorIdx: index('ticket_search_vector_idx').using('gin', t.searchVector),
    titleTrgmIdx: index('ticket_title_trgm_idx').using('gin', t.title.op('gin_trgm_ops')),
    descriptionTrgmIdx: index('ticket_description_trgm_idx').using(
      'gin',
      t.description.op('gin_trgm_ops'),
    ),
    workspaceShortIdUnique: uniqueIndex('ticket_workspace_short_id_unique').on(
      t.workspaceId,
      t.shortId,
    ),
  }),
);

export const message = pgTable(
  'message',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    ticketId: uuid('ticket_id')
      .notNull()
      .references(() => ticket.id, { onDelete: 'cascade' }),
    authorType: messageAuthorType('author_type').notNull(),
    authorUserId: text('author_user_id').references(() => user.id, { onDelete: 'set null' }),
    authorCustomerId: uuid('author_customer_id').references(() => customer.id, {
      onDelete: 'set null',
    }),
    bodyHtml: text('body_html').notNull(),
    bodyText: text('body_text').notNull(),
    isInternal: boolean('is_internal').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    ticketCreatedIdx: index('message_ticket_created_idx').on(t.ticketId, t.createdAt),
  }),
);

export const attachment = pgTable(
  'attachment',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    messageId: uuid('message_id')
      .notNull()
      .references(() => message.id, { onDelete: 'cascade' }),
    s3Key: text('s3_key').notNull(),
    filename: text('filename').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    messageIdx: index('attachment_message_idx').on(t.messageId),
  }),
);

export const auditEvent = pgTable(
  'audit_event',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    ticketId: uuid('ticket_id').references(() => ticket.id, { onDelete: 'cascade' }),
    customerId: uuid('customer_id').references(() => customer.id, { onDelete: 'cascade' }),
    actorId: text('actor_id').references(() => user.id, { onDelete: 'set null' }),
    actorKind: text('actor_kind').notNull().default('user'),
    // Free-form text for forward-compat (don't promote to enum yet).
    kind: text('kind').notNull(),
    payload: jsonb('payload'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    ticketCreatedIdx: index('audit_event_ticket_created_idx').on(t.ticketId, t.createdAt),
    customerCreatedIdx: index('audit_event_customer_created_idx').on(t.customerId, t.createdAt),
  }),
);

export const customerNote = pgTable(
  'customer_note',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    objectType: customerNoteObjectType('object_type').notNull(),
    objectId: uuid('object_id').notNull(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customer.id, { onDelete: 'cascade' }),
    bodyHtml: text('body_html').notNull(),
    bodyText: text('body_text').notNull(),
    pinned: boolean('pinned').notNull().default(false),
    createdById: text('created_by_id')
      .notNull()
      .references(() => user.id),
    editedAt: timestamp('edited_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    customerIdx: index('customer_note_customer_idx').on(
      t.workspaceId,
      t.customerId,
      t.deletedAt,
      t.createdAt,
    ),
    objectIdx: index('customer_note_object_idx').on(t.workspaceId, t.objectType, t.objectId),
  }),
);

export const customEvent = pgTable(
  'custom_event',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customer.id, { onDelete: 'cascade' }),
    eventName: text('event_name').notNull(),
    properties: jsonb('properties')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    source: text('source').notNull().default('api'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    ingestedAt: timestamp('ingested_at', { withTimezone: true }).notNull().defaultNow(),
    idempotencyKey: text('idempotency_key'),
  },
  (t) => ({
    customerIdx: index('custom_event_customer_idx').on(t.workspaceId, t.customerId, t.occurredAt),
    workspaceIdx: index('custom_event_workspace_idx').on(t.workspaceId, t.occurredAt),
    nameIdx: index('custom_event_name_idx').on(t.workspaceId, t.eventName),
    idempotencyUnique: uniqueIndex('custom_event_idem_idx')
      .on(t.workspaceId, t.idempotencyKey)
      .where(sql`${t.idempotencyKey} IS NOT NULL`),
  }),
);

// ---------- Legacy outbox (Phase 2b) ----------
//
// Retained for migration continuity only. Phase 3a delivery dispatches Inngest
// events from server-mutator post-commit hooks; no runtime path polls this
// table or writes new delivery work here.
export const outbox = pgTable(
  'outbox',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    payload: jsonb('payload').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (t) => ({
    pendingIdx: index('outbox_pending_idx').on(t.processedAt),
    workspaceIdx: index('outbox_workspace_idx').on(t.workspaceId, t.createdAt),
  }),
);
