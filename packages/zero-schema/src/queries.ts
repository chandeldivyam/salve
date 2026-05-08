// @salve/zero-schema/queries — workspace-scoped query helpers.
//
// Pattern from `/tmp/zero-mono/apps/zbugs/shared/queries.ts:69-306`. Every
// query goes through `applyWorkspaceScope` so a missing `.where('workspaceID',
// ...)` is structurally impossible — that is the *single* mitigation
// referenced in the plan's "No declarative permissions" risk.

import {
  type DefaultSchema,
  defineQueries,
  defineQuery,
  escapeLike,
  type Query,
  type QueryResultType,
} from '@rocicorp/zero';
import { z } from 'zod';
import {
  ALL_TICKET_MESSAGE_LIMIT,
  CUSTOMER_TICKET_LIMIT,
  DEFAULT_CUSTOMER_EVENT_LIMIT,
  DEFAULT_CUSTOMER_LIST_LIMIT,
  DEFAULT_CUSTOMER_TICKET_SUMMARY_LIMIT,
  DEFAULT_RELATED_TICKET_LIMIT,
  INBOX_INITIAL_PAGE,
  MAX_INBOX_LIMIT,
  MAX_LIST_LIMIT,
  MAX_LIST_LIMIT_QUERY,
  SETTINGS_CATALOGUE_LIMIT,
  TICKET_ANCHOR_LIMIT,
  VIEW_LIST_LIMIT,
  VIEW_MEMBER_LIST_LIMIT,
} from './consts.js';
import type { AuthData } from './schema.js';
import { builder } from './schema.js';
import {
  applyFilterToQuery,
  resolveMeTokens,
  type ViewSort,
  viewQueryZ,
  viewSortToOrderBy,
} from './views.js';

type WorkspaceScopedTable =
  | 'customer'
  | 'ticket'
  | 'message'
  | 'auditEvent'
  | 'customerNote'
  | 'customEvent'
  | 'tagGroup'
  | 'tag'
  | 'customField'
  | 'sendingDomain'
  | 'emailAddress'
  | 'suppression'
  | 'outboundMessage'
  | 'inboundMessageRaw'
  | 'inboundRoutingRule'
  | 'view'
  | 'viewMember'
  | 'builtinViewMember'
  | 'apikey';

// `Query<table, schema, any>` mirrors zbugs's `IssueQuery` — `any` is required
// in the helper's TReturn so the `.one()`/list cases unify.
// biome-ignore lint/suspicious/noExplicitAny: matches zbugs queries.ts
type WorkspaceQuery = Query<WorkspaceScopedTable, DefaultSchema, any>;
// biome-ignore lint/suspicious/noExplicitAny: matches zbugs queries.ts
type TicketQuery = Query<'ticket', DefaultSchema, any>;

// ---------- Permission helpers ----------

/**
 * Force the result of a query to be empty by ANDing in an always-false
 * predicate (`or()` with no arguments evaluates to false). Mirrors the
 * zbugs pattern at `/tmp/zero-mono/apps/zbugs/shared/queries.ts:350-356`.
 *
 * Used as the unauthenticated short-circuit instead of comparing against a
 * sentinel string — structurally impossible to collide with a real value.
 */
function alwaysFalse<
  TTable extends keyof TSchema['tables'] & string,
  TSchema extends DefaultSchema,
  TReturn,
>(q: Query<TTable, TSchema, TReturn>): Query<TTable, TSchema, TReturn> {
  return q.where(({ or }) => or());
}

/**
 * Force `workspaceID = auth.workspaceID` on any workspace-scoped query.
 * Returns the input type (`TQuery`) so the caller can keep chaining
 * `.related(...)` / `.orderBy(...)` afterwards. Pattern matches zbugs's
 * `applyIssuePermissions`.
 *
 * When `auth` is missing we short-circuit with `alwaysFalse(q)` instead of a
 * sentinel comparison.
 */
export function applyWorkspaceScope<TQuery extends WorkspaceQuery>(
  q: TQuery,
  auth: AuthData | undefined | null,
): TQuery {
  if (!auth?.workspaceID) {
    return alwaysFalse(q) as TQuery;
  }
  return q.where('workspaceID', '=', auth.workspaceID) as TQuery;
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
const customFieldCategoryArg = z.object({
  category: z.enum(['ticket', 'customer']),
});

// `inboxOpen` accepts an optional `limit` so the inbox view can grow the
// window via infinite scroll without round-tripping a different query
// shape. The inbox uses an absolute window (no `+1` sentinel) — see the
// note in `consts.ts`.
const inboxOpenArg = z
  .object({ limit: z.number().int().min(1).max(MAX_INBOX_LIMIT).optional() })
  .optional();

// `boundedListLimit` is for paginated list queries that use the `+1`
// sentinel (e.g. `customerList`). Cap = MAX_LIST_LIMIT + 1 so the sentinel
// fits without exceeding the schema.
const boundedListLimit = z.number().int().min(1).max(MAX_LIST_LIMIT_QUERY).optional();

// `boundedTimelineLimit` is for "fetch a bounded slab" queries that pass an
// absolute limit (no sentinel) — `ticketMessagesAll`, `ticketActivitiesAll`,
// `customerNotes`, `customerEvents`. Cap = ALL_TICKET_MESSAGE_LIMIT.
const boundedTimelineLimit = z.number().int().min(1).max(ALL_TICKET_MESSAGE_LIMIT).optional();

const ticketAnchorArg = z.object({
  id: z.string(),
  messageLimit: z.number().int().min(1).max(ALL_TICKET_MESSAGE_LIMIT).optional(),
  activityLimit: z.number().int().min(1).max(ALL_TICKET_MESSAGE_LIMIT).optional(),
});
const ticketTimelineRowsArg = z.object({
  ticketID: z.string(),
  limit: boundedTimelineLimit,
});
const customerListArg = z.object({
  search: z.string().trim().max(120).optional(),
  limit: boundedListLimit,
});
const customerTicketSummariesArg = z
  .object({
    customerID: z.string(),
    before: z.number().optional(),
    after: z.number().optional(),
    limit: z.number().int().min(1).max(CUSTOMER_TICKET_LIMIT).optional(),
  })
  .refine((args) => args.before === undefined || args.after === undefined, {
    message: 'customerTicketSummaries accepts either before or after, not both',
  });
const customerNotesArg = z.object({
  customerID: z.string(),
  limit: boundedTimelineLimit,
});
const customerEventsArg = z.object({
  customerID: z.string(),
  limit: boundedTimelineLimit,
});
const relatedTicketsArg = z.object({
  customerID: z.string(),
  excludeTicketID: z.string().optional(),
  includeClosed: z.boolean().optional(),
  limit: z.number().int().min(1).max(CUSTOMER_TICKET_LIMIT).optional(),
});

// `ticketsForView` accepts the resolved (post-`$ME`-substitution) `ViewQuery`
// shape from the client. The full `viewQueryZ` validation lives in
// view-mutators; here we only enforce the broad shape so a malformed payload
// doesn't crash query subscription.
// Args wire shape is JSON-compatible. Strict `ViewQuery` / `ViewSort` shapes
// from `views.ts` don't carry an index signature, so we accept a loose
// `z.any()` array here and cast inside the handler. `viewQueryZ` enforces the
// strict shape at mutator write time.
const ticketsForViewArg = z.object({
  viewID: z.string(),
  viewQuery: z.object({
    filters: z.array(z.any()).max(40),
    matchAll: z.boolean().optional(),
    search: z.string().optional(),
  }),
  sort: z
    .object({
      field: z.string(),
      direction: z.enum(['asc', 'desc']),
    })
    .optional(),
  limit: z.number().int().min(1).max(MAX_INBOX_LIMIT).optional(),
});

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
      .related('resolvedBy')
      .related('closedBy')
      .related('tags', (tt) =>
        tt
          .related('tag', (t) => t.related('group'))
          .related('addedBy')
          .orderBy('addedAt', 'desc')
          .orderBy('tagID', 'asc'),
      )
      .related('customFieldValues', (v) =>
        v.related('field').related('updatedBy').orderBy('updatedAt', 'desc').orderBy('id', 'asc'),
      )
      .related('messages', (m) =>
        m
          .related('attachments')
          .related('authorUser')
          .related('authorCustomer')
          .related('outboundMessages', (o) =>
            o
              .related('channel')
              .related('emailAddress')
              .orderBy('createdAt', 'asc')
              .orderBy('id', 'asc'),
          )
          .orderBy('createdAt', 'asc')
          .orderBy('id', 'asc'),
      )
      .one(),
  ),

  /**
   * Customer profile header and right-rail data. Workspace-scoped by customer
   * row and preloads tags/custom fields for the profile card.
   */
  customerByID: defineQuery(idArg, ({ args: { id }, ctx: auth }) =>
    applyWorkspaceScope(builder.customer.where('id', '=', id), auth)
      .related('tags', (ct) =>
        ct
          .related('tag', (t) => t.related('group'))
          .related('addedBy')
          .orderBy('addedAt', 'desc')
          .orderBy('tagID', 'asc'),
      )
      .related('customFieldValues', (v) =>
        v.related('field').related('updatedBy').orderBy('updatedAt', 'desc').orderBy('id', 'asc'),
      )
      .one(),
  ),

  /**
   * Bounded customer list for the initial customers surface. Search is escaped
   * before being used in ILIKE patterns.
   */
  customerList: defineQuery(customerListArg, ({ args, ctx: auth }) => {
    const limit = Math.min(args.limit ?? DEFAULT_CUSTOMER_LIST_LIMIT, MAX_LIST_LIMIT);
    const search = args.search?.trim();
    let q = applyWorkspaceScope(builder.customer, auth).related('tags', (ct) =>
      ct
        .related('tag', (t) => t.related('group'))
        .orderBy('addedAt', 'desc')
        .orderBy('tagID', 'asc'),
    );
    if (search) {
      const pattern = `%${escapeLike(search)}%`;
      q = q.where(({ cmp, or }) =>
        or(
          cmp('email', 'ILIKE', pattern),
          cmp('name', 'ILIKE', pattern),
          cmp('displayName', 'ILIKE', pattern),
        ),
      );
    }
    return q
      .orderBy('lastSeenAt', 'desc')
      .orderBy('updatedAt', 'desc')
      .orderBy('id', 'desc')
      .limit(limit);
  }),

  /**
   * Anchor conversation for the timeline: current ticket with recent messages,
   * recent ticket activities, and ticket-scoped customer notes. Message and
   * activity limits use the +1 sentinel model from zbugs.
   */
  ticketAnchor: defineQuery(ticketAnchorArg, ({ args, ctx: auth }) => {
    const messageLimit = Math.min(
      args.messageLimit ?? TICKET_ANCHOR_LIMIT,
      ALL_TICKET_MESSAGE_LIMIT,
    );
    const activityLimit = Math.min(
      args.activityLimit ?? TICKET_ANCHOR_LIMIT,
      ALL_TICKET_MESSAGE_LIMIT,
    );
    return applyTicketRead(builder.ticket.where('id', '=', args.id), auth)
      .related('customer')
      .related('assignee')
      .related('createdBy')
      .related('resolvedBy')
      .related('closedBy')
      .related('tags', (tt) =>
        tt
          .related('tag', (t) => t.related('group'))
          .related('addedBy')
          .orderBy('addedAt', 'desc')
          .orderBy('tagID', 'asc'),
      )
      .related('customFieldValues', (v) =>
        v.related('field').related('updatedBy').orderBy('updatedAt', 'desc').orderBy('id', 'asc'),
      )
      .related('messages', (m) =>
        m
          .related('attachments')
          .related('authorUser')
          .related('authorCustomer')
          .related('outboundMessages', (o) =>
            o
              .related('channel')
              .related('emailAddress')
              .orderBy('createdAt', 'asc')
              .orderBy('id', 'asc'),
          )
          .orderBy('createdAt', 'desc')
          .orderBy('id', 'desc')
          .limit(messageLimit),
      )
      .related('auditEvents', (a) =>
        a
          .related('actor')
          .where('kind', 'LIKE', 'ticket.%')
          .orderBy('createdAt', 'desc')
          .orderBy('id', 'desc')
          .limit(activityLimit),
      )
      .related('customerNotes', (n) =>
        n
          .where('objectType', '=', 'ticket')
          .where('deletedAt', 'IS', null)
          .related('createdBy')
          .orderBy('createdAt', 'desc')
          .orderBy('id', 'desc')
          .limit(messageLimit),
      )
      .one();
  }),

  /**
   * Explicit bounded fetch for older/all messages in a conversation. The UI can
   * raise `limit` up to ALL_TICKET_MESSAGE_LIMIT when "show earlier" is clicked.
   */
  ticketMessagesAll: defineQuery(ticketTimelineRowsArg, ({ args, ctx: auth }) => {
    const limit = Math.min(args.limit ?? ALL_TICKET_MESSAGE_LIMIT, ALL_TICKET_MESSAGE_LIMIT);
    return applyWorkspaceScope(builder.message.where('ticketID', '=', args.ticketID), auth)
      .related('attachments')
      .related('authorUser')
      .related('authorCustomer')
      .related('outboundMessages', (o) =>
        o
          .related('channel')
          .related('emailAddress')
          .orderBy('createdAt', 'asc')
          .orderBy('id', 'asc'),
      )
      .orderBy('createdAt', 'asc')
      .orderBy('id', 'asc')
      .limit(limit);
  }),

  /**
   * Explicit bounded fetch for ticket activities in a conversation.
   */
  ticketActivitiesAll: defineQuery(ticketTimelineRowsArg, ({ args, ctx: auth }) => {
    const limit = Math.min(args.limit ?? ALL_TICKET_MESSAGE_LIMIT, ALL_TICKET_MESSAGE_LIMIT);
    return applyWorkspaceScope(
      builder.auditEvent.where('ticketID', '=', args.ticketID).where('kind', 'LIKE', 'ticket.%'),
      auth,
    )
      .related('actor')
      .orderBy('createdAt', 'asc')
      .orderBy('id', 'asc')
      .limit(limit);
  }),

  /**
   * Header-only customer conversations around an anchor. `limit + 1` gives the
   * UI a sentinel row for "show earlier/later" without a count query.
   */
  customerTicketSummaries: defineQuery(customerTicketSummariesArg, ({ args, ctx: auth }) => {
    const limit = Math.min(
      args.limit ?? DEFAULT_CUSTOMER_TICKET_SUMMARY_LIMIT,
      CUSTOMER_TICKET_LIMIT,
    );
    const orderDirection = args.after !== undefined ? 'asc' : 'desc';
    let q = applyTicketRead(builder.ticket.where('customerID', '=', args.customerID), auth)
      .related('customer')
      .related('assignee')
      .related('tags', (tt) =>
        tt
          .related('tag', (t) => t.related('group'))
          .orderBy('addedAt', 'desc')
          .orderBy('tagID', 'asc'),
      )
      .related('messages', (m) =>
        m
          .related('authorUser')
          .related('authorCustomer')
          .orderBy('createdAt', 'desc')
          .orderBy('id', 'desc')
          .limit(1),
      );
    if (args.before !== undefined) {
      q = q.where('createdAt', '<', args.before);
    } else if (args.after !== undefined) {
      q = q.where('createdAt', '>', args.after);
    }
    return q
      .orderBy('createdAt', orderDirection)
      .orderBy('id', orderDirection)
      .limit(limit + 1);
  }),

  /**
   * Customer-level and ticket-scoped notes for a customer timeline/profile.
   */
  customerNotes: defineQuery(customerNotesArg, ({ args, ctx: auth }) => {
    const limit = Math.min(args.limit ?? CUSTOMER_TICKET_LIMIT, ALL_TICKET_MESSAGE_LIMIT);
    return applyWorkspaceScope(
      builder.customerNote.where('customerID', '=', args.customerID).where('deletedAt', 'IS', null),
      auth,
    )
      .related('createdBy')
      .orderBy('pinned', 'desc')
      .orderBy('createdAt', 'desc')
      .orderBy('id', 'desc')
      .limit(limit);
  }),

  /**
   * Customer custom events, newest first.
   */
  customerEvents: defineQuery(customerEventsArg, ({ args, ctx: auth }) => {
    const limit = Math.min(args.limit ?? DEFAULT_CUSTOMER_EVENT_LIMIT, ALL_TICKET_MESSAGE_LIMIT);
    return applyWorkspaceScope(builder.customEvent.where('customerID', '=', args.customerID), auth)
      .orderBy('occurredAt', 'desc')
      .orderBy('id', 'desc')
      .limit(limit);
  }),

  /**
   * Right-rail related conversations for any conversation header.
   */
  relatedTickets: defineQuery(relatedTicketsArg, ({ args, ctx: auth }) => {
    const limit = Math.min(args.limit ?? DEFAULT_RELATED_TICKET_LIMIT, CUSTOMER_TICKET_LIMIT);
    let q = applyTicketRead(builder.ticket.where('customerID', '=', args.customerID), auth)
      .related('assignee')
      .related('tags', (tt) =>
        tt
          .related('tag', (t) => t.related('group'))
          .orderBy('addedAt', 'desc')
          .orderBy('tagID', 'asc'),
      );
    if (args.excludeTicketID) {
      q = q.where(({ cmp, not }) => not(cmp('id', '=', args.excludeTicketID)));
    }
    if (!args.includeClosed) {
      q = q.where(({ and, cmp, not }) =>
        and(not(cmp('status', '=', 'resolved')), not(cmp('status', '=', 'closed'))),
      );
    }
    return q.orderBy('updatedAt', 'desc').orderBy('id', 'desc').limit(limit);
  }),

  /**
   * Inbox — open / in_progress / snoozed tickets in the caller's workspace,
   * sorted by recency. Bounded by `limit` (default 200, max 2000) so the
   * subscription cost stays predictable for large workspaces. The list view
   * grows the limit as the user scrolls.
   */
  inboxOpen: defineQuery(inboxOpenArg, ({ args, ctx: auth }) => {
    const limit = Math.min(args?.limit ?? INBOX_INITIAL_PAGE, MAX_INBOX_LIMIT);
    return applyTicketRead(
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
      .related('tags', (tt) =>
        tt
          .related('tag', (t) => t.related('group'))
          .orderBy('addedAt', 'desc')
          .orderBy('tagID', 'asc'),
      )
      .orderBy('updatedAt', 'desc')
      .orderBy('id', 'desc')
      .limit(limit);
  }),

  /**
   * Active tag groups for settings and grouped tag pickers. Capped at
   * `SETTINGS_CATALOGUE_LIMIT` so the open subscription cost stays bounded
   * for workspaces with thousands of tags.
   */
  tagGroups: defineQuery(emptyArg, ({ ctx: auth }) =>
    applyWorkspaceScope(builder.tagGroup.where('archivedAt', 'IS', null), auth)
      .orderBy('sortOrder', 'asc')
      .orderBy('label', 'asc')
      .orderBy('id', 'asc')
      .limit(SETTINGS_CATALOGUE_LIMIT),
  ),

  /**
   * Settings view: include archived groups so admins can restore them.
   */
  tagGroupsForSettings: defineQuery(emptyArg, ({ ctx: auth }) =>
    applyWorkspaceScope(builder.tagGroup, auth)
      .orderBy('sortOrder', 'asc')
      .orderBy('label', 'asc')
      .orderBy('id', 'asc')
      .limit(SETTINGS_CATALOGUE_LIMIT),
  ),

  /**
   * Active tags with optional group metadata.
   */
  tags: defineQuery(emptyArg, ({ ctx: auth }) =>
    applyWorkspaceScope(builder.tag.where('archivedAt', 'IS', null), auth)
      .related('group')
      .orderBy('sortOrder', 'asc')
      .orderBy('label', 'asc')
      .orderBy('id', 'asc')
      .limit(SETTINGS_CATALOGUE_LIMIT),
  ),

  /**
   * Settings view: include archived tags so admins can restore them.
   */
  tagsForSettings: defineQuery(emptyArg, ({ ctx: auth }) =>
    applyWorkspaceScope(builder.tag, auth)
      .related('group')
      .orderBy('sortOrder', 'asc')
      .orderBy('label', 'asc')
      .orderBy('id', 'asc')
      .limit(SETTINGS_CATALOGUE_LIMIT),
  ),

  /**
   * Active custom field definitions by entity category.
   */
  customFieldsByCategory: defineQuery(customFieldCategoryArg, ({ args: { category }, ctx: auth }) =>
    applyWorkspaceScope(
      builder.customField.where('category', '=', category).where('active', '=', true),
      auth,
    )
      .orderBy('sortOrder', 'asc')
      .orderBy('displayName', 'asc')
      .orderBy('id', 'asc')
      .limit(SETTINGS_CATALOGUE_LIMIT),
  ),

  /**
   * Settings view: include inactive definitions so admins can audit and restore
   * archived custom fields without widening the agent sidebar query above.
   */
  customFieldsForSettings: defineQuery(
    customFieldCategoryArg,
    ({ args: { category }, ctx: auth }) =>
      applyWorkspaceScope(builder.customField.where('category', '=', category), auth)
        .orderBy('active', 'desc')
        .orderBy('sortOrder', 'asc')
        .orderBy('displayName', 'asc')
        .orderBy('id', 'asc')
        .limit(SETTINGS_CATALOGUE_LIMIT),
  ),

  /**
   * Tickets assigned to the calling agent. Workspace-scoped + assignee filter.
   * Short-circuits to empty when there is no authenticated user (no `sub`).
   */
  myTickets: defineQuery(emptyArg, ({ ctx: auth }) => {
    const base = builder.ticket;
    if (!auth?.sub) {
      return alwaysFalse(base)
        .related('customer')
        .orderBy('updatedAt', 'desc')
        .orderBy('id', 'desc');
    }
    return applyTicketRead(base.where('assigneeID', '=', auth.sub), auth)
      .related('customer')
      .orderBy('updatedAt', 'desc')
      .orderBy('id', 'desc');
  }),

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
  workspaceMembers: defineQuery(emptyArg, ({ ctx: auth }) => {
    const base = builder.member;
    if (!auth?.workspaceID) {
      return alwaysFalse(base).related('user');
    }
    return base.where('organizationId', '=', auth.workspaceID).related('user');
  }),

  /**
   * Pending invitations for the caller's workspace. Scoped by
   * `organizationId = auth.workspaceID` (same manual pattern as
   * `workspaceMembers` — invitation has no `workspaceID` alias so we skip
   * `applyWorkspaceScope` and do the where clause directly).
   */
  workspaceInvitations: defineQuery(emptyArg, ({ ctx: auth }) => {
    const base = builder.invitation;
    if (!auth?.workspaceID) {
      return alwaysFalse(base).related('inviter');
    }
    return base
      .where('organizationId', '=', auth.workspaceID)
      .where('status', '=', 'pending')
      .related('inviter')
      .orderBy('createdAt', 'desc')
      .orderBy('id', 'desc');
  }),

  /**
   * Pending invitations addressed to the current user's email, across all
   * workspaces. Used for the "you've been invited" banner and the join page.
   * Short-circuits to empty when `auth.email` is absent (e.g. service accounts).
   */
  userInvitations: defineQuery(emptyArg, ({ ctx: auth }) => {
    const base = builder.invitation;
    const email = auth?.email;
    if (!email) {
      return alwaysFalse(base).related('organization').related('inviter');
    }
    return base
      .where('email', '=', email)
      .where('status', '=', 'pending')
      .related('organization')
      .related('inviter')
      .orderBy('createdAt', 'desc')
      .orderBy('id', 'desc');
  }),

  /**
   * Personal access tokens belonging to the caller. Returns only the user's
   * own tokens — `principalKind='user' AND principalId=auth.sub` — so an
   * agent never sees another agent's tokens, even though all keys live in
   * the same workspace-scoped table.
   */
  apiTokensForCurrentUser: defineQuery(emptyArg, ({ ctx: auth }) => {
    const base = builder.apikey;
    if (!auth?.workspaceID || !auth?.sub) return alwaysFalse(base);
    return applyWorkspaceScope(base, auth)
      .where('principalKind', '=', 'user')
      .where('principalId', '=', auth.sub)
      .orderBy('createdAt', 'desc')
      .orderBy('id', 'desc');
  }),

  /**
   * Service-account members in the workspace, with the joined `user` mirror
   * (carries the human-readable name) and the apikey row attached. Visible
   * to anyone in the workspace; the route gates create/delete affordances
   * on `auth.role`.
   */
  serviceAccounts: defineQuery(emptyArg, ({ ctx: auth }) => {
    const base = builder.member;
    if (!auth?.workspaceID) return alwaysFalse(base).related('user');
    return base
      .where('organizationId', '=', auth.workspaceID)
      .where('kind', '=', 'service_account')
      .related('user')
      .orderBy('createdAt', 'desc')
      .orderBy('id', 'desc');
  }),

  /**
   * Apikey rows for service accounts in the workspace. Joined client-side
   * with `serviceAccounts` via `principalId === member.id`. Same scoping as
   * `apiTokensForCurrentUser` minus the user filter.
   */
  serviceAccountTokens: defineQuery(emptyArg, ({ ctx: auth }) => {
    const base = builder.apikey;
    if (!auth?.workspaceID) return alwaysFalse(base);
    return applyWorkspaceScope(base, auth)
      .where('principalKind', '=', 'service_account')
      .orderBy('createdAt', 'desc')
      .orderBy('id', 'desc');
  }),

  /**
   * Phase 3a: list sending domains for the caller's workspace. Used in
   * `/app/settings/email/domains`.
   */
  sendingDomains: defineQuery(emptyArg, ({ ctx: auth }) =>
    applyWorkspaceScope(builder.sendingDomain, auth)
      .orderBy('createdAt', 'asc')
      .orderBy('id', 'asc'),
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
      .orderBy('fullAddress', 'asc')
      .orderBy('id', 'asc'),
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
      .orderBy('fullAddress', 'asc')
      .orderBy('id', 'asc'),
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
      .orderBy('createdAt', 'asc')
      .orderBy('id', 'asc'),
  ),

  /**
   * Phase 3a: workspace suppression list, channel-optional by contract.
   */
  suppressions: defineQuery(emptyArg, ({ ctx: auth }) =>
    applyWorkspaceScope(builder.suppression, auth)
      .related('channel')
      .orderBy('createdAt', 'desc')
      .orderBy('id', 'desc'),
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
      .orderBy('createdAt', 'asc')
      .orderBy('id', 'asc'),
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
      .orderBy('receivedAt', 'asc')
      .orderBy('id', 'asc'),
  ),

  /**
   * Phase 40: saved inbox views the caller can see.
   *
   * Returns:
   *   - workspace-scoped views the agent has not hidden (via `view_member`)
   *   - personal-scoped views the agent owns
   *
   * The related `members[0]` row carries the per-agent `position` used to
   * sort the tab strip client-side. Built-ins are layered on top in the UI;
   * they don't appear in this Zero result.
   */
  views: defineQuery(emptyArg, ({ ctx: auth }) => {
    if (!auth?.workspaceID || !auth?.sub) {
      return alwaysFalse(builder.view);
    }
    const userID = auth.sub;
    // NOTE: Zero does not support `not(exists(...))` on the client
    // (https://bugs.rocicorp.dev/issue/3438). We omit the "not hidden"
    // workspace-view predicate here and filter hidden views client-side in
    // `<InboxViewStrip>` using the related `members[0].hiddenAt` column.
    return applyWorkspaceScope(builder.view, auth)
      .where('archivedAt', 'IS', null)
      .where(({ or, and, cmp }) =>
        or(
          cmp('scope', '=', 'workspace'),
          and(cmp('scope', '=', 'personal'), cmp('ownerID', '=', userID)),
        ),
      )
      .related('members', (m) => m.where('userID', '=', userID))
      .related('owner')
      .orderBy('createdAt', 'asc')
      .orderBy('id', 'asc')
      .limit(VIEW_LIST_LIMIT);
  }),

  /**
   * Single saved view by id, with the caller's membership row joined.
   *
   * Scope hardening: a workspace-scoped view is readable by anyone in the
   * workspace, a personal-scope view is readable only by its owner, and
   * archived views are not readable at all (they live behind a separate
   * "archived views" surface — Phase 50). Without this guard, any agent
   * who knows a personal view's UUID could open it; that's the same hole
   * the `views()` listing already closes.
   */
  viewByID: defineQuery(idArg, ({ args: { id }, ctx: auth }) => {
    if (!auth?.sub) {
      return alwaysFalse(builder.view).one();
    }
    const userID = auth.sub;
    return applyWorkspaceScope(builder.view.where('id', '=', id), auth)
      .where('archivedAt', 'IS', null)
      .where(({ or, and, cmp }) =>
        or(
          cmp('scope', '=', 'workspace'),
          and(cmp('scope', '=', 'personal'), cmp('ownerID', '=', userID)),
        ),
      )
      .related('members', (m) => m.where('userID', '=', userID))
      .related('owner')
      .one();
  }),

  /**
   * Built-in view membership rows for the caller (per-agent ordering and
   * per-agent hide state for All / Unassigned / Mine / Resolved). The
   * client merges these with the static `BUILTIN_VIEWS` constant.
   */
  builtinViewMembers: defineQuery(emptyArg, ({ ctx: auth }) => {
    if (!auth?.workspaceID || !auth?.sub) {
      return alwaysFalse(builder.builtinViewMember);
    }
    const userID = auth.sub;
    return applyWorkspaceScope(builder.builtinViewMember, auth)
      .where('userID', '=', userID)
      .orderBy('builtinKey', 'asc')
      .limit(VIEW_MEMBER_LIST_LIMIT);
  }),

  /**
   * Phase 40: tickets matching a saved view. The `viewQuery` is composed
   * imperatively over a base `applyTicketRead(builder.ticket)` query — the
   * exact pattern from zbugs's `buildListQuery` (see `views.ts`).
   *
   * Free-text `search` is not applied here; the client intersects with
   * the FTS endpoint result set in a follow-up phase. Custom-field
   * filtering is currently limited to existence checks.
   */
  ticketsForView: defineQuery(ticketsForViewArg, ({ args, ctx: auth }) => {
    const { viewQuery, sort, limit } = args;
    const cap = Math.min(limit ?? INBOX_INITIAL_PAGE, MAX_INBOX_LIMIT);

    // Pull `customFieldValues` only when a custom-field filter is in play.
    // The Zero subscription cost is N tickets × M field rows × per-row
    // metadata; on a stock inbox (no custom-field chips) this would
    // multiply the wire traffic without any benefit. Client-side
    // post-filtering in `customFieldPredicate` reads from the same shape
    // when the relation is present and short-circuits when it isn't.
    const needsCustomFieldValues = (viewQuery.filters as Array<{ field?: unknown }>).some(
      (f) => typeof f?.field === 'string' && (f.field as string).startsWith('customField:'),
    );

    let q = applyTicketRead(builder.ticket, auth)
      .related('customer')
      .related('assignee')
      .related('tags', (tt) =>
        tt
          .related('tag', (t) => t.related('group'))
          .orderBy('addedAt', 'desc')
          .orderBy('tagID', 'asc'),
      );

    if (needsCustomFieldValues) {
      // Filtering on the actual jsonb `value` happens client-side via
      // `matchesCustomFieldFilter` because the type-dependent shapes (esp.
      // arrays for multi_select) can't be uniformly expressed with
      // `.where('value', op, ...)`. Server-side narrowing is by *existence*
      // (see `applyCustomFieldExistence` in views.ts).
      q = q.related('customFieldValues', (cv) =>
        cv.related('field').orderBy('updatedAt', 'desc').orderBy('id', 'asc'),
      );
    }

    // Re-validate `viewQuery` shape with the strict `viewQueryZ` schema
    // before consuming any filter. The wire arg uses `z.any()` for each
    // filter (Zero `defineQuery` requires a JSON-compatible inferred
    // type; the strict discriminated-union shape doesn't satisfy that
    // constraint), so this is the actual safety net at the read path.
    // A malformed payload short-circuits to the result `alwaysFalse`
    // would produce: an empty query.
    const validated = viewQueryZ.safeParse(viewQuery);
    if (!validated.success) {
      return alwaysFalse(q).limit(0);
    }
    // Resolve any `$ME` tokens client-side at call time so the saved
    // view serves every agent.
    const resolved = resolveMeTokens(validated.data, auth?.sub ?? '');

    // v1 only supports AND across filters. `viewQueryZ` constrains
    // `matchAll` to `true` at write time so any saved view that lands
    // here will already be AND-shaped; the field is retained on the
    // wire for forward compatibility once OR lands.
    for (const filter of resolved.filters) {
      q = applyFilterToQuery(q, filter);
    }

    const [orderField, orderDir] = viewSortToOrderBy(sort as ViewSort | undefined);
    return (
      q
        // biome-ignore lint/suspicious/noExplicitAny: dynamic order field
        .orderBy(orderField as any, orderDir)
        .orderBy('id', 'desc')
        .limit(cap)
    );
  }),
});

export type Queries = typeof queries;

// ---------- Typed query result projections ----------
//
// Mirrors `/tmp/zero-mono/apps/zbugs/shared/queries.ts:451-453`. With
// `declare module '@rocicorp/zero' { interface DefaultTypes { schema } }` in
// `schema.ts`, `useQuery(queries.X(args))` already returns the right tuple;
// these named row types let callers project the data half without `as unknown
// as` casts.

/** Single ticket with relateds (returned by `.one()`). */
export type TicketDetailRow = QueryResultType<typeof queries.ticketByID>;

/** Customer profile row with tags and custom field values. */
export type CustomerDetailRow = QueryResultType<typeof queries.customerByID>;

/** Bounded customer list row for the customers surface. */
export type CustomerListRow = QueryResultType<typeof queries.customerList>[number];

/** Timeline anchor ticket with recent messages and activities. */
export type TicketAnchorRow = QueryResultType<typeof queries.ticketAnchor>;

/** Full-message window row for a ticket timeline. */
export type TicketMessageTimelineRow = QueryResultType<typeof queries.ticketMessagesAll>[number];

/** Full-activity window row for a ticket timeline. */
export type TicketActivityTimelineRow = QueryResultType<typeof queries.ticketActivitiesAll>[number];

/** Header-only customer conversation summary. */
export type CustomerTicketSummaryRow = QueryResultType<
  typeof queries.customerTicketSummaries
>[number];

/** Customer note row for timeline/profile surfaces. */
export type CustomerNoteRow = QueryResultType<typeof queries.customerNotes>[number];

/** Customer custom event row. */
export type CustomerEventRow = QueryResultType<typeof queries.customerEvents>[number];

/** Related ticket row for the profile rail. */
export type RelatedTicketRow = QueryResultType<typeof queries.relatedTickets>[number];

/** Inbox row (open/in_progress/snoozed list, with customer + assignee). */
export type InboxRow = QueryResultType<typeof queries.inboxOpen>[number];

/** Inbox row from `ticketsForView` — includes `customFieldValues` with `field`. */
export type ViewTicketRow = QueryResultType<typeof queries.ticketsForView>[number];

/** "Mine" inbox row (workspace + assignee scoped). */
export type MyTicketRow = QueryResultType<typeof queries.myTickets>[number];

/** Raw ticket row (for client-side status counts). */
export type TicketCountRow = QueryResultType<typeof queries.ticketCountByStatus>[number];

/** Active tag group row. */
export type TagGroupRow = QueryResultType<typeof queries.tagGroups>[number];

/** Active tag row with optional group metadata. */
export type TagRow = QueryResultType<typeof queries.tags>[number];

/** Active custom field definition row. */
export type CustomFieldDefinitionRow = QueryResultType<
  typeof queries.customFieldsByCategory
>[number];

/** Custom field definition row for settings, including archived definitions. */
export type CustomFieldSettingsRow = QueryResultType<
  typeof queries.customFieldsForSettings
>[number];

/** Workspace member row, with the joined `user` mirror. */
export type WorkspaceMemberRow = QueryResultType<typeof queries.workspaceMembers>[number];

/** Apikey row visible to the current user (their own PATs). */
export type ApiTokenRow = QueryResultType<typeof queries.apiTokensForCurrentUser>[number];

/** Service-account member row with joined user mirror. */
export type ServiceAccountRow = QueryResultType<typeof queries.serviceAccounts>[number];

/** Apikey row for a service account. */
export type ServiceAccountTokenRow = QueryResultType<typeof queries.serviceAccountTokens>[number];

/** Sending domain row, ordered by created-at. */
export type SendingDomainRow = QueryResultType<typeof queries.sendingDomains>[number];

/** Single sending domain (returned by `.one()`). */
export type SendingDomainDetailRow = QueryResultType<typeof queries.sendingDomainByID>;

/** Sendable email address row, with channel + sending domain relateds. */
export type SendableEmailAddressRow = QueryResultType<
  typeof queries.sendableEmailAddresses
>[number];

/** Receivable email address row, with channel + sending domain relateds. */
export type ReceivableEmailAddressRow = QueryResultType<
  typeof queries.receivableEmailAddresses
>[number];

/** Inbound routing rule row, with channel/address/assign-agent relateds. */
export type InboundRoutingRuleRow = QueryResultType<typeof queries.inboundRoutingRules>[number];

/** Suppression list row. */
export type SuppressionRow = QueryResultType<typeof queries.suppressions>[number];

/** Outbound delivery row tied to a message (per-ticket). */
export type OutboundMessageRow = QueryResultType<typeof queries.outboundMessagesByTicket>[number];

/** Raw inbound archive row tied to a processed ticket. */
export type InboundMessageRow = QueryResultType<typeof queries.inboundMessagesByTicket>[number];

/** Pending invitation row for the caller's workspace, with inviter user joined. */
export type WorkspaceInvitationRow = QueryResultType<typeof queries.workspaceInvitations>[number];

/** Pending invitation row for the current user, with organization and inviter joined. */
export type UserInvitationRow = QueryResultType<typeof queries.userInvitations>[number];
