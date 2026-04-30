// @opendesk/zero-schema — public surface.
//
// `schema.ts` defines the Zero schema (mirroring `packages/db/src/schema/
// domain.ts`). `queries.ts` adds workspace-scoped `defineQueries` helpers
// that every read in the app must funnel through.

export const ZERO_SCHEMA_NAME = 'opendesk' as const;
// Phase 3a replacement contract: polymorphic `channel` foundation plus
// email-specific address/domain subtables and delivery event names.
export const ZERO_SCHEMA_VERSION = 5 as const;

/**
 * Channel-agnostic event names. Server-side wrappers and Inngest functions use
 * these strings directly; none of them encode an email-specific queue kind.
 */
export const DELIVERY_EVENT = {
  MESSAGE_REQUESTED: 'delivery/message.requested',
  MESSAGE_SENT: 'delivery/message.sent',
  MESSAGE_DELIVERED: 'delivery/message.delivered',
  MESSAGE_BOUNCED: 'delivery/message.bounced',
  MESSAGE_COMPLAINED: 'delivery/message.complained',
  MESSAGE_FAILED: 'delivery/message.failed',
} as const;
export type DeliveryEventName = (typeof DELIVERY_EVENT)[keyof typeof DELIVERY_EVENT];

export const INBOUND_EVENT = {
  MESSAGE_RECEIVED: 'inbound/message.received',
} as const;
export type InboundEventName = (typeof INBOUND_EVENT)[keyof typeof INBOUND_EVENT];

export const DOMAIN_VERIFICATION_EVENT = {
  REQUESTED: 'domain/verification.requested',
  COMPLETED: 'domain/verification.completed',
} as const;
export type DomainVerificationEventName =
  (typeof DOMAIN_VERIFICATION_EVENT)[keyof typeof DOMAIN_VERIFICATION_EVENT];

export const PROVIDER_EVENT = {
  WEBHOOK_RECEIVED: 'provider/webhook.received',
} as const;
export type ProviderEventName = (typeof PROVIDER_EVENT)[keyof typeof PROVIDER_EVENT];

export {
  applyTicketRead,
  applyWorkspaceScope,
  type Queries,
  queries,
} from './queries.js';
export {
  type Attachment,
  type AuditEvent,
  type AuthData,
  builder,
  type Channel,
  type Customer,
  type CustomerChannelIdentity,
  type EmailAddress,
  type EmailChannel,
  type InboundMessageRaw,
  type InboundRoutingRule,
  type Member,
  type Message,
  type Organization,
  type OutboundMessage,
  type Schema,
  type SendingDomain,
  type Suppression,
  schema,
  type Ticket,
  type User,
  type WebhookEvent,
} from './schema.js';
