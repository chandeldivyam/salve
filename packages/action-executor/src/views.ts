import { type ActionOutput, type ViewActionID, viewActions } from '@opendesk/action-contracts';
import { schema as dbSchema } from '@opendesk/db';
import { and, desc, eq, ilike, inArray, lt, or, type SQL, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Executor, ExecutorCtx, UntypedExecutor } from './ctx.js';
import { asUntypedExecutor } from './ctx.js';
import { notFound, validationError } from './errors.js';
import { actionResourceID } from './ids.js';

type ViewRow = typeof dbSchema.view.$inferSelect;
type TicketRow = typeof dbSchema.ticket.$inferSelect;
type ViewResource = ActionOutput<typeof viewActions.get>['view'];
type TicketSummaryResource = ActionOutput<typeof viewActions.tickets>['data'][number];

interface TicketCursor {
  updatedAt: Date;
  id: string;
}

const cursorSchema = z.object({
  updatedAt: z.string().datetime(),
  id: z.string().min(1),
});

export const listViewsExecutor: Executor<typeof viewActions.list> = async (ctx, input) => {
  const filters: SQL[] = [
    eq(dbSchema.view.workspaceId, ctx.auth.workspaceID),
    or(eq(dbSchema.view.scope, 'workspace'), eq(dbSchema.view.ownerId, ctx.auth.sub)) as SQL,
  ];
  if (!input.includeArchived) filters.push(sql`${dbSchema.view.archivedAt} IS NULL`);
  const rows = await ctx.db
    .select()
    .from(dbSchema.view)
    .where(and(...filters))
    .orderBy(desc(dbSchema.view.updatedAt), desc(dbSchema.view.id));

  const hiddenRows = await ctx.db
    .select({ viewId: dbSchema.viewMember.viewId })
    .from(dbSchema.viewMember)
    .where(
      and(
        eq(dbSchema.viewMember.workspaceId, ctx.auth.workspaceID),
        eq(dbSchema.viewMember.userId, ctx.auth.sub),
        sql`${dbSchema.viewMember.hiddenAt} IS NOT NULL`,
      ),
    );
  const hidden = new Set(hiddenRows.map((row) => row.viewId));
  return { data: rows.filter((row) => !hidden.has(row.id)).map(mapView) };
};

export const getViewExecutor: Executor<typeof viewActions.get> = async (ctx, input) => ({
  view: await readViewByID(ctx, input.viewId),
});

export const createViewExecutor: Executor<typeof viewActions.create> = async (ctx, input) => {
  const viewID = actionResourceID(ctx, viewActions.create.id, 'view');
  const existing = await findViewByID(ctx, viewID, { includeArchived: true });
  if (existing) return { view: mapView(existing) };

  await ctx.runMutation('view.create', {
    id: viewID,
    scope: input.scope,
    label: input.label,
    description: input.description,
    icon: input.icon,
    color: input.color,
    query: input.query,
    sort: input.sort,
    groupBy: input.groupBy,
    displayProps: input.displayProps,
  });
  return { view: await readViewByID(ctx, viewID) };
};

export const updateViewExecutor: Executor<typeof viewActions.update> = async (ctx, input) => {
  await ctx.runMutation('view.update', {
    id: input.viewId,
    label: input.label,
    description: input.description,
    icon: input.icon,
    color: input.color,
    query: input.query,
    sort: input.sort,
    groupBy: input.groupBy,
    displayProps: input.displayProps,
  });
  return { view: await readViewByID(ctx, input.viewId) };
};

export const deleteViewExecutor: Executor<typeof viewActions.delete> = async (ctx, input) => {
  await ctx.runMutation('view.archive', { id: input.viewId });
  const view = await findViewByID(ctx, input.viewId, { includeArchived: true });
  if (!view) throw notFound('view.not_found', 'View not found');
  return { view: mapView(view) };
};

export const viewTicketsExecutor: Executor<typeof viewActions.tickets> = async (ctx, input) => {
  const view = await readViewByID(ctx, input.viewId);
  const limit = input.limit ?? 50;
  const filters = filtersForView(ctx, view);

  const cursor = input.cursor ? decodeCursor(input.cursor) : null;
  if (cursor) {
    const cursorFilter = or(
      lt(dbSchema.ticket.updatedAt, cursor.updatedAt),
      and(eq(dbSchema.ticket.updatedAt, cursor.updatedAt), lt(dbSchema.ticket.id, cursor.id)),
    );
    if (cursorFilter) filters.push(cursorFilter);
  }

  const rows = await ctx.db
    .select()
    .from(dbSchema.ticket)
    .where(and(...filters))
    .orderBy(desc(dbSchema.ticket.updatedAt), desc(dbSchema.ticket.id))
    .limit(limit + 1);

  const pageRows = rows.slice(0, limit);
  const data = await hydrateTicketSummaries(ctx, pageRows);
  const last = pageRows.at(-1);
  return {
    view,
    data,
    nextCursor: rows.length > limit && last ? encodeCursor(last) : null,
    hasMore: rows.length > limit,
  };
};

export const viewExecutors: Record<ViewActionID, UntypedExecutor> = {
  [viewActions.list.id]: asUntypedExecutor(listViewsExecutor),
  [viewActions.get.id]: asUntypedExecutor(getViewExecutor),
  [viewActions.create.id]: asUntypedExecutor(createViewExecutor),
  [viewActions.update.id]: asUntypedExecutor(updateViewExecutor),
  [viewActions.delete.id]: asUntypedExecutor(deleteViewExecutor),
  [viewActions.tickets.id]: asUntypedExecutor(viewTicketsExecutor),
};

async function readViewByID(ctx: ExecutorCtx, viewID: string): Promise<ViewResource> {
  const row = await findViewByID(ctx, viewID, { includeArchived: false });
  if (!row) throw notFound('view.not_found', 'View not found');
  return mapView(row);
}

async function findViewByID(
  ctx: ExecutorCtx,
  viewID: string,
  opts: { includeArchived: boolean },
): Promise<ViewRow | null> {
  const filters: SQL[] = [
    eq(dbSchema.view.id, viewID),
    eq(dbSchema.view.workspaceId, ctx.auth.workspaceID),
    or(eq(dbSchema.view.scope, 'workspace'), eq(dbSchema.view.ownerId, ctx.auth.sub)) as SQL,
  ];
  if (!opts.includeArchived) filters.push(sql`${dbSchema.view.archivedAt} IS NULL`);
  const rows = await ctx.db
    .select()
    .from(dbSchema.view)
    .where(and(...filters))
    .limit(1);
  return rows[0] ?? null;
}

function mapView(row: ViewRow): ViewResource {
  return {
    id: row.id,
    kind: row.kind,
    scope: row.scope,
    ownerId: row.ownerId ?? null,
    label: row.label,
    description: row.description ?? null,
    icon: row.icon ?? null,
    color: row.color ?? null,
    query: row.query,
    sort: row.sort,
    groupBy: row.groupBy ?? null,
    displayProps: row.displayProps ?? null,
    archivedAt: toNullableIso(row.archivedAt),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

function filtersForView(ctx: ExecutorCtx, view: ViewResource): SQL[] {
  const filters: SQL[] = [eq(dbSchema.ticket.workspaceId, ctx.auth.workspaceID)];
  const query = view.query;
  if (!isObject(query)) return filters;
  const search = typeof query.search === 'string' ? query.search.trim() : '';
  if (search) {
    const pattern = `%${escapeLike(search)}%`;
    filters.push(
      or(ilike(dbSchema.ticket.title, pattern), ilike(dbSchema.ticket.description, pattern)) as SQL,
    );
  }
  const viewFilters = Array.isArray(query.filters) ? query.filters : [];
  for (const filter of viewFilters) {
    const sqlFilter = sqlForFilter(filter);
    if (sqlFilter) filters.push(sqlFilter);
  }
  return filters;
}

function sqlForFilter(filter: unknown): SQL | null {
  if (
    !isObject(filter) ||
    typeof filter.field !== 'string' ||
    typeof filter.operator !== 'string'
  ) {
    return null;
  }
  const column = ticketColumnFor(filter.field);
  if (!column) return null;
  if (filter.operator === 'eq' && isPrimitive(filter.value))
    return sql`${column} = ${filter.value}`;
  if (filter.operator === 'neq' && isPrimitive(filter.value))
    return sql`${column} <> ${filter.value}`;
  if (filter.operator === 'in' && Array.isArray(filter.values)) {
    const values = filter.values.filter((v): v is string => typeof v === 'string');
    return values.length > 0 ? inArray(column, values) : null;
  }
  if (filter.operator === 'empty') return sql`${column} IS NULL`;
  if (filter.operator === 'nempty') return sql`${column} IS NOT NULL`;
  return null;
}

function ticketColumnFor(field: string) {
  switch (field) {
    case 'status':
      return dbSchema.ticket.status;
    case 'priority':
      return dbSchema.ticket.priority;
    case 'assignee':
      return dbSchema.ticket.assigneeId;
    case 'customer':
      return dbSchema.ticket.customerId;
    case 'createdAt':
      return dbSchema.ticket.createdAt;
    case 'updatedAt':
      return dbSchema.ticket.updatedAt;
    case 'firstResponseAt':
      return dbSchema.ticket.firstResponseAt;
    case 'resolvedAt':
      return dbSchema.ticket.resolvedAt;
    default:
      return null;
  }
}

async function hydrateTicketSummaries(
  ctx: ExecutorCtx,
  rows: readonly TicketRow[],
): Promise<TicketSummaryResource[]> {
  const customerByID = await readCustomersByID(
    ctx,
    rows.flatMap((row) => (row.customerId ? [row.customerId] : [])),
  );
  return rows.map((row) => ({
    id: row.id,
    shortId: row.shortId,
    title: row.title,
    description: row.description ?? null,
    status: row.status,
    priority: row.priority,
    customerId: row.customerId ?? null,
    assigneeId: row.assigneeId ?? null,
    createdById: row.createdById ?? null,
    resolvedById: row.resolvedById ?? null,
    closedById: row.closedById ?? null,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    firstResponseAt: toNullableIso(row.firstResponseAt),
    resolvedAt: toNullableIso(row.resolvedAt),
    closedAt: toNullableIso(row.closedAt),
    customer: row.customerId ? (customerByID.get(row.customerId) ?? null) : null,
  }));
}

async function readCustomersByID(ctx: ExecutorCtx, customerIDs: readonly string[]) {
  const result = new Map<string, NonNullable<TicketSummaryResource['customer']>>();
  const uniqueIDs = [...new Set(customerIDs)];
  if (uniqueIDs.length === 0) return result;
  const rows = await ctx.db
    .select({
      id: dbSchema.customer.id,
      email: dbSchema.customer.email,
      name: dbSchema.customer.name,
      displayName: dbSchema.customer.displayName,
      avatarUrl: dbSchema.customer.avatarUrl,
    })
    .from(dbSchema.customer)
    .where(
      and(
        inArray(dbSchema.customer.id, uniqueIDs),
        eq(dbSchema.customer.workspaceId, ctx.auth.workspaceID),
      ),
    );
  for (const row of rows) {
    result.set(row.id, {
      id: row.id,
      email: row.email,
      name: row.name ?? null,
      displayName: row.displayName ?? null,
      avatarUrl: row.avatarUrl ?? null,
    });
  }
  return result;
}

function encodeCursor(row: TicketRow): string {
  return Buffer.from(JSON.stringify({ updatedAt: toIso(row.updatedAt), id: row.id })).toString(
    'base64url',
  );
}

function decodeCursor(cursor: string): TicketCursor {
  try {
    const parsed = cursorSchema.parse(
      JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')),
    );
    return { updatedAt: new Date(parsed.updatedAt), id: parsed.id };
  } catch {
    throw validationError('cursor.invalid', 'Cursor is invalid', 'cursor');
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function isPrimitive(value: unknown): value is string | number | boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

function toIso(value: Date): string {
  return value.toISOString();
}

function toNullableIso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}
