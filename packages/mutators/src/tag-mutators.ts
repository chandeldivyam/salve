import { builder } from '@opendesk/zero-schema';
import { defineMutator, type ReadonlyJSONValue, type Transaction } from '@rocicorp/zero';
import { z } from 'zod';
import {
  assertCanModifyCustomer,
  assertCanModifyTicket,
  assertHasWorkspace,
  type WorkspaceAuthData,
} from './auth.js';
import { MutationError, MutationErrorCode } from './error.js';

const idArg = z.string().min(1);
const hexColorArg = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const labelArg = z.string().trim().min(1).max(80);
const optionalColorArg = z.union([hexColorArg, z.null()]).optional();

export const createTagGroupArgsSchema = z.object({
  id: idArg,
  label: labelArg,
  color: hexColorArg,
  sortOrder: z.number().int().optional(),
});
export type CreateTagGroupArgs = z.infer<typeof createTagGroupArgsSchema>;

export const updateTagGroupArgsSchema = z.object({
  id: idArg,
  label: labelArg.optional(),
  color: hexColorArg.optional(),
  sortOrder: z.number().int().optional(),
});
export type UpdateTagGroupArgs = z.infer<typeof updateTagGroupArgsSchema>;

export const createTagArgsSchema = z.object({
  id: idArg,
  groupID: z.union([idArg, z.null()]).optional(),
  label: labelArg,
  color: optionalColorArg,
  sortOrder: z.number().int().optional(),
});
export type CreateTagArgs = z.infer<typeof createTagArgsSchema>;

export const updateTagArgsSchema = z.object({
  id: idArg,
  groupID: z.union([idArg, z.null()]).optional(),
  label: labelArg.optional(),
  color: optionalColorArg,
  sortOrder: z.number().int().optional(),
});
export type UpdateTagArgs = z.infer<typeof updateTagArgsSchema>;

export const tagIDOnlyArgsSchema = z.object({ id: idArg });

export const ticketTagArgsSchema = z.object({
  ticketID: idArg,
  tagID: idArg,
});
export type TicketTagArgs = z.infer<typeof ticketTagArgsSchema>;

export const customerTagArgsSchema = z.object({
  customerID: idArg,
  tagID: idArg,
});
export type CustomerTagArgs = z.infer<typeof customerTagArgsSchema>;

export const replaceTicketTagsArgsSchema = z.object({
  ticketID: idArg,
  tagIDs: z.array(idArg).max(100),
});
export type ReplaceTicketTagsArgs = z.infer<typeof replaceTicketTagsArgsSchema>;

function now(): number {
  return Date.now();
}

function newID(): string {
  return crypto.randomUUID();
}

async function emitAudit(
  tx: Transaction,
  authData: WorkspaceAuthData,
  args: {
    ticketID?: string;
    customerID?: string;
    kind: string;
    payload?: ReadonlyJSONValue;
  },
  ts: number,
) {
  await tx.mutate.auditEvent.insert({
    id: newID(),
    workspaceID: authData.workspaceID,
    ticketID: args.ticketID,
    customerID: args.customerID,
    actorID: authData.sub,
    kind: args.kind,
    payload: args.payload,
    createdAt: ts,
  });
}

async function assertTagGroupInWorkspace(
  tx: Transaction,
  authData: WorkspaceAuthData,
  groupID: string,
) {
  const group = await tx.run(builder.tagGroup.where('id', groupID).one());
  if (!group) {
    throw new MutationError('tag group not found', MutationErrorCode.NOT_FOUND, groupID);
  }
  if (group.workspaceID !== authData.workspaceID) {
    throw new MutationError('tag group not found', MutationErrorCode.CROSS_WORKSPACE, groupID);
  }
  return group;
}

async function assertTagInWorkspace(tx: Transaction, authData: WorkspaceAuthData, tagID: string) {
  const tag = await tx.run(builder.tag.where('id', tagID).one());
  if (!tag) {
    throw new MutationError('tag not found', MutationErrorCode.NOT_FOUND, tagID);
  }
  if (tag.workspaceID !== authData.workspaceID) {
    throw new MutationError('tag not found', MutationErrorCode.CROSS_WORKSPACE, tagID);
  }
  return tag;
}

async function assertAllTagsInWorkspace(
  tx: Transaction,
  authData: WorkspaceAuthData,
  tagIDs: string[],
) {
  const uniqueTagIDs = [...new Set(tagIDs)];
  const tags = [];
  for (const tagID of uniqueTagIDs) {
    tags.push(await assertTagInWorkspace(tx, authData, tagID));
  }
  return tags;
}

export const tagGroupMutators = {
  create: defineMutator(createTagGroupArgsSchema, async ({ tx, args, ctx: authData }) => {
    assertHasWorkspace(authData);
    const ts = now();
    await tx.mutate.tagGroup.insert({
      id: args.id,
      workspaceID: authData.workspaceID,
      label: args.label,
      color: args.color,
      sortOrder: args.sortOrder ?? 0,
      archivedAt: undefined,
      createdAt: ts,
      updatedAt: ts,
    });
  }),

  update: defineMutator(updateTagGroupArgsSchema, async ({ tx, args, ctx: authData }) => {
    assertHasWorkspace(authData);
    await assertTagGroupInWorkspace(tx, authData, args.id);
    const change: Record<string, unknown> = { id: args.id, updatedAt: now() };
    if (args.label !== undefined) change.label = args.label;
    if (args.color !== undefined) change.color = args.color;
    if (args.sortOrder !== undefined) change.sortOrder = args.sortOrder;
    await tx.mutate.tagGroup.update(change as { id: string });
  }),

  archive: defineMutator(tagIDOnlyArgsSchema, async ({ tx, args, ctx: authData }) => {
    assertHasWorkspace(authData);
    await assertTagGroupInWorkspace(tx, authData, args.id);
    const ts = now();
    await tx.mutate.tagGroup.update({ id: args.id, archivedAt: ts, updatedAt: ts });
  }),

  restore: defineMutator(tagIDOnlyArgsSchema, async ({ tx, args, ctx: authData }) => {
    assertHasWorkspace(authData);
    await assertTagGroupInWorkspace(tx, authData, args.id);
    await tx.mutate.tagGroup.update({ id: args.id, archivedAt: null, updatedAt: now() });
  }),
};

export const tagMutators = {
  create: defineMutator(createTagArgsSchema, async ({ tx, args, ctx: authData }) => {
    assertHasWorkspace(authData);
    if (args.groupID) {
      await assertTagGroupInWorkspace(tx, authData, args.groupID);
    }
    const ts = now();
    await tx.mutate.tag.insert({
      id: args.id,
      workspaceID: authData.workspaceID,
      groupID: args.groupID ?? undefined,
      label: args.label,
      color: args.color ?? undefined,
      sortOrder: args.sortOrder ?? 0,
      archivedAt: null,
      createdAt: ts,
      updatedAt: ts,
    });
  }),

  update: defineMutator(updateTagArgsSchema, async ({ tx, args, ctx: authData }) => {
    assertHasWorkspace(authData);
    await assertTagInWorkspace(tx, authData, args.id);
    if (args.groupID) {
      await assertTagGroupInWorkspace(tx, authData, args.groupID);
    }
    const change: Record<string, unknown> = { id: args.id, updatedAt: now() };
    if (args.groupID !== undefined) change.groupID = args.groupID;
    if (args.label !== undefined) change.label = args.label;
    if (args.color !== undefined) change.color = args.color;
    if (args.sortOrder !== undefined) change.sortOrder = args.sortOrder;
    await tx.mutate.tag.update(change as { id: string });
  }),

  archive: defineMutator(tagIDOnlyArgsSchema, async ({ tx, args, ctx: authData }) => {
    assertHasWorkspace(authData);
    await assertTagInWorkspace(tx, authData, args.id);
    const ts = now();
    await tx.mutate.tag.update({ id: args.id, archivedAt: ts, updatedAt: ts });
  }),

  restore: defineMutator(tagIDOnlyArgsSchema, async ({ tx, args, ctx: authData }) => {
    assertHasWorkspace(authData);
    await assertTagInWorkspace(tx, authData, args.id);
    await tx.mutate.tag.update({ id: args.id, archivedAt: null, updatedAt: now() });
  }),

  attachToTicket: defineMutator(ticketTagArgsSchema, async ({ tx, args, ctx: authData }) => {
    const ticket = await assertCanModifyTicket(tx, authData, args.ticketID);
    const auth = authData as WorkspaceAuthData;
    const tag = await assertTagInWorkspace(tx, auth, args.tagID);
    const existing = await tx.run(
      builder.ticketTag.where('ticketID', args.ticketID).where('tagID', args.tagID).one(),
    );
    if (existing) return;

    const ts = now();
    await tx.mutate.ticketTag.insert({
      ticketID: args.ticketID,
      tagID: args.tagID,
      workspaceID: ticket.workspaceID,
      addedAt: ts,
      addedByID: auth.sub,
    });
    await emitAudit(
      tx,
      auth,
      {
        ticketID: args.ticketID,
        kind: 'ticket.tag_added',
        payload: { tagID: tag.id, tagLabel: tag.label },
      },
      ts,
    );
  }),

  detachFromTicket: defineMutator(ticketTagArgsSchema, async ({ tx, args, ctx: authData }) => {
    await assertCanModifyTicket(tx, authData, args.ticketID);
    const auth = authData as WorkspaceAuthData;
    const tag = await assertTagInWorkspace(tx, auth, args.tagID);
    const existing = await tx.run(
      builder.ticketTag.where('ticketID', args.ticketID).where('tagID', args.tagID).one(),
    );
    if (!existing) return;

    const ts = now();
    await tx.mutate.ticketTag.delete({ ticketID: args.ticketID, tagID: args.tagID });
    await emitAudit(
      tx,
      auth,
      {
        ticketID: args.ticketID,
        kind: 'ticket.tag_removed',
        payload: { tagID: tag.id, tagLabel: tag.label },
      },
      ts,
    );
  }),

  replaceOnTicket: defineMutator(
    replaceTicketTagsArgsSchema,
    async ({ tx, args, ctx: authData }) => {
      const ticket = await assertCanModifyTicket(tx, authData, args.ticketID);
      const auth = authData as WorkspaceAuthData;
      const tags = await assertAllTagsInWorkspace(tx, auth, args.tagIDs);
      const nextTagIDs = [...new Set(args.tagIDs)];
      const existing = await tx.run(
        builder.ticketTag.where('ticketID', args.ticketID).where('workspaceID', auth.workspaceID),
      );
      const existingTagIDs = existing.map((row) => row.tagID);
      const toRemove = existingTagIDs.filter((tagID) => !nextTagIDs.includes(tagID));
      const toAdd = nextTagIDs.filter((tagID) => !existingTagIDs.includes(tagID));
      if (toRemove.length === 0 && toAdd.length === 0) return;

      const ts = now();
      for (const tagID of toRemove) {
        await tx.mutate.ticketTag.delete({ ticketID: args.ticketID, tagID });
      }
      for (const tagID of toAdd) {
        await tx.mutate.ticketTag.insert({
          ticketID: args.ticketID,
          tagID,
          workspaceID: ticket.workspaceID,
          addedAt: ts,
          addedByID: auth.sub,
        });
      }
      await emitAudit(
        tx,
        auth,
        {
          ticketID: args.ticketID,
          kind: 'ticket.tags_replaced',
          payload: {
            oldTagIDs: existingTagIDs,
            newTagIDs: nextTagIDs,
            tags: tags.map((tag) => ({ tagID: tag.id, tagLabel: tag.label })),
          },
        },
        ts,
      );
    },
  ),

  attachToCustomer: defineMutator(customerTagArgsSchema, async ({ tx, args, ctx: authData }) => {
    const customer = await assertCanModifyCustomer(tx, authData, args.customerID);
    const auth = authData as WorkspaceAuthData;
    const tag = await assertTagInWorkspace(tx, auth, args.tagID);
    const existing = await tx.run(
      builder.customerTag.where('customerID', args.customerID).where('tagID', args.tagID).one(),
    );
    if (existing) return;

    const ts = now();
    await tx.mutate.customerTag.insert({
      customerID: args.customerID,
      tagID: args.tagID,
      workspaceID: customer.workspaceID,
      addedAt: ts,
      addedByID: auth.sub,
    });
    await emitAudit(
      tx,
      auth,
      {
        customerID: args.customerID,
        kind: 'customer.tag_added',
        payload: { tagID: tag.id, tagLabel: tag.label },
      },
      ts,
    );
  }),

  detachFromCustomer: defineMutator(customerTagArgsSchema, async ({ tx, args, ctx: authData }) => {
    await assertCanModifyCustomer(tx, authData, args.customerID);
    const auth = authData as WorkspaceAuthData;
    const tag = await assertTagInWorkspace(tx, auth, args.tagID);
    const existing = await tx.run(
      builder.customerTag.where('customerID', args.customerID).where('tagID', args.tagID).one(),
    );
    if (!existing) return;

    const ts = now();
    await tx.mutate.customerTag.delete({ customerID: args.customerID, tagID: args.tagID });
    await emitAudit(
      tx,
      auth,
      {
        customerID: args.customerID,
        kind: 'customer.tag_removed',
        payload: { tagID: tag.id, tagLabel: tag.label },
      },
      ts,
    );
  }),
};
