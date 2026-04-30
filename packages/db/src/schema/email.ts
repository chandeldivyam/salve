// Phase 3a: polymorphic delivery schema.
//
// `channel` is the cross-channel container. Email is the first implemented
// driver, with email-only configuration split into `email_channel` and
// address/domain tables. Later drivers add config and code, not schema churn.

import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { organization } from './auth.js';
import { customer, message, ticket, ticketPriority } from './domain.js';

// ---------- Enums ----------

export const channelKind = pgEnum('channel_kind', [
  'email',
  'chat',
  'whatsapp',
  'sms',
  'instagram',
  'facebook',
  'api_webhook',
]);

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

export const channel = pgTable(
  'channel',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    kind: channelKind('kind').notNull(),
    name: text('name').notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    config: jsonb('config').notNull().default(sql`'{}'::jsonb`),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    workspaceKindIdx: index('channel_workspace_kind_idx').on(t.workspaceId, t.kind),
    workspaceDefaultIdx: index('channel_workspace_default_idx').on(
      t.workspaceId,
      t.kind,
      t.isDefault,
    ),
  }),
);

// `sending_domain` is the tenant's verified outbound identity (e.g. acme.com).
// Provider-specific state stays in providerMeta so SES implementation details
// don't leak into the cross-channel contract.
export const sendingDomain = pgTable(
  'sending_domain',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    domain: text('domain').notNull(),
    sesIdentityArn: text('ses_identity_arn'),
    dkimTokens: jsonb('dkim_tokens'),
    mailFromSubdomain: text('mail_from_subdomain').notNull().default('mail'),
    dnsStatus: sendingDomainDnsStatus('dns_status').notNull().default('pending'),
    dmarcStatus: sendingDomainDmarcStatus('dmarc_status').notNull().default('pending'),
    lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }),
    suspendedAt: timestamp('suspended_at', { withTimezone: true }),
    suspendedReason: text('suspended_reason'),
    providerMeta: jsonb('provider_meta').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    workspaceDomainUnique: uniqueIndex('sending_domain_workspace_domain_unique').on(
      t.workspaceId,
      t.domain,
    ),
    workspaceIdx: index('sending_domain_workspace_idx').on(t.workspaceId),
  }),
);

export const emailChannel = pgTable(
  'email_channel',
  {
    channelId: uuid('channel_id')
      .primaryKey()
      .references(() => channel.id, { onDelete: 'cascade' }),
    sendingDomainId: uuid('sending_domain_id').references(() => sendingDomain.id, {
      onDelete: 'set null',
    }),
    fromName: text('from_name'),
    signature: text('signature'),
    defaultPriority: ticketPriority('default_priority').notNull().default('normal'),
    threadingPrefs: jsonb('threading_prefs').notNull().default(sql`'{}'::jsonb`),
    newTicketAfterClosedDays: integer('new_ticket_after_closed_days').notNull().default(14),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    sendingDomainIdx: index('email_channel_sending_domain_idx').on(t.sendingDomainId),
  }),
);

export const emailAddress = pgTable(
  'email_address',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    channelId: uuid('channel_id')
      .notNull()
      .references(() => channel.id, { onDelete: 'cascade' }),
    sendingDomainId: uuid('sending_domain_id')
      .notNull()
      .references(() => sendingDomain.id, {
        onDelete: 'cascade',
      }),
    localPart: text('local_part').notNull(),
    fullAddress: text('full_address').notNull(),
    canSend: boolean('can_send').notNull().default(true),
    canReceive: boolean('can_receive').notNull().default(true),
    isDefault: boolean('is_default').notNull().default(false),
    defaultTeamId: text('default_team_id'),
    label: text('label'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    workspaceIdx: index('email_address_workspace_idx').on(t.workspaceId),
    channelIdx: index('email_address_channel_idx').on(t.channelId),
    channelLocalPartUnique: uniqueIndex('email_address_channel_local_part_unique').on(
      t.channelId,
      t.localPart,
    ),
    fullAddressUnique: uniqueIndex('email_address_full_address_unique').on(t.fullAddress),
  }),
);

export const outboundMessage = pgTable(
  'outbound_message',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    channelId: uuid('channel_id')
      .notNull()
      .references(() => channel.id, { onDelete: 'cascade' }),
    emailAddressId: uuid('email_address_id').references(() => emailAddress.id, {
      onDelete: 'set null',
    }),
    ticketId: uuid('ticket_id')
      .notNull()
      .references(() => ticket.id, { onDelete: 'cascade' }),
    messageId: uuid('message_id')
      .notNull()
      .references(() => message.id, { onDelete: 'cascade' }),
    providerMessageId: text('provider_message_id'),
    status: outboundMessageStatus('status').notNull().default('queued'),
    error: text('error'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    providerMeta: jsonb('provider_meta').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    messageUnique: uniqueIndex('outbound_message_message_unique').on(t.messageId),
    providerUnique: uniqueIndex('outbound_message_channel_provider_unique').on(
      t.channelId,
      t.providerMessageId,
    ),
    ticketIdx: index('outbound_message_ticket_idx').on(t.workspaceId, t.ticketId, t.createdAt),
    statusIdx: index('outbound_message_status_idx').on(t.workspaceId, t.status, t.createdAt),
  }),
);

export const suppression = pgTable(
  'suppression',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    channelId: uuid('channel_id').references(() => channel.id, { onDelete: 'cascade' }),
    target: text('target').notNull(),
    reason: suppressionReason('reason').notNull(),
    providerMeta: jsonb('provider_meta').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    workspaceTargetUnique: unique('suppression_workspace_channel_target_unique')
      .on(t.workspaceId, t.channelId, t.target)
      .nullsNotDistinct(),
    workspaceIdx: index('suppression_workspace_idx').on(t.workspaceId),
    targetIdx: index('suppression_target_idx').on(t.target),
  }),
);

export const webhookEvent = pgTable(
  'webhook_event',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: text('workspace_id').references(() => organization.id, { onDelete: 'cascade' }),
    channelId: uuid('channel_id').references(() => channel.id, { onDelete: 'cascade' }),
    source: text('source').notNull(),
    eventType: text('event_type').notNull(),
    providerMessageId: text('provider_message_id'),
    payload: jsonb('payload').notNull().default(sql`'{}'::jsonb`),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    sourceProviderIdx: index('webhook_event_source_provider_idx').on(t.source, t.providerMessageId),
    workspaceIdx: index('webhook_event_workspace_idx').on(t.workspaceId, t.createdAt),
    unprocessedIdx: index('webhook_event_unprocessed_idx').on(t.processedAt),
  }),
);

export const customerChannelIdentity = pgTable(
  'customer_channel_identity',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    channelId: uuid('channel_id')
      .notNull()
      .references(() => channel.id, { onDelete: 'cascade' }),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customer.id, { onDelete: 'cascade' }),
    externalIdentifier: text('external_identifier').notNull(),
    providerMeta: jsonb('provider_meta').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    channelExternalUnique: uniqueIndex('customer_channel_identity_channel_external_unique').on(
      t.channelId,
      t.externalIdentifier,
    ),
    workspaceCustomerIdx: index('customer_channel_identity_workspace_customer_idx').on(
      t.workspaceId,
      t.customerId,
    ),
  }),
);
