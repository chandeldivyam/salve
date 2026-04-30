// @opendesk/zero-schema/queries — workspace-scoped query helpers.
//
// Pattern from `/tmp/zero-mono/apps/zbugs/shared/queries.ts:69-306`. Every
// query goes through `applyWorkspaceScope` so a missing `.where('workspaceID',
// ...)` is structurally impossible — that is the *single* mitigation
// referenced in the plan's "No declarative permissions" risk.

import { type DefaultSchema, defineQueries, defineQuery, type Query } from '@rocicorp/zero';
import { z } from 'zod';
import type { AuthData } from './schema.js';
import { builder } from './schema.js';

type WorkspaceScopedTable =
  | 'ticket'
  | 'sendingDomain'
  | 'emailAddress'
  | 'suppression'
  | 'outboundMessage'
  | 'inboundMessageRaw'
  | 'inboundRoutingRule';

// `Query<table, schema, any>` mirrors zbugs's `IssueQuery` — `any` is required
// in the helper's TReturn so the `.one()`/list cases unify.
// biome-ignore lint/suspicious/noExplicitAny: matches zbugs queries.ts
type WorkspaceQuery = Query<WorkspaceScopedTable, DefaultSchema, any>;
// biome-ignore lint/suspicious/noExplicitAny: matches zbugs queries.ts
type TicketQuery = Query<'ticket', DefaultSchema, any>;

// ---------- Permission helpers ----------

/**
 * Force `workspaceID = auth.workspaceID` on any ticket query. Returns the
 * input type (`TQuery`) so the caller can keep chaining `.related(...)` /
 * `.orderBy(...)` afterwards. Pattern matches zbugs's `applyIssuePermissions`.
 *
 * When `auth` is missing the filter compares against a sentinel that never
 * matches a real workspace id — the query short-circuits to empty.
 */
export function applyWorkspaceScope<TQuery extends WorkspaceQuery>(
  q: TQuery,
  auth: AuthData | undefined | null,
): TQuery {
  return q.where('workspaceID', '=', auth?.workspaceID ?? '__no-workspace__') as TQuery;
}

/**
 * Read-side ticket helper. Phase 4 will layer team/visibility filters on
 * top, mirroring `applyIssuePermissions`.
 */
export function applyTicketRead<TQuery extends TicketQuery>(
  q: TQuery,
  auth: AuthData | undefined | null,
): TQuery {
  return applyWorkspaceScope(q, auth);
}

// ---------- Argument schemas ----------

const idArg = z.object({ id: z.string() });
const emptyArg = z.undefined();

// ---------- Queries ----------

export const queries = defineQueries({
  /**
   * Single ticket by id, scoped to the caller's workspace, with relateds for
   * the ticket detail view. Phase 2c will read this from `useQuery`.
   */
  ticketByID: defineQuery(idArg, ({ args: { id }, ctx: auth }) =>
    applyTicketRead(builder.ticket.where('id', id), auth)
      .related('customer')
      .related('assignee')
      .related('createdBy')
      .related('closedBy')
      .related('messages', (m) =>
        m
          .related('attachments')
          .related('authorUser')
          .related('authorCustomer')
          .related('outboundMessages', (o) =>
            o.related('channel').related('emailAddress').orderBy('createdAt', 'asc'),
          )
          .orderBy('createdAt', 'asc'),
      )
      .one(),
  ),

  /**
   * Inbox — open / in_progress / snoozed tickets in the caller's workspace,
   * sorted by recency.
   */
  inboxOpen: defineQuery(emptyArg, ({ ctx: auth }) =>
    applyTicketRead(
      builder.ticket.where(({ cmp, or }) =>
        or(
          cmp('status', '=', 'open'),
          cmp('status', '=', 'in_progress'),
          cmp('status', '=', 'snoozed'),
        ),
      ),
      auth,
    )
      .related('customer')
      .related('assignee')
      .orderBy('updatedAt', 'desc'),
  ),

  /**
   * Tickets assigned to the calling agent. Workspace-scoped + assignee filter.
   */
  myTickets: defineQuery(emptyArg, ({ ctx: auth }) =>
    applyTicketRead(builder.ticket.where('assigneeID', '=', auth?.sub ?? '__no-user__'), auth)
      .related('customer')
      .orderBy('updatedAt', 'desc'),
  ),

  /**
   * Status-grouped count for header badges. Zero 1.3.0 has no GROUP BY in
   * ZQL, so we return raw rows and aggregate client-side.
   */
  ticketCountByStatus: defineQuery(emptyArg, ({ ctx: auth }) =>
    applyTicketRead(builder.ticket, auth),
  ),

  /**
   * Members of the caller's workspace, with their `user` row joined for
   * display. Reads from the auth-mirror `member` table (better-auth org
   * plugin) and scopes by `organizationId = auth.workspaceID`. Used in the
   * Phase-2c assignee dropdown.
   */
  workspaceMembers: defineQuery(emptyArg, ({ ctx: auth }) =>
    builder.member
      .where('organizationId', '=', auth?.workspaceID ?? '__no-workspace__')
      .related('user'),
  ),

  /**
   * Phase 3a: list sending domains for the caller's workspace. Used in
   * `/app/settings/email/domains`.
   */
  sendingDomains: defineQuery(emptyArg, ({ ctx: auth }) =>
    applyWorkspaceScope(builder.sendingDomain, auth).orderBy('createdAt', 'asc'),
  ),

  /**
   * Phase 3a: a single sending domain by id, scoped to the caller's
   * workspace. The detail page renders DKIM/MAIL FROM/DMARC records.
   */
  sendingDomainByID: defineQuery(idArg, ({ args: { id }, ctx: auth }) =>
    applyWorkspaceScope(builder.sendingDomain.where('id', id), auth).one(),
  ),

  /**
   * Phase 3a/3c: sendable email addresses for the reply composer from-picker.
   * Address rows carry workspaceID directly and include per-address signature;
   * related channel/domain rows render labels and domain status.
   */
  sendableEmailAddresses: defineQuery(emptyArg, ({ ctx: auth }) =>
    applyWorkspaceScope(
      builder.emailAddress.where('canSend', '=', true).where('deletedAt', 'IS', null),
      auth,
    )
      .related('channel')
      .related('sendingDomain')
      .orderBy('isDefault', 'desc')
      .orderBy('fullAddress', 'asc'),
  ),

  /**
   * Phase 3b: receivable addresses for inbound routing setup. These are the
   * same per-workspace email address rows, filtered to active inbound-capable
   * addresses.
   */
  receivableEmailAddresses: defineQuery(emptyArg, ({ ctx: auth }) =>
    applyWorkspaceScope(
      builder.emailAddress.where('canReceive', '=', true).where('deletedAt', 'IS', null),
      auth,
    )
      .related('channel')
      .related('sendingDomain')
      .orderBy('isDefault', 'desc')
      .orderBy('fullAddress', 'asc'),
  ),

  /**
   * Phase 3b: declarative routing rules, already ordered in evaluation order.
   */
  inboundRoutingRules: defineQuery(emptyArg, ({ ctx: auth }) =>
    applyWorkspaceScope(builder.inboundRoutingRule, auth)
      .related('channel')
      .related('emailAddress')
      .related('assignAgent')
      .orderBy('priority', 'asc')
      .orderBy('createdAt', 'asc'),
  ),

  /**
   * Phase 3a: workspace suppression list, channel-optional by contract.
   */
  suppressions: defineQuery(emptyArg, ({ ctx: auth }) =>
    applyWorkspaceScope(builder.suppression, auth).related('channel').orderBy('createdAt', 'desc'),
  ),

  /**
   * Phase 3a: outbound delivery rows for a given ticket (one per agent reply
   * dispatched through the delivery subsystem). The ticket detail UI joins these
   * onto the message bubbles to render a delivery-status badge.
   */
  outboundMessagesByTicket: defineQuery(idArg, ({ args: { id }, ctx: auth }) =>
    applyWorkspaceScope(builder.outboundMessage.where('ticketID', '=', id), auth)
      .related('channel')
      .related('emailAddress')
      .related('message')
      .related('ticket')
      .orderBy('createdAt', 'asc'),
  ),

  /**
   * Phase 3b: raw inbound archive rows associated with a processed ticket.
   * Used by ingestion/debug UI and by message-detail auth indicators later.
   */
  inboundMessagesByTicket: defineQuery(idArg, ({ args: { id }, ctx: auth }) =>
    applyWorkspaceScope(builder.inboundMessageRaw.where('processedTicketID', '=', id), auth)
      .related('channel')
      .related('processedMessage')
      .related('processedTicket')
      .orderBy('receivedAt', 'asc'),
  ),
});

export type Queries = typeof queries;
