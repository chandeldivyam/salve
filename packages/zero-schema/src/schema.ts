// @opendesk/zero-schema — Zero schema mirroring the Drizzle source-of-truth in
// `packages/db/src/schema/domain.ts` (and the auth tables we want exposed).
//
// Pattern: zbugs's `shared/schema.ts` (modern 1.x DSL — table()/string()/
// number()/enumeration<T>()/relationships()/createSchema()).
//
// **Timestamps**: kept as `timestamptz` in Postgres (source of truth). Zero's
// upstream PG → ZQL type map converts both `timestamp` and `timestamptz` to
// `number` (floating-point epoch milliseconds). So we declare these columns
// as `number()` here and rely on Zero's own conversion — no mirror columns,
// no triggers, no manual ISO strings. (See
// `packages/zero-cache/src/types/pg-data-type.ts` in the rocicorp/mono repo.)

import {
  ANYONE_CAN_DO_ANYTHING,
  boolean,
  createBuilder,
  createSchema,
  definePermissions,
  enumeration,
  json,
  number,
  type Row,
  relationships,
  string,
  table,
} from '@rocicorp/zero';

// ---------- Auth tables (read-only mirror — agents need them to display
// assignee names + member dropdowns once the inbox UI lands in Phase 2c).
// We expose only the columns we'll read in the agent UI; sensitive ones
// (password hashes, tokens, IPs) are deliberately omitted.

const user = table('user')
  .columns({
    id: string(),
    name: string(),
    email: string(),
    image: string().optional(),
  })
  .primaryKey('id');

const organization = table('organization')
  .columns({
    id: string(),
    name: string(),
    slug: string(),
  })
  .primaryKey('id');

// `member` is the better-auth org-plugin junction. Note Drizzle calls the
// columns userId/organizationId (camelCase, mapped 1:1 in PG), so Zero sees
// the same names.
const member = table('member')
  .columns({
    id: string(),
    userId: string(),
    organizationId: string(),
    role: string(),
  })
  .primaryKey('id');

// ---------- Domain tables (Phase 2a)

const customer = table('customer')
  .columns({
    id: string(),
    workspaceID: string().from('workspace_id'),
    email: string(),
    name: string().optional(),
    avatarUrl: string().from('avatar_url').optional(),
    createdAt: number().from('created_at'),
    updatedAt: number().from('updated_at'),
  })
  .primaryKey('id');

const ticket = table('ticket')
  .columns({
    id: string(),
    workspaceID: string().from('workspace_id'),
    shortID: number().from('short_id'),
    title: string(),
    description: string().optional(),
    status: enumeration<'open' | 'in_progress' | 'snoozed' | 'resolved' | 'closed'>(),
    priority: enumeration<'low' | 'normal' | 'high' | 'urgent'>(),
    customerID: string().from('customer_id').optional(),
    assigneeID: string().from('assignee_id').optional(),
    createdByID: string().from('created_by_id').optional(),
    createdAt: number().from('created_at'),
    updatedAt: number().from('updated_at'),
    firstResponseAt: number().from('first_response_at').optional(),
    resolvedAt: number().from('resolved_at').optional(),
  })
  .primaryKey('id');

const message = table('message')
  .columns({
    id: string(),
    workspaceID: string().from('workspace_id'),
    ticketID: string().from('ticket_id'),
    authorType: enumeration<'customer' | 'agent' | 'system'>().from('author_type'),
    authorUserID: string().from('author_user_id').optional(),
    authorCustomerID: string().from('author_customer_id').optional(),
    bodyHtml: string().from('body_html'),
    bodyText: string().from('body_text'),
    isInternal: boolean().from('is_internal'),
    createdAt: number().from('created_at'),
  })
  .primaryKey('id');

const attachment = table('attachment')
  .columns({
    id: string(),
    workspaceID: string().from('workspace_id'),
    messageID: string().from('message_id'),
    s3Key: string().from('s3_key'),
    filename: string(),
    mimeType: string().from('mime_type'),
    sizeBytes: number().from('size_bytes'),
    createdAt: number().from('created_at'),
  })
  .primaryKey('id');

const auditEvent = table('auditEvent')
  .from('audit_event')
  .columns({
    id: string(),
    workspaceID: string().from('workspace_id'),
    ticketID: string().from('ticket_id'),
    actorID: string().from('actor_id').optional(),
    kind: string(),
    // Audit payloads are arbitrary JSON; cast to ReadonlyJSONValue for Zero's
    // typing. Mutators in Phase 2b stamp known shapes; consumers narrow.
    payload: json().optional(),
    createdAt: number().from('created_at'),
  })
  .primaryKey('id');

// ---------- Relationships

const userRelationships = relationships(user, ({ many }) => ({
  assignedTickets: many({
    sourceField: ['id'],
    destField: ['assigneeID'],
    destSchema: ticket,
  }),
  createdTickets: many({
    sourceField: ['id'],
    destField: ['createdByID'],
    destSchema: ticket,
  }),
  memberships: many({
    sourceField: ['id'],
    destField: ['userId'],
    destSchema: member,
  }),
}));

const organizationRelationships = relationships(organization, ({ many }) => ({
  members: many({
    sourceField: ['id'],
    destField: ['organizationId'],
    destSchema: member,
  }),
  tickets: many({
    sourceField: ['id'],
    destField: ['workspaceID'],
    destSchema: ticket,
  }),
  customers: many({
    sourceField: ['id'],
    destField: ['workspaceID'],
    destSchema: customer,
  }),
}));

const memberRelationships = relationships(member, ({ one }) => ({
  user: one({
    sourceField: ['userId'],
    destField: ['id'],
    destSchema: user,
  }),
  organization: one({
    sourceField: ['organizationId'],
    destField: ['id'],
    destSchema: organization,
  }),
}));

const customerRelationships = relationships(customer, ({ many }) => ({
  tickets: many({
    sourceField: ['id'],
    destField: ['customerID'],
    destSchema: ticket,
  }),
}));

const ticketRelationships = relationships(ticket, ({ one, many }) => ({
  workspace: one({
    sourceField: ['workspaceID'],
    destField: ['id'],
    destSchema: organization,
  }),
  customer: one({
    sourceField: ['customerID'],
    destField: ['id'],
    destSchema: customer,
  }),
  assignee: one({
    sourceField: ['assigneeID'],
    destField: ['id'],
    destSchema: user,
  }),
  createdBy: one({
    sourceField: ['createdByID'],
    destField: ['id'],
    destSchema: user,
  }),
  messages: many({
    sourceField: ['id'],
    destField: ['ticketID'],
    destSchema: message,
  }),
  auditEvents: many({
    sourceField: ['id'],
    destField: ['ticketID'],
    destSchema: auditEvent,
  }),
}));

const messageRelationships = relationships(message, ({ one, many }) => ({
  ticket: one({
    sourceField: ['ticketID'],
    destField: ['id'],
    destSchema: ticket,
  }),
  authorUser: one({
    sourceField: ['authorUserID'],
    destField: ['id'],
    destSchema: user,
  }),
  authorCustomer: one({
    sourceField: ['authorCustomerID'],
    destField: ['id'],
    destSchema: customer,
  }),
  attachments: many({
    sourceField: ['id'],
    destField: ['messageID'],
    destSchema: attachment,
  }),
}));

const attachmentRelationships = relationships(attachment, ({ one }) => ({
  message: one({
    sourceField: ['messageID'],
    destField: ['id'],
    destSchema: message,
  }),
}));

const auditEventRelationships = relationships(auditEvent, ({ one }) => ({
  ticket: one({
    sourceField: ['ticketID'],
    destField: ['id'],
    destSchema: ticket,
  }),
  actor: one({
    sourceField: ['actorID'],
    destField: ['id'],
    destSchema: user,
  }),
}));

// ---------- Schema

export const schema = createSchema({
  tables: [user, organization, member, customer, ticket, message, attachment, auditEvent],
  relationships: [
    userRelationships,
    organizationRelationships,
    memberRelationships,
    customerRelationships,
    ticketRelationships,
    messageRelationships,
    attachmentRelationships,
    auditEventRelationships,
  ],
  // Phase 2a: keep legacy CRUD/queries enabled so the verification step can
  // do `useQuery(z.query.ticket.where('workspaceID','=',id))` directly. Phase
  // 2b flips both to `false` once we register custom queries (`defineQueries`)
  // and custom mutators (`defineMutators`) — at that point all reads/writes
  // flow through workspace-scoped helpers and these legacy paths are dead.
  enableLegacyMutators: true,
  enableLegacyQueries: true,
});

// Phase 2a permissions — temporary `ANYONE_CAN_DO_ANYTHING` for every table
// so zero-cache will actually replicate rows out to clients. The plan's
// permission model is **assertion-based inside mutators/queries**, not the
// declarative `definePermissions` DSL. We keep this thin permissive layer
// here only because zero-cache 1.3.0 refuses to sync data at all when no
// permissions are deployed. Phase 2b adds proper auth checks (workspace
// scoping, role checks) inside custom mutators / queries; this object stays
// permissive (or gets removed entirely if a future Zero release drops the
// requirement). DO NOT add granular row policies here — security lives in
// the TS code, not in this file.
export const permissions = await definePermissions<unknown, Schema>(schema, () => ({
  user: ANYONE_CAN_DO_ANYTHING,
  organization: ANYONE_CAN_DO_ANYTHING,
  member: ANYONE_CAN_DO_ANYTHING,
  customer: ANYONE_CAN_DO_ANYTHING,
  ticket: ANYONE_CAN_DO_ANYTHING,
  message: ANYONE_CAN_DO_ANYTHING,
  attachment: ANYONE_CAN_DO_ANYTHING,
  auditEvent: ANYONE_CAN_DO_ANYTHING,
}));

export const builder = createBuilder(schema);

export type Schema = typeof schema;
export type User = Row<typeof schema.tables.user>;
export type Organization = Row<typeof schema.tables.organization>;
export type Member = Row<typeof schema.tables.member>;
export type Customer = Row<typeof schema.tables.customer>;
export type Ticket = Row<typeof schema.tables.ticket>;
export type Message = Row<typeof schema.tables.message>;
export type Attachment = Row<typeof schema.tables.attachment>;
export type AuditEvent = Row<typeof schema.tables.auditEvent>;

// AuthData is the JWT shape minted by apps/api (`apps/api/src/jwt.ts`). Mutators
// in Phase 2b will read it via `ctx`.
export type AuthData = {
  sub: string;
  workspaceID: string | null;
  role: 'owner' | 'admin' | 'agent' | null;
};

declare module '@rocicorp/zero' {
  interface DefaultTypes {
    schema: Schema;
    context: AuthData;
  }
}
