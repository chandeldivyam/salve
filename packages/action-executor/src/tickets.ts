import {
  type ActionInput,
  type ActionOutput,
  type TicketActionID,
  ticketActions,
} from '@opendesk/action-contracts';
import { schema as dbSchema } from '@opendesk/db';
import { and, asc, desc, eq, inArray, lt, or, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { Executor, ExecutorCtx, UntypedExecutor } from './ctx.js';
import { asUntypedExecutor } from './ctx.js';
import { notFound, validationError } from './errors.js';
import { actionResourceID } from './ids.js';

type TicketRow = typeof dbSchema.ticket.$inferSelect;
type MessageRow = typeof dbSchema.message.$inferSelect;
type TicketResource = ActionOutput<typeof ticketActions.get>['ticket'];
type TicketMessageResource = ActionOutput<typeof ticketActions.reply>['message'];
type TicketListOutput = ActionOutput<typeof ticketActions.list>;
type TicketListInput = ActionInput<typeof ticketActions.list>;
type TicketSummaryResource = TicketListOutput['data'][number];

interface TicketCursor {
  updatedAt: Date;
  id: string;
}

const cursorSchema = z.object({
  updatedAt: z.string().datetime(),
  id: z.string().min(1),
});

export const listTicketsExecutor: Executor<typeof ticketActions.list> = async (ctx, input) => {
  const limit = input.limit ?? 50;
  const filters: SQL[] = [eq(dbSchema.ticket.workspaceId, ctx.auth.workspaceID)];

  if (input.status) filters.push(eq(dbSchema.ticket.status, input.status));
  if (input.assigneeId) filters.push(eq(dbSchema.ticket.assigneeId, input.assigneeId));
  if (input.customerId) filters.push(eq(dbSchema.ticket.customerId, input.customerId));

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

  const hasMore = rows.length > limit;
  const pageRows = rows.slice(0, limit);
  const data = await hydrateTicketSummaries(ctx, pageRows);
  const last = pageRows.at(-1);

  return {
    data,
    nextCursor: hasMore && last ? encodeCursor(last) : null,
    hasMore,
  } satisfies TicketListOutput;
};

export const getTicketExecutor: Executor<typeof ticketActions.get> = async (ctx, input) => ({
  ticket: await readTicketByID(ctx, input.ticketId),
});

export const createTicketExecutor: Executor<typeof ticketActions.create> = async (ctx, input) => {
  const ticketID = actionResourceID(ctx, ticketActions.create.id, 'ticket');
  const existing = await findTicketByID(ctx, ticketID);
  if (existing) return { ticket: await hydrateTicket(ctx, existing, { includeMessages: true }) };

  await ctx.runMutation('ticket.create', {
    id: ticketID,
    title: input.title,
    description: input.description,
    customerEmail: input.customerEmail,
    customerName: input.customerName,
    priority: input.priority,
  });

  return { ticket: await readTicketByID(ctx, ticketID) };
};

export const updateTicketExecutor: Executor<typeof ticketActions.update> = async (ctx, input) => {
  await ctx.runMutation('ticket.update', {
    id: input.ticketId,
    title: input.title,
    description: input.description,
    priority: input.priority,
  });
  return { ticket: await readTicketByID(ctx, input.ticketId) };
};

export const assignTicketExecutor: Executor<typeof ticketActions.assign> = async (ctx, input) => {
  await ctx.runMutation('ticket.assign', {
    id: input.ticketId,
    assigneeID: input.assigneeId,
  });
  return { ticket: await readTicketByID(ctx, input.ticketId) };
};

export const snoozeTicketExecutor: Executor<typeof ticketActions.snooze> = async (ctx, input) => {
  await ctx.runMutation('ticket.snooze', {
    id: input.ticketId,
    until: Date.parse(input.until),
  });
  return { ticket: await readTicketByID(ctx, input.ticketId) };
};

export const markTicketInProgressExecutor: Executor<typeof ticketActions.markInProgress> = async (
  ctx,
  input,
) => {
  await ctx.runMutation('ticket.markInProgress', { id: input.ticketId });
  return { ticket: await readTicketByID(ctx, input.ticketId) };
};

export const resolveTicketExecutor: Executor<typeof ticketActions.resolve> = async (ctx, input) => {
  await ctx.runMutation('ticket.resolve', { id: input.ticketId });
  return { ticket: await readTicketByID(ctx, input.ticketId) };
};

export const closeTicketExecutor: Executor<typeof ticketActions.close> = async (ctx, input) => {
  await ctx.runMutation('ticket.close', { id: input.ticketId });
  return { ticket: await readTicketByID(ctx, input.ticketId) };
};

export const reopenTicketExecutor: Executor<typeof ticketActions.reopen> = async (ctx, input) => {
  await ctx.runMutation('ticket.reopen', { id: input.ticketId });
  return { ticket: await readTicketByID(ctx, input.ticketId) };
};

export const replyExecutor: Executor<typeof ticketActions.reply> = async (ctx, input) =>
  createTicketMessage(ctx, input, {
    actionID: ticketActions.reply.id,
    isInternal: false,
  });

export const noteExecutor: Executor<typeof ticketActions.note> = async (ctx, input) =>
  createTicketMessage(ctx, input, {
    actionID: ticketActions.note.id,
    isInternal: true,
  });

export const updateMessageExecutor: Executor<typeof ticketActions.messageUpdate> = async (
  ctx,
  input,
) => {
  await ctx.runMutation('message.update', {
    id: input.messageId,
    ticketID: input.ticketId,
    bodyHTML: input.bodyHtml,
    bodyText: input.bodyText,
  });
  return { message: await readMessageByID(ctx, input.ticketId, input.messageId) };
};

export const deleteMessageExecutor: Executor<typeof ticketActions.messageDelete> = async (
  ctx,
  input,
) => {
  await ctx.runMutation('message.delete', {
    id: input.messageId,
    ticketID: input.ticketId,
  });
  return { message: await readMessageByID(ctx, input.ticketId, input.messageId) };
};

export const addTicketTagsExecutor: Executor<typeof ticketActions.tagsAdd> = async (ctx, input) => {
  for (const tagID of unique(input.tagIds)) {
    await ctx.runMutation('tag.attachToTicket', {
      ticketID: input.ticketId,
      tagID,
    });
  }
  return { ticket: await readTicketByID(ctx, input.ticketId) };
};

export const replaceTicketTagsExecutor: Executor<typeof ticketActions.tagsReplace> = async (
  ctx,
  input,
) => {
  await ctx.runMutation('tag.replaceOnTicket', {
    ticketID: input.ticketId,
    tagIDs: unique(input.tagIds),
  });
  return { ticket: await readTicketByID(ctx, input.ticketId) };
};

export const removeTicketTagExecutor: Executor<typeof ticketActions.tagsRemove> = async (
  ctx,
  input,
) => {
  await ctx.runMutation('tag.detachFromTicket', {
    ticketID: input.ticketId,
    tagID: input.tagId,
  });
  return { ticket: await readTicketByID(ctx, input.ticketId) };
};

export const setTicketCustomFieldExecutor: Executor<typeof ticketActions.customFieldSet> = async (
  ctx,
  input,
) => {
  const field = await findTicketCustomFieldByKey(ctx, input.fieldKey);
  if (input.value === null) {
    await ctx.runMutation('customField.clearValueOnTicket', {
      fieldID: field.id,
      ticketID: input.ticketId,
    });
  } else {
    await ctx.runMutation('customField.setValueOnTicket', {
      id: actionResourceID(ctx, ticketActions.customFieldSet.id, `${input.ticketId}:${field.id}`),
      fieldID: field.id,
      ticketID: input.ticketId,
      value: input.value,
    });
  }
  return { ticket: await readTicketByID(ctx, input.ticketId) };
};

export const ticketExecutors: Record<TicketActionID, UntypedExecutor> = {
  [ticketActions.list.id]: asUntypedExecutor(listTicketsExecutor),
  [ticketActions.get.id]: asUntypedExecutor(getTicketExecutor),
  [ticketActions.create.id]: asUntypedExecutor(createTicketExecutor),
  [ticketActions.update.id]: asUntypedExecutor(updateTicketExecutor),
  [ticketActions.assign.id]: asUntypedExecutor(assignTicketExecutor),
  [ticketActions.snooze.id]: asUntypedExecutor(snoozeTicketExecutor),
  [ticketActions.markInProgress.id]: asUntypedExecutor(markTicketInProgressExecutor),
  [ticketActions.resolve.id]: asUntypedExecutor(resolveTicketExecutor),
  [ticketActions.close.id]: asUntypedExecutor(closeTicketExecutor),
  [ticketActions.reopen.id]: asUntypedExecutor(reopenTicketExecutor),
  [ticketActions.reply.id]: asUntypedExecutor(replyExecutor),
  [ticketActions.note.id]: asUntypedExecutor(noteExecutor),
  [ticketActions.messageUpdate.id]: asUntypedExecutor(updateMessageExecutor),
  [ticketActions.messageDelete.id]: asUntypedExecutor(deleteMessageExecutor),
  [ticketActions.tagsAdd.id]: asUntypedExecutor(addTicketTagsExecutor),
  [ticketActions.tagsReplace.id]: asUntypedExecutor(replaceTicketTagsExecutor),
  [ticketActions.tagsRemove.id]: asUntypedExecutor(removeTicketTagExecutor),
  [ticketActions.customFieldSet.id]: asUntypedExecutor(setTicketCustomFieldExecutor),
};

export async function readTicketByID(ctx: ExecutorCtx, ticketID: string): Promise<TicketResource> {
  const row = await findTicketByID(ctx, ticketID);
  if (!row) throw notFound('ticket.not_found', 'Ticket not found');
  return hydrateTicket(ctx, row, { includeMessages: true });
}

async function findTicketByID(ctx: ExecutorCtx, ticketID: string): Promise<TicketRow | null> {
  const rows = await ctx.db
    .select()
    .from(dbSchema.ticket)
    .where(
      and(eq(dbSchema.ticket.id, ticketID), eq(dbSchema.ticket.workspaceId, ctx.auth.workspaceID)),
    )
    .limit(1);
  return rows[0] ?? null;
}

async function hydrateTicket(
  ctx: ExecutorCtx,
  row: TicketRow,
  opts: { includeMessages: boolean },
): Promise<TicketResource> {
  const [customer, tags, customFields, messages] = await Promise.all([
    readTicketCustomer(ctx, row.customerId),
    readTicketTags(ctx, row.id),
    readTicketCustomFields(ctx, row.id),
    opts.includeMessages ? readTicketMessages(ctx, row.id) : Promise.resolve([]),
  ]);

  return {
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
    customer,
    tags,
    customFields,
    ...(opts.includeMessages ? { messages } : {}),
  } as TicketResource;
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

async function readTicketCustomer(ctx: ExecutorCtx, customerID: string | null) {
  if (!customerID) return null;
  return (await readCustomersByID(ctx, [customerID])).get(customerID) ?? null;
}

async function readCustomersByID(ctx: ExecutorCtx, customerIDs: readonly string[]) {
  const result = new Map<string, NonNullable<TicketSummaryResource['customer']>>();
  const uniqueCustomerIDs = unique(customerIDs);
  if (uniqueCustomerIDs.length === 0) return result;

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
        inArray(dbSchema.customer.id, uniqueCustomerIDs),
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

async function readTicketTags(ctx: ExecutorCtx, ticketID: string) {
  const rows = await ctx.db
    .select({
      id: dbSchema.tag.id,
      label: dbSchema.tag.label,
      color: dbSchema.tag.color,
      groupId: dbSchema.tagGroup.id,
      groupLabel: dbSchema.tagGroup.label,
      groupColor: dbSchema.tagGroup.color,
      addedAt: dbSchema.ticketTag.addedAt,
      addedById: dbSchema.ticketTag.addedById,
    })
    .from(dbSchema.ticketTag)
    .innerJoin(dbSchema.tag, eq(dbSchema.ticketTag.tagId, dbSchema.tag.id))
    .leftJoin(dbSchema.tagGroup, eq(dbSchema.tag.groupId, dbSchema.tagGroup.id))
    .where(
      and(
        eq(dbSchema.ticketTag.ticketId, ticketID),
        eq(dbSchema.ticketTag.workspaceId, ctx.auth.workspaceID),
      ),
    )
    .orderBy(desc(dbSchema.ticketTag.addedAt), asc(dbSchema.tag.label), asc(dbSchema.tag.id));

  return rows.map((row) => ({
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
  }));
}

async function readTicketCustomFields(ctx: ExecutorCtx, ticketID: string) {
  const rows = await ctx.db
    .select({
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
        eq(dbSchema.customFieldValue.ticketId, ticketID),
        eq(dbSchema.customFieldValue.workspaceId, ctx.auth.workspaceID),
      ),
    )
    .orderBy(asc(dbSchema.customField.sortOrder), asc(dbSchema.customField.key));

  return rows.map((row) => ({
    id: row.id,
    fieldId: row.fieldId,
    key: row.key,
    displayName: row.displayName,
    type: row.type,
    value: row.value ?? null,
    updatedById: row.updatedById ?? null,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  }));
}

async function readTicketMessages(
  ctx: ExecutorCtx,
  ticketID: string,
): Promise<TicketMessageResource[]> {
  const rows = await ctx.db
    .select()
    .from(dbSchema.message)
    .where(
      and(
        eq(dbSchema.message.ticketId, ticketID),
        eq(dbSchema.message.workspaceId, ctx.auth.workspaceID),
      ),
    )
    .orderBy(asc(dbSchema.message.createdAt), asc(dbSchema.message.id));

  return mapMessages(ctx, rows);
}

async function readMessageByID(
  ctx: ExecutorCtx,
  ticketID: string,
  messageID: string,
): Promise<TicketMessageResource> {
  const rows = await ctx.db
    .select()
    .from(dbSchema.message)
    .where(
      and(
        eq(dbSchema.message.id, messageID),
        eq(dbSchema.message.ticketId, ticketID),
        eq(dbSchema.message.workspaceId, ctx.auth.workspaceID),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) throw notFound('message.not_found', 'Message not found');
  const [message] = await mapMessages(ctx, [row]);
  if (!message) throw notFound('message.not_found', 'Message not found');
  return message;
}

async function findMessageByID(
  ctx: ExecutorCtx,
  ticketID: string,
  messageID: string,
): Promise<MessageRow | null> {
  const rows = await ctx.db
    .select()
    .from(dbSchema.message)
    .where(
      and(
        eq(dbSchema.message.id, messageID),
        eq(dbSchema.message.ticketId, ticketID),
        eq(dbSchema.message.workspaceId, ctx.auth.workspaceID),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

async function mapMessages(
  ctx: ExecutorCtx,
  rows: readonly MessageRow[],
): Promise<TicketMessageResource[]> {
  const attachmentsByMessage = await readAttachmentsByMessageID(
    ctx,
    rows.map((row) => row.id),
  );
  return rows.map((row) => ({
    id: row.id,
    ticketId: row.ticketId,
    authorType: row.authorType,
    authorUserId: row.authorUserId ?? null,
    authorCustomerId: row.authorCustomerId ?? null,
    bodyHtml: row.bodyHtml,
    bodyText: row.bodyText,
    isInternal: row.isInternal,
    editedAt: toNullableIso(row.editedAt),
    deletedAt: toNullableIso(row.deletedAt),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    attachments: attachmentsByMessage.get(row.id) ?? [],
  }));
}

async function readAttachmentsByMessageID(ctx: ExecutorCtx, messageIDs: readonly string[]) {
  const result = new Map<string, TicketMessageResource['attachments']>();
  if (messageIDs.length === 0) return result;

  const rows = await ctx.db
    .select({
      id: dbSchema.attachment.id,
      messageId: dbSchema.attachment.messageId,
      s3Key: dbSchema.attachment.s3Key,
      filename: dbSchema.attachment.filename,
      mimeType: dbSchema.attachment.mimeType,
      sizeBytes: dbSchema.attachment.sizeBytes,
      createdAt: dbSchema.attachment.createdAt,
    })
    .from(dbSchema.attachment)
    .where(
      and(
        eq(dbSchema.attachment.workspaceId, ctx.auth.workspaceID),
        inArray(dbSchema.attachment.messageId, [...messageIDs]),
      ),
    )
    .orderBy(asc(dbSchema.attachment.createdAt), asc(dbSchema.attachment.id));

  for (const row of rows) {
    const attachments = result.get(row.messageId) ?? [];
    attachments.push({
      id: row.id,
      s3Key: row.s3Key,
      filename: row.filename,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
      createdAt: toIso(row.createdAt),
    });
    result.set(row.messageId, attachments);
  }

  return result;
}

async function createTicketMessage(
  ctx: ExecutorCtx,
  input: ActionInput<typeof ticketActions.reply>,
  opts: { actionID: string; isInternal: boolean },
): Promise<ActionOutput<typeof ticketActions.reply>> {
  const messageID = actionResourceID(ctx, opts.actionID, 'message');
  const existing = await findMessageByID(ctx, input.ticketId, messageID);
  if (existing) return { message: await readMessageByID(ctx, input.ticketId, messageID) };

  await ctx.runMutation('message.send', {
    id: messageID,
    ticketID: input.ticketId,
    emailAddressID: input.emailAddressId ?? undefined,
    bodyHTML: input.bodyHtml,
    bodyText: input.bodyText,
    isInternal: opts.isInternal,
    attachments: input.attachments?.map((attachment, index) => ({
      id:
        attachment.id ??
        actionResourceID(ctx, opts.actionID, `attachment:${index}:${attachment.s3Key}`),
      s3Key: attachment.s3Key,
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
    })),
  });

  return { message: await readMessageByID(ctx, input.ticketId, messageID) };
}

async function findTicketCustomFieldByKey(ctx: ExecutorCtx, key: string) {
  const rows = await ctx.db
    .select({ id: dbSchema.customField.id })
    .from(dbSchema.customField)
    .where(
      and(
        eq(dbSchema.customField.workspaceId, ctx.auth.workspaceID),
        eq(dbSchema.customField.category, 'ticket'),
        eq(dbSchema.customField.key, key),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) throw notFound('custom_field.not_found', 'Custom field not found');
  return row;
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

function encodeCursor(row: TicketRow): string {
  return Buffer.from(JSON.stringify({ updatedAt: toIso(row.updatedAt), id: row.id })).toString(
    'base64url',
  );
}

function toIso(value: Date): string {
  return value.toISOString();
}

function toNullableIso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

export function parseTicketListQuery(query: Record<string, string | undefined>): TicketListInput {
  return {
    limit: query.limit ? Number.parseInt(query.limit, 10) : undefined,
    cursor: query.cursor,
    status: query.status as TicketListInput['status'],
    assigneeId: query.assigneeId,
    customerId: query.customerId,
  };
}
