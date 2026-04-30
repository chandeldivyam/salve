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

// `Query<table, schema, any>` mirrors zbugs's `IssueQuery` — `any` is required
// in the helper's TReturn so the `.one()`/list cases unify.
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
export function applyWorkspaceScope<TQuery extends TicketQuery>(
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
      .related('messages', (m) =>
        m.related('attachments').related('authorUser').orderBy('createdAt', 'asc'),
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
});

export type Queries = typeof queries;
