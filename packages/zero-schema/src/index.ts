// @opendesk/zero-schema — public surface.
//
// `schema.ts` defines the Zero schema (mirroring `packages/db/src/schema/
// domain.ts`). `queries.ts` adds workspace-scoped `defineQueries` helpers
// that every read in the app must funnel through.

export const ZERO_SCHEMA_NAME = 'opendesk' as const;
// Tags, tag joins, custom field definitions, custom field values, and
// customer-scoped audit events.
// Phase 40: view, view_member, builtin_view_member tables and relationships.
// Phase A: apikey table (with principal_kind/principal_id), member.createdAt.
export const ZERO_SCHEMA_VERSION = 8 as const;

export {
  ALL_TICKET_MESSAGE_LIMIT,
  CUSTOMER_EVENT_LIMIT,
  CUSTOMER_NOTE_LIMIT,
  CUSTOMER_TICKET_LIMIT,
  DEFAULT_CUSTOMER_EVENT_LIMIT,
  DEFAULT_CUSTOMER_LIST_LIMIT,
  DEFAULT_RELATED_TICKET_LIMIT,
  INBOX_INITIAL_PAGE,
  INBOX_PAGE_GROWTH,
  INITIAL_TICKET_MESSAGE_LIMIT,
  MAX_INBOX_LIMIT,
  MAX_LIST_LIMIT,
  MAX_LIST_LIMIT_QUERY,
  PAGE,
  TICKET_ANCHOR_LIMIT,
} from './consts.js';

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
  type ApiTokenRow,
  applyTicketRead,
  applyWorkspaceScope,
  type CustomFieldDefinitionRow,
  type CustomFieldSettingsRow,
  type InboundMessageRow,
  type InboundRoutingRuleRow,
  type InboxRow,
  type MyTicketRow,
  type OutboundMessageRow,
  type Queries,
  queries,
  type ReceivableEmailAddressRow,
  type SendableEmailAddressRow,
  type SendingDomainDetailRow,
  type SendingDomainRow,
  type ServiceAccountRow,
  type ServiceAccountTokenRow,
  type SuppressionRow,
  type TagGroupRow,
  type TagRow,
  type TicketCountRow,
  type TicketDetailRow,
  type ViewTicketRow,
  type WorkspaceMemberRow,
} from './queries.js';
export {
  type Attachment,
  type AuditEvent,
  type AuthData,
  type BuiltinViewMember,
  builder,
  type Channel,
  type Customer,
  type CustomerChannelIdentity,
  type CustomerTag,
  type CustomField,
  type CustomFieldCategory,
  type CustomFieldEditableBy,
  type CustomFieldType,
  type CustomFieldValue,
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
  type Tag,
  type TagGroup,
  type Ticket,
  type TicketTag,
  type User,
  type View,
  type ViewMember,
  type WebhookEvent,
} from './schema.js';
export {
  applyFilterToQuery,
  DEFAULT_DISPLAY_PROPS,
  DEFAULT_VIEW_SORT,
  type DisplayPropKey,
  type DisplayProps,
  displayPropsZ,
  FILTER_FIELDS,
  type Filter,
  type FilterField,
  type FilterOperator,
  filterZ,
  type GroupByAxis,
  groupByZ,
  ME_TOKEN,
  relativeCutoff,
  resolveMeTokens,
  type StaticFilterField,
  type TicketPriority,
  type TicketStatus,
  ticketPriorities,
  ticketStatuses,
  type ViewQuery,
  type ViewSort,
  viewQueryZ,
  viewSortToOrderBy,
  viewSortZ,
} from './views.js';
