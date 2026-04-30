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

import {
  boolean,
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
    avatarUrl: text('avatar_url'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    workspaceEmailIdx: index('customer_workspace_email_idx').on(t.workspaceId, t.email),
    workspaceEmailUnique: uniqueIndex('customer_workspace_email_unique').on(t.workspaceId, t.email),
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
  },
  (t) => ({
    inboxIdx: index('ticket_inbox_idx').on(t.workspaceId, t.status, t.updatedAt),
    assigneeIdx: index('ticket_assignee_idx').on(t.workspaceId, t.assigneeId, t.status),
    createdAtIdx: index('ticket_created_at_idx').on(t.workspaceId, t.createdAt),
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
    ticketId: uuid('ticket_id')
      .notNull()
      .references(() => ticket.id, { onDelete: 'cascade' }),
    actorId: text('actor_id').references(() => user.id, { onDelete: 'set null' }),
    // Free-form text for forward-compat (don't promote to enum yet).
    kind: text('kind').notNull(),
    payload: jsonb('payload'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    ticketCreatedIdx: index('audit_event_ticket_created_idx').on(t.ticketId, t.createdAt),
  }),
);

// ---------- Outbox (Phase 2b) ----------
//
// Pure server-side queue for "things that must leave the database after a write
// commits": email dispatch, Inngest events, etc. Mutators (the server-side
// half) write rows to this table inside the same transaction as the domain
// write, so we get at-least-once delivery without two-phase commit.
//
// Phase 3 wires a Postgres LISTEN/NOTIFY subscriber that turns these rows into
// Inngest events; Phase 2b only INSERTs and the worker is a TODO. Not mirrored
// in the Zero schema — clients have no business reading this.
//
// The partial index `(processed_at) WHERE processed_at IS NULL` is the worker's
// queue: a `SELECT ... FOR UPDATE SKIP LOCKED` against unprocessed rows. We
// declare it as a normal index here and append the `WHERE` clause via raw SQL
// in the migration (drizzle-kit doesn't expose partial indexes natively in
// 0.31).
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
