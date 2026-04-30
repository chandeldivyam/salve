// @opendesk/zero-schema — public surface.
//
// `schema.ts` defines the Zero schema (mirroring `packages/db/src/schema/
// domain.ts`). Phase 2b will add `mutators.ts` and `queries.ts` here.

export const ZERO_SCHEMA_NAME = 'opendesk' as const;
export const ZERO_SCHEMA_VERSION = 1 as const;

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
