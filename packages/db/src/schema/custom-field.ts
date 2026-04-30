// Custom field definitions and per-entity values.
//
// Values live in a related table rather than one JSONB blob on ticket/customer
// so Zero can sync individual field rows and join definitions live.

import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
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
import { customer, ticket } from './domain.js';

export const customFieldCategory = pgEnum('custom_field_category', ['ticket', 'customer']);

export const customFieldType = pgEnum('custom_field_type', [
  'text',
  'number',
  'decimal',
  'boolean',
  'date',
  'list',
  'multi_select',
  'agent',
  'customer',
  'ticket',
  'url',
  'address',
  'dynamic_list',
  'dynamic_multi_select',
]);

export type CustomFieldEditableBy = 'api' | 'admin' | 'agent' | 'sdk';

export const customField = pgTable(
  'custom_field',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    displayName: text('display_name').notNull(),
    description: text('description'),
    category: customFieldCategory('category').notNull(),
    type: customFieldType('type').notNull(),
    required: boolean('required').notNull().default(false),
    active: boolean('active').notNull().default(true),
    options: jsonb('options').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    dynamicConfig: jsonb('dynamic_config'),
    defaultValue: jsonb('default_value'),
    rules: jsonb('rules'),
    dependsOn: jsonb('depends_on').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    editableBy: jsonb('editable_by')
      .$type<CustomFieldEditableBy[]>()
      .notNull()
      .default(sql`'["agent","admin"]'::jsonb`),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    keyUnique: uniqueIndex('custom_field_key_unique').on(t.workspaceId, t.category, t.key),
    activeIdx: index('custom_field_active_idx').on(t.workspaceId, t.category, t.active),
  }),
);

export const customFieldValue = pgTable(
  'custom_field_value',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fieldId: uuid('field_id')
      .notNull()
      .references(() => customField.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    ticketId: uuid('ticket_id').references(() => ticket.id, { onDelete: 'cascade' }),
    customerId: uuid('customer_id').references(() => customer.id, { onDelete: 'cascade' }),
    value: jsonb('value'),
    updatedById: text('updated_by_id').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    ticketUnique: uniqueIndex('custom_field_value_ticket_unique').on(t.fieldId, t.ticketId),
    customerUnique: uniqueIndex('custom_field_value_customer_unique').on(t.fieldId, t.customerId),
    ticketIdx: index('custom_field_value_ticket_idx').on(t.ticketId),
    customerIdx: index('custom_field_value_customer_idx').on(t.customerId),
    workspaceIdx: index('custom_field_value_workspace_idx').on(t.workspaceId),
    oneTarget: check(
      'custom_field_value_one_target',
      sql`((ticket_id IS NOT NULL)::int + (customer_id IS NOT NULL)::int) = 1`,
    ),
  }),
);
