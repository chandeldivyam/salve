// Tags and tag groups.
//
// Tags attach to tickets and customers via join tables rather than Postgres
// arrays so Zero can stream relationship rows live into the UI.

import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { organization, user } from './auth.js';
import { customer, ticket } from './domain.js';

export const tagGroup = pgTable(
  'tag_group',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    color: text('color').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    workspaceIdx: index('tag_group_workspace_idx').on(t.workspaceId, t.archivedAt),
  }),
);

export const tag = pgTable(
  'tag',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    groupId: uuid('group_id').references(() => tagGroup.id, { onDelete: 'set null' }),
    label: text('label').notNull(),
    color: text('color'),
    sortOrder: integer('sort_order').notNull().default(0),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    workspaceLabelUnique: uniqueIndex('tag_workspace_label_unique').on(
      t.workspaceId,
      sql`lower(${t.label})`,
    ),
    groupIdx: index('tag_group_idx').on(t.groupId),
    workspaceIdx: index('tag_workspace_idx').on(t.workspaceId, t.archivedAt),
  }),
);

export const ticketTag = pgTable(
  'ticket_tag',
  {
    ticketId: uuid('ticket_id')
      .notNull()
      .references(() => ticket.id, { onDelete: 'cascade' }),
    tagId: uuid('tag_id')
      .notNull()
      .references(() => tag.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
    addedById: text('added_by_id').references(() => user.id, { onDelete: 'set null' }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.ticketId, t.tagId] }),
    tagIdx: index('ticket_tag_tag_idx').on(t.tagId),
    workspaceIdx: index('ticket_tag_workspace_idx').on(t.workspaceId),
  }),
);

export const customerTag = pgTable(
  'customer_tag',
  {
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customer.id, { onDelete: 'cascade' }),
    tagId: uuid('tag_id')
      .notNull()
      .references(() => tag.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
    addedById: text('added_by_id').references(() => user.id, { onDelete: 'set null' }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.customerId, t.tagId] }),
    tagIdx: index('customer_tag_tag_idx').on(t.tagId),
    workspaceIdx: index('customer_tag_workspace_idx').on(t.workspaceId),
  }),
);
