// Custom inbox views (Phase 40).
//
// A `view` is a saved filter / sort / group config for the inbox surface.
// `view_member` is the per-agent membership row that records personal
// ordering and per-agent "hide for me" state — Atlas's saved-search pattern,
// trimmed to workspace-or-personal scope (no explicit user-list sharing).
//
// Built-in views (All / Unassigned / Mine / Resolved) are layered client-side
// and are not persisted as `view` rows. Their per-agent ordering /
// hidden-state lives in `builtin_view_member`, keyed by an opaque string.

import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { organization, user } from './auth.js';

export const viewKind = pgEnum('view_kind', ['inbox']);
export const viewScope = pgEnum('view_scope', ['workspace', 'personal']);

export const view = pgTable(
  'view',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    kind: viewKind('kind').notNull().default('inbox'),
    scope: viewScope('scope').notNull().default('workspace'),
    ownerId: text('owner_id').references(() => user.id, { onDelete: 'set null' }),
    label: text('label').notNull(),
    description: text('description'),
    icon: text('icon'),
    color: text('color'),
    // ViewQuery / ViewSort / DisplayProps in @opendesk/zero-schema/views.
    query: jsonb('query').notNull(),
    sort: jsonb('sort').notNull(),
    groupBy: text('group_by'),
    displayProps: jsonb('display_props'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    workspaceIdx: index('view_workspace_idx').on(t.workspaceId, t.archivedAt),
    ownerIdx: index('view_owner_idx').on(t.ownerId, t.scope),
  }),
);

export const viewMember = pgTable(
  'view_member',
  {
    viewId: uuid('view_id')
      .notNull()
      .references(() => view.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    position: integer('position').notNull().default(0),
    hiddenAt: timestamp('hidden_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.viewId, t.userId] }),
    userIdx: index('view_member_user_idx').on(t.userId, t.workspaceId),
  }),
);

// Built-in view membership: keys an agent's per-agent state for the
// hardcoded built-in views (e.g. 'builtin:all', 'builtin:unassigned'). Kept
// in a separate table so `view_member.view_id` can stay a clean FK to
// `view.id`.
export const builtinViewMember = pgTable(
  'builtin_view_member',
  {
    builtinKey: text('builtin_key').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    position: integer('position').notNull().default(0),
    hiddenAt: timestamp('hidden_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.builtinKey, t.userId, t.workspaceId] }),
    userIdx: index('builtin_view_member_user_idx').on(t.userId, t.workspaceId),
  }),
);
