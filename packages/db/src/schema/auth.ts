// better-auth tables (core + organization plugin), expressed as Drizzle pg tables.
// Field shapes mirror @better-auth/core/db `getAuthTables` and the organization plugin schema
// (verified against better-auth@1.6.9 dist).
//
// Notes:
// - All IDs are TEXT (better-auth uses string IDs by default, generated server-side).
// - createdAt/updatedAt are timestamps with default `now()`. better-auth re-stamps updatedAt.
// - The `account` table holds OAuth provider linkages AND the bcrypt password column for
//   email/password auth.

import { boolean, index, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core';

export const user = pgTable(
  'user',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    emailVerified: boolean('emailVerified').notNull().default(false),
    image: text('image'),
    createdAt: timestamp('createdAt', { withTimezone: false }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { withTimezone: false }).notNull().defaultNow(),
  },
  (t) => ({
    emailUnique: unique('user_email_unique').on(t.email),
  }),
);

export const session = pgTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: timestamp('expiresAt', { withTimezone: false }).notNull(),
    token: text('token').notNull(),
    createdAt: timestamp('createdAt', { withTimezone: false }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { withTimezone: false }).notNull().defaultNow(),
    ipAddress: text('ipAddress'),
    userAgent: text('userAgent'),
    userId: text('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    // organization plugin extension: which org is currently active for the session
    activeOrganizationId: text('activeOrganizationId'),
  },
  (t) => ({
    tokenUnique: unique('session_token_unique').on(t.token),
    userIdIdx: index('session_userId_idx').on(t.userId),
  }),
);

export const account = pgTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('accountId').notNull(),
    providerId: text('providerId').notNull(),
    userId: text('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('accessToken'),
    refreshToken: text('refreshToken'),
    idToken: text('idToken'),
    accessTokenExpiresAt: timestamp('accessTokenExpiresAt', { withTimezone: false }),
    refreshTokenExpiresAt: timestamp('refreshTokenExpiresAt', { withTimezone: false }),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('createdAt', { withTimezone: false }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { withTimezone: false }).notNull().defaultNow(),
  },
  (t) => ({
    userIdIdx: index('account_userId_idx').on(t.userId),
  }),
);

export const verification = pgTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expiresAt', { withTimezone: false }).notNull(),
    createdAt: timestamp('createdAt', { withTimezone: false }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { withTimezone: false }).notNull().defaultNow(),
  },
  (t) => ({
    identifierIdx: index('verification_identifier_idx').on(t.identifier),
  }),
);

// Organization plugin tables.
export const organization = pgTable(
  'organization',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    logo: text('logo'),
    metadata: text('metadata'),
    createdAt: timestamp('createdAt', { withTimezone: false }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { withTimezone: false }),
  },
  (t) => ({
    slugUnique: unique('organization_slug_unique').on(t.slug),
  }),
);

export const member = pgTable('member', {
  id: text('id').primaryKey(),
  organizationId: text('organizationId')
    .notNull()
    .references(() => organization.id, { onDelete: 'cascade' }),
  userId: text('userId')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  role: text('role').notNull().default('member'),
  createdAt: timestamp('createdAt', { withTimezone: false }).notNull().defaultNow(),
});

export const invitation = pgTable('invitation', {
  id: text('id').primaryKey(),
  organizationId: text('organizationId')
    .notNull()
    .references(() => organization.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  role: text('role').notNull(),
  status: text('status').notNull().default('pending'),
  expiresAt: timestamp('expiresAt', { withTimezone: false }),
  createdAt: timestamp('createdAt', { withTimezone: false }).notNull().defaultNow(),
  inviterId: text('inviterId')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
});
