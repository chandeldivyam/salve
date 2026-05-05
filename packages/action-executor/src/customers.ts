import {
  type ActionOutput,
  type CustomerActionID,
  customerActions,
} from '@opendesk/action-contracts';
import { schema as dbSchema } from '@opendesk/db';
import { and, asc, desc, eq, ilike, inArray, lt, or, type SQL, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Executor, ExecutorCtx, UntypedExecutor } from './ctx.js';
import { asUntypedExecutor } from './ctx.js';
import { notFound, validationError } from './errors.js';
import { actionResourceID } from './ids.js';

type CustomerRow = typeof dbSchema.customer.$inferSelect;
type CustomerResource = ActionOutput<typeof customerActions.get>['customer'];
type CustomerListResource = ActionOutput<typeof customerActions.list>['data'][number];
type CustomerNoteResource = ActionOutput<typeof customerActions.notesCreate>['note'];
type CustomerEventResource = ActionOutput<typeof customerActions.eventsIngest>['event'];

interface CustomerCursor {
  updatedAt: Date;
  id: string;
}

const cursorSchema = z.object({
  updatedAt: z.string().datetime(),
  id: z.string().min(1),
});

export const listCustomersExecutor: Executor<typeof customerActions.list> = async (ctx, input) => {
  const limit = input.limit ?? 50;
  const filters: SQL[] = [eq(dbSchema.customer.workspaceId, ctx.auth.workspaceID)];
  const search = input.search?.trim();
  if (search) {
    const pattern = `%${escapeLike(search)}%`;
    filters.push(
      or(
        ilike(dbSchema.customer.email, pattern),
        ilike(dbSchema.customer.name, pattern),
        ilike(dbSchema.customer.displayName, pattern),
      ) as SQL,
    );
  }

  const cursor = input.cursor ? decodeCursor(input.cursor) : null;
  if (cursor) {
    const cursorFilter = or(
      lt(dbSchema.customer.updatedAt, cursor.updatedAt),
      and(eq(dbSchema.customer.updatedAt, cursor.updatedAt), lt(dbSchema.customer.id, cursor.id)),
    );
    if (cursorFilter) filters.push(cursorFilter);
  }

  const rows = await ctx.db
    .select()
    .from(dbSchema.customer)
    .where(and(...filters))
    .orderBy(desc(dbSchema.customer.updatedAt), desc(dbSchema.customer.id))
    .limit(limit + 1);

  const pageRows = rows.slice(0, limit);
  const data = await hydrateCustomerList(ctx, pageRows);
  const last = pageRows.at(-1);
  return {
    data,
    nextCursor: rows.length > limit && last ? encodeCursor(last) : null,
    hasMore: rows.length > limit,
  };
};

export const getCustomerExecutor: Executor<typeof customerActions.get> = async (ctx, input) => ({
  customer: await readCustomerByID(ctx, input.customerId),
});

export const updateCustomerExecutor: Executor<typeof customerActions.update> = async (
  ctx,
  input,
) => {
  await ctx.runMutation('customer.update', {
    id: input.customerId,
    name: input.name,
    displayName: input.displayName,
    phone: input.phone,
    location: input.location,
    metadata: input.metadata,
  });
  return { customer: await readCustomerByID(ctx, input.customerId) };
};

export const createCustomerNoteExecutor: Executor<typeof customerActions.notesCreate> = async (
  ctx,
  input,
) => {
  const noteID = actionResourceID(ctx, customerActions.notesCreate.id, 'note');
  const existing = await findCustomerNoteByID(ctx, noteID);
  if (existing) return { note: mapCustomerNote(existing) };

  await ctx.runMutation('customerNote.create', {
    id: noteID,
    objectType: input.objectType,
    objectID: input.objectId ?? input.customerId,
    customerID: input.customerId,
    bodyHtml: input.bodyHtml,
    bodyText: input.bodyText,
    pinned: input.pinned,
  });
  return { note: await readCustomerNoteByID(ctx, noteID) };
};

export const updateCustomerNoteExecutor: Executor<typeof customerActions.notesUpdate> = async (
  ctx,
  input,
) => {
  await ctx.runMutation('customerNote.update', {
    id: input.noteId,
    bodyHtml: input.bodyHtml,
    bodyText: input.bodyText,
  });
  return { note: await readCustomerNoteByID(ctx, input.noteId) };
};

export const deleteCustomerNoteExecutor: Executor<typeof customerActions.notesDelete> = async (
  ctx,
  input,
) => {
  await ctx.runMutation('customerNote.delete', { id: input.noteId });
  return { note: await readCustomerNoteByID(ctx, input.noteId) };
};

export const addCustomerTagsExecutor: Executor<typeof customerActions.tagsAdd> = async (
  ctx,
  input,
) => {
  for (const tagID of unique(input.tagIds)) {
    await ctx.runMutation('tag.attachToCustomer', {
      customerID: input.customerId,
      tagID,
    });
  }
  return { customer: await readCustomerByID(ctx, input.customerId) };
};

export const removeCustomerTagExecutor: Executor<typeof customerActions.tagsRemove> = async (
  ctx,
  input,
) => {
  await ctx.runMutation('tag.detachFromCustomer', {
    customerID: input.customerId,
    tagID: input.tagId,
  });
  return { customer: await readCustomerByID(ctx, input.customerId) };
};

export const ingestCustomerEventExecutor: Executor<typeof customerActions.eventsIngest> = async (
  ctx,
  input,
) => {
  await assertCustomerExists(ctx, input.customerId);
  const idempotencyKey = input.idempotencyKey;
  if (idempotencyKey) {
    const existing = await findEventByIdempotencyKey(ctx, idempotencyKey);
    if (existing) return { event: mapCustomerEvent(existing), deduplicated: true };
  }

  const occurredAt = parseOccurredAt(input.occurredAt);
  const properties = asJsonRecord(input.properties);
  const eventID =
    input.id ?? actionResourceID(ctx, customerActions.eventsIngest.id, 'customer-event');

  try {
    const inserted = await ctx.db
      .insert(dbSchema.customEvent)
      .values({
        id: eventID,
        workspaceId: ctx.auth.workspaceID,
        customerId: input.customerId,
        eventName: input.eventName,
        properties,
        source: input.source ?? 'api',
        occurredAt,
        idempotencyKey,
      })
      .returning();

    await ctx.db
      .update(dbSchema.customer)
      .set({
        firstSeenAt: sql`LEAST(COALESCE(${dbSchema.customer.firstSeenAt}, ${occurredAt}), ${occurredAt})`,
        lastSeenAt: sql`GREATEST(COALESCE(${dbSchema.customer.lastSeenAt}, ${occurredAt}), ${occurredAt})`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(dbSchema.customer.id, input.customerId),
          eq(dbSchema.customer.workspaceId, ctx.auth.workspaceID),
        ),
      );

    const event = inserted[0];
    if (!event) {
      throw validationError('customer_event.insert_failed', 'Customer event could not be saved');
    }
    return { event: mapCustomerEvent(event), deduplicated: false };
  } catch (error) {
    if (idempotencyKey && isUniqueViolation(error)) {
      const existing = await findEventByIdempotencyKey(ctx, idempotencyKey);
      if (existing) return { event: mapCustomerEvent(existing), deduplicated: true };
    }
    throw error;
  }
};

export const customerExecutors: Record<CustomerActionID, UntypedExecutor> = {
  [customerActions.list.id]: asUntypedExecutor(listCustomersExecutor),
  [customerActions.get.id]: asUntypedExecutor(getCustomerExecutor),
  [customerActions.update.id]: asUntypedExecutor(updateCustomerExecutor),
  [customerActions.notesCreate.id]: asUntypedExecutor(createCustomerNoteExecutor),
  [customerActions.notesUpdate.id]: asUntypedExecutor(updateCustomerNoteExecutor),
  [customerActions.notesDelete.id]: asUntypedExecutor(deleteCustomerNoteExecutor),
  [customerActions.tagsAdd.id]: asUntypedExecutor(addCustomerTagsExecutor),
  [customerActions.tagsRemove.id]: asUntypedExecutor(removeCustomerTagExecutor),
  [customerActions.eventsIngest.id]: asUntypedExecutor(ingestCustomerEventExecutor),
};

export async function readCustomerByID(
  ctx: ExecutorCtx,
  customerID: string,
): Promise<CustomerResource> {
  const rows = await ctx.db
    .select()
    .from(dbSchema.customer)
    .where(
      and(
        eq(dbSchema.customer.id, customerID),
        eq(dbSchema.customer.workspaceId, ctx.auth.workspaceID),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) throw notFound('customer.not_found', 'Customer not found');
  const [tags, customFields, notes, events] = await Promise.all([
    readCustomerTags(ctx, customerID),
    readCustomerCustomFields(ctx, customerID),
    readCustomerNotes(ctx, customerID),
    readCustomerEvents(ctx, customerID),
  ]);
  return { ...mapCustomer(row), tags, customFields, notes, events };
}

async function hydrateCustomerList(
  ctx: ExecutorCtx,
  rows: readonly CustomerRow[],
): Promise<CustomerListResource[]> {
  const tagsByCustomer = await readCustomerTagsByCustomerID(
    ctx,
    rows.map((row) => row.id),
  );
  const customFieldsByCustomer = await readCustomerCustomFieldsByCustomerID(
    ctx,
    rows.map((row) => row.id),
  );
  return rows.map((row) => ({
    ...mapCustomer(row),
    tags: tagsByCustomer.get(row.id) ?? [],
    customFields: customFieldsByCustomer.get(row.id) ?? [],
  }));
}

function mapCustomer(
  row: CustomerRow,
): Omit<CustomerResource, 'tags' | 'customFields' | 'notes' | 'events'> {
  return {
    id: row.id,
    email: row.email,
    name: row.name ?? null,
    displayName: row.displayName ?? null,
    avatarUrl: row.avatarUrl ?? null,
    alternateEmails: Array.isArray(row.alternateEmails) ? row.alternateEmails : [],
    firstSeenAt: toNullableIso(row.firstSeenAt),
    lastSeenAt: toNullableIso(row.lastSeenAt),
    phone: row.phone ?? null,
    location: row.location ?? null,
    metadata: row.metadata ?? {},
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

async function assertCustomerExists(ctx: ExecutorCtx, customerID: string): Promise<void> {
  const rows = await ctx.db
    .select({ id: dbSchema.customer.id })
    .from(dbSchema.customer)
    .where(
      and(
        eq(dbSchema.customer.id, customerID),
        eq(dbSchema.customer.workspaceId, ctx.auth.workspaceID),
      ),
    )
    .limit(1);
  if (!rows[0]) throw notFound('customer.not_found', 'Customer not found');
}

async function readCustomerTags(ctx: ExecutorCtx, customerID: string) {
  const grouped = await readCustomerTagsByCustomerID(ctx, [customerID]);
  return grouped.get(customerID) ?? [];
}

async function readCustomerTagsByCustomerID(ctx: ExecutorCtx, customerIDs: readonly string[]) {
  const result = new Map<string, CustomerResource['tags']>();
  const uniqueIDs = unique(customerIDs);
  if (uniqueIDs.length === 0) return result;
  const rows = await ctx.db
    .select({
      customerId: dbSchema.customerTag.customerId,
      id: dbSchema.tag.id,
      label: dbSchema.tag.label,
      color: dbSchema.tag.color,
      groupId: dbSchema.tagGroup.id,
      groupLabel: dbSchema.tagGroup.label,
      groupColor: dbSchema.tagGroup.color,
      addedAt: dbSchema.customerTag.addedAt,
      addedById: dbSchema.customerTag.addedById,
    })
    .from(dbSchema.customerTag)
    .innerJoin(dbSchema.tag, eq(dbSchema.customerTag.tagId, dbSchema.tag.id))
    .leftJoin(dbSchema.tagGroup, eq(dbSchema.tag.groupId, dbSchema.tagGroup.id))
    .where(
      and(
        eq(dbSchema.customerTag.workspaceId, ctx.auth.workspaceID),
        inArray(dbSchema.customerTag.customerId, uniqueIDs),
      ),
    )
    .orderBy(desc(dbSchema.customerTag.addedAt), asc(dbSchema.tag.label), asc(dbSchema.tag.id));

  for (const row of rows) {
    const tags = result.get(row.customerId) ?? [];
    tags.push({
      id: row.id,
      label: row.label,
      color: row.color ?? null,
      group: row.groupId
        ? {
            id: row.groupId,
            label: row.groupLabel ?? '',
            color: row.groupColor ?? '#64748b',
          }
        : null,
      addedAt: toIso(row.addedAt),
      addedById: row.addedById ?? null,
    });
    result.set(row.customerId, tags);
  }
  return result;
}

async function readCustomerCustomFields(ctx: ExecutorCtx, customerID: string) {
  const grouped = await readCustomerCustomFieldsByCustomerID(ctx, [customerID]);
  return grouped.get(customerID) ?? [];
}

async function readCustomerCustomFieldsByCustomerID(
  ctx: ExecutorCtx,
  customerIDs: readonly string[],
) {
  const result = new Map<string, CustomerResource['customFields']>();
  const uniqueIDs = unique(customerIDs);
  if (uniqueIDs.length === 0) return result;
  const rows = await ctx.db
    .select({
      customerId: dbSchema.customFieldValue.customerId,
      id: dbSchema.customFieldValue.id,
      fieldId: dbSchema.customField.id,
      key: dbSchema.customField.key,
      displayName: dbSchema.customField.displayName,
      type: dbSchema.customField.type,
      value: dbSchema.customFieldValue.value,
      updatedById: dbSchema.customFieldValue.updatedById,
      createdAt: dbSchema.customFieldValue.createdAt,
      updatedAt: dbSchema.customFieldValue.updatedAt,
    })
    .from(dbSchema.customFieldValue)
    .innerJoin(dbSchema.customField, eq(dbSchema.customFieldValue.fieldId, dbSchema.customField.id))
    .where(
      and(
        eq(dbSchema.customFieldValue.workspaceId, ctx.auth.workspaceID),
        inArray(dbSchema.customFieldValue.customerId, uniqueIDs),
      ),
    )
    .orderBy(asc(dbSchema.customField.sortOrder), asc(dbSchema.customField.key));

  for (const row of rows) {
    if (!row.customerId) continue;
    const values = result.get(row.customerId) ?? [];
    values.push({
      id: row.id,
      fieldId: row.fieldId,
      key: row.key,
      displayName: row.displayName,
      type: row.type,
      value: row.value ?? null,
      updatedById: row.updatedById ?? null,
      createdAt: toIso(row.createdAt),
      updatedAt: toIso(row.updatedAt),
    });
    result.set(row.customerId, values);
  }
  return result;
}

async function readCustomerNotes(ctx: ExecutorCtx, customerID: string) {
  const rows = await ctx.db
    .select()
    .from(dbSchema.customerNote)
    .where(
      and(
        eq(dbSchema.customerNote.workspaceId, ctx.auth.workspaceID),
        eq(dbSchema.customerNote.customerId, customerID),
        sql`${dbSchema.customerNote.deletedAt} IS NULL`,
      ),
    )
    .orderBy(desc(dbSchema.customerNote.pinned), desc(dbSchema.customerNote.createdAt))
    .limit(100);
  return rows.map(mapCustomerNote);
}

async function readCustomerEvents(ctx: ExecutorCtx, customerID: string) {
  const rows = await ctx.db
    .select()
    .from(dbSchema.customEvent)
    .where(
      and(
        eq(dbSchema.customEvent.workspaceId, ctx.auth.workspaceID),
        eq(dbSchema.customEvent.customerId, customerID),
      ),
    )
    .orderBy(desc(dbSchema.customEvent.occurredAt), desc(dbSchema.customEvent.id))
    .limit(50);
  return rows.map(mapCustomerEvent);
}

async function findCustomerNoteByID(ctx: ExecutorCtx, noteID: string) {
  const rows = await ctx.db
    .select()
    .from(dbSchema.customerNote)
    .where(
      and(
        eq(dbSchema.customerNote.id, noteID),
        eq(dbSchema.customerNote.workspaceId, ctx.auth.workspaceID),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

async function readCustomerNoteByID(
  ctx: ExecutorCtx,
  noteID: string,
): Promise<CustomerNoteResource> {
  const note = await findCustomerNoteByID(ctx, noteID);
  if (!note) throw notFound('customer_note.not_found', 'Customer note not found');
  return mapCustomerNote(note);
}

function mapCustomerNote(row: typeof dbSchema.customerNote.$inferSelect): CustomerNoteResource {
  return {
    id: row.id,
    objectType: row.objectType,
    objectId: row.objectId,
    customerId: row.customerId,
    bodyHtml: row.bodyHtml,
    bodyText: row.bodyText,
    pinned: row.pinned,
    createdById: row.createdById,
    editedAt: toNullableIso(row.editedAt),
    deletedAt: toNullableIso(row.deletedAt),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

function mapCustomerEvent(row: typeof dbSchema.customEvent.$inferSelect): CustomerEventResource {
  return {
    id: row.id,
    customerId: row.customerId,
    eventName: row.eventName,
    properties: row.properties ?? {},
    source: row.source,
    occurredAt: toIso(row.occurredAt),
    ingestedAt: toIso(row.ingestedAt),
    idempotencyKey: row.idempotencyKey ?? null,
  };
}

async function findEventByIdempotencyKey(ctx: ExecutorCtx, idempotencyKey: string) {
  const rows = await ctx.db
    .select()
    .from(dbSchema.customEvent)
    .where(
      and(
        eq(dbSchema.customEvent.workspaceId, ctx.auth.workspaceID),
        eq(dbSchema.customEvent.idempotencyKey, idempotencyKey),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

function parseOccurredAt(value: string | number | undefined): Date {
  if (value === undefined) return new Date();
  const date = typeof value === 'number' ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw validationError('occurredAt.invalid', 'occurredAt must be a valid date', 'occurredAt');
  }
  return date;
}

function asJsonRecord(value: unknown): Record<string, unknown> {
  if (value === undefined) return {};
  if (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    return value as Record<string, unknown>;
  }
  throw validationError('properties.invalid', 'properties must be a JSON object', 'properties');
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  );
}

function encodeCursor(row: CustomerRow): string {
  return Buffer.from(JSON.stringify({ updatedAt: toIso(row.updatedAt), id: row.id })).toString(
    'base64url',
  );
}

function decodeCursor(cursor: string): CustomerCursor {
  try {
    const parsed = cursorSchema.parse(
      JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')),
    );
    return { updatedAt: new Date(parsed.updatedAt), id: parsed.id };
  } catch {
    throw validationError('cursor.invalid', 'Cursor is invalid', 'cursor');
  }
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function toIso(value: Date): string {
  return value.toISOString();
}

function toNullableIso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}
