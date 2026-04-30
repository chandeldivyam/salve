// Phase 3a: email subsystem schema.
//
// All tables are workspace-scoped. Backed by SES in prod / Mailpit in dev (raw
// SMTP via nodemailer). Inbound is Phase 3b — `email_channel.inbound_localpart`
// is reserved here as a write-target only.
//
// References:
//   - Plan: "Email subsystem — multi-tenant BYO customer domain"
//   - Research: tmp/research/atlas-email-deep-dive.md (§§3, 5, 6, 7, 8, 11)

import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { organization } from './auth.js';
import { message, ticket } from './domain.js';

// ---------- Enums ----------

export const sendingDomainDnsStatus = pgEnum('sending_domain_dns_status', [
  'pending',
  'verified',
  'failed',
  'suspended',
]);

export const sendingDomainDmarcStatus = pgEnum('sending_domain_dmarc_status', [
  'pending',
  'present',
  'missing',
  'failing',
]);

export const outboundMessageStatus = pgEnum('outbound_message_status', [
  'queued',
  'sending',
  'sent',
  'delivered',
  'bounced',
  'complained',
  'suppressed',
  'failed',
]);

export const suppressionReason = pgEnum('suppression_reason', [
  'hard_bounce',
  'complaint',
  'manual',
  'unsubscribe',
]);

// ---------- Tables ----------

// `sending_domain` is the tenant's verified outbound identity (e.g. acme.com).
// Phase 3a stubs DKIM tokens locally; Phase 3c calls SES CreateEmailIdentity.
export const sendingDomain = pgTable(
  'sending_domain',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    domain: text('domain').notNull(),
    sesIdentityArn: text('ses_identity_arn'),
    // Array of { name, value } CNAMEs as SES returns them.
    dkimTokens: jsonb('dkim_tokens'),
    mailFromSubdomain: text('mail_from_subdomain').notNull().default('mail'),
    dnsStatus: sendingDomainDnsStatus('dns_status').notNull().default('pending'),
    dmarcStatus: sendingDomainDmarcStatus('dmarc_status').notNull().default('pending'),
    lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }),
    suspendedAt: timestamp('suspended_at', { withTimezone: true }),
    suspendedReason: text('suspended_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    workspaceDomainUnique: uniqueIndex('sending_domain_workspace_domain_unique').on(
      t.workspaceId,
      t.domain,
    ),
  }),
);

// `email_channel` is the per-workspace email destination. Inbound localpart
// stays NULL until Phase 3b wires the SES inbound rule.
export const emailChannel = pgTable(
  'email_channel',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    inboundLocalpart: text('inbound_localpart'),
    sendingDomainId: uuid('sending_domain_id').references(() => sendingDomain.id, {
      onDelete: 'set null',
    }),
    isDefault: text('is_default').notNull().default('false'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    inboundLocalpartUnique: uniqueIndex('email_channel_inbound_localpart_unique').on(
      t.inboundLocalpart,
    ),
    workspaceIdx: index('email_channel_workspace_idx').on(t.workspaceId),
  }),
);

// `outbound_message` is the audit row for every send. The RFC Message-ID is
// the join key for inbound thread matching (Phase 3b).
export const outboundMessage = pgTable(
  'outbound_message',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    ticketId: uuid('ticket_id')
      .notNull()
      .references(() => ticket.id, { onDelete: 'cascade' }),
    messageId: uuid('message_id')
      .notNull()
      .references(() => message.id, { onDelete: 'cascade' }),
    rfcMessageId: text('rfc_message_id').notNull(),
    sesMessageId: text('ses_message_id'),
    fromAddress: text('from_address').notNull(),
    toAddress: text('to_address').notNull(),
    replyTo: text('reply_to').notNull(),
    subject: text('subject').notNull(),
    status: outboundMessageStatus('status').notNull().default('queued'),
    error: text('error'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    rfcMessageIdIdx: index('outbound_message_rfc_message_id_idx').on(t.rfcMessageId),
    ticketIdx: index('outbound_message_ticket_idx').on(t.workspaceId, t.ticketId, t.createdAt),
  }),
);

// Per-workspace block list. Auto-fills on hard bounce + complaint (Phase 3c
// when SES events land); manual entries seed via UI in 3a+.
export const suppression = pgTable(
  'suppression',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    emailAddress: text('email_address').notNull(),
    reason: suppressionReason('reason').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    workspaceEmailUnique: uniqueIndex('suppression_workspace_email_unique').on(
      t.workspaceId,
      t.emailAddress,
    ),
  }),
);
