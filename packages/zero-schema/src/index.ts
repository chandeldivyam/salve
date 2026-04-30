// @opendesk/zero-schema — public surface.
//
// `schema.ts` defines the Zero schema (mirroring `packages/db/src/schema/
// domain.ts`). `queries.ts` adds workspace-scoped `defineQueries` helpers
// that every read in the app must funnel through.

export const ZERO_SCHEMA_NAME = 'opendesk' as const;
export const ZERO_SCHEMA_VERSION = 2 as const;

/**
 * Outbox row kinds. Server-only — clients never read these. Lives here only
 * because both `apps/api/src/server-mutators.ts` and the future Inngest
 * dispatcher (Phase 3) need to agree on the string. Match Inngest event names
 * verbatim so a downstream worker can use them as event ids without mapping.
 */
export const ZERO_OUTBOX_KIND = {
  EMAIL_SEND: 'email.send',
  TICKET_CREATED: 'ticket.created',
  MESSAGE_SENT: 'message.sent',
} as const;
export type ZeroOutboxKind = (typeof ZERO_OUTBOX_KIND)[keyof typeof ZERO_OUTBOX_KIND];

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
  type Customer,
  type Member,
  type Message,
  type Organization,
  type Schema,
  schema,
  type Ticket,
  type User,
} from './schema.js';
