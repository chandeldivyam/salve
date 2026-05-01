import { type AuthData, builder } from '@opendesk/zero-schema';
import { defineMutator, type ReadonlyJSONValue, type Transaction } from '@rocicorp/zero';
import { z } from 'zod';
import {
  assertCanModifyCustomer,
  assertCanModifyTicket,
  assertHasWorkspace,
  type WorkspaceAuthData,
} from './auth.js';
import { MutationError, MutationErrorCode } from './error.js';

const uuidArg = z.string().uuid();
const nullableNameArg = z.union([z.string().trim().min(1).max(120), z.null()]).optional();
const nullableContactArg = z.union([z.string().trim().min(1).max(160), z.null()]).optional();

function isReadonlyJSONValue(value: unknown): value is ReadonlyJSONValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every(isReadonlyJSONValue);
  }
  if (
    typeof value === 'object' &&
    value !== null &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    return Object.values(value).every(isReadonlyJSONValue);
  }
  return false;
}

function isMetadataRecord(value: unknown): value is Readonly<Record<string, ReadonlyJSONValue>> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Object.values(value).every(isReadonlyJSONValue)
  );
}

const metadataArg = z.custom<Readonly<Record<string, ReadonlyJSONValue>>>(isMetadataRecord);

export const updateCustomerArgsSchema = z
  .object({
    id: uuidArg,
    name: nullableNameArg,
    displayName: nullableNameArg,
    phone: nullableContactArg,
    location: nullableContactArg,
    metadata: metadataArg.optional(),
  })
  .refine(
    (args) =>
      args.name !== undefined ||
      args.displayName !== undefined ||
      args.phone !== undefined ||
      args.location !== undefined ||
      args.metadata !== undefined,
    { message: 'at least one customer field is required' },
  );
export type UpdateCustomerArgs = z.infer<typeof updateCustomerArgsSchema>;

export const createCustomerNoteArgsSchema = z.object({
  id: uuidArg,
  objectType: z.enum(['customer', 'ticket']),
  objectID: uuidArg,
  customerID: uuidArg,
  bodyHtml: z.string().min(1).max(200_000),
  bodyText: z.string().min(1).max(100_000),
  pinned: z.boolean().optional(),
});
export type CreateCustomerNoteArgs = z.infer<typeof createCustomerNoteArgsSchema>;

export const updateCustomerNoteArgsSchema = z.object({
  id: uuidArg,
  bodyHtml: z.string().min(1).max(200_000),
  bodyText: z.string().min(1).max(100_000),
});
export type UpdateCustomerNoteArgs = z.infer<typeof updateCustomerNoteArgsSchema>;

export const customerNoteIDOnlyArgsSchema = z.object({ id: uuidArg });
export type CustomerNoteIDOnlyArgs = z.infer<typeof customerNoteIDOnlyArgsSchema>;

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
    customerID: string;
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

async function assertNoteTarget(
  tx: Transaction,
  authData: WorkspaceAuthData,
  args: {
    objectType: 'customer' | 'ticket';
    objectID: string;
    customerID: string;
  },
): Promise<{ ticketID?: string }> {
  await assertCanModifyCustomer(tx, authData, args.customerID);
  if (args.objectType === 'customer') {
    if (args.objectID !== args.customerID) {
      throw new MutationError(
        'customer note target must match customer',
        MutationErrorCode.INVALID_INPUT,
        args.objectID,
      );
    }
    return {};
  }

  const ticket = await assertCanModifyTicket(tx, authData, args.objectID);
  if (ticket.customerID !== args.customerID) {
    throw new MutationError(
      'ticket note target must belong to customer',
      MutationErrorCode.INVALID_INPUT,
      args.objectID,
    );
  }
  return { ticketID: args.objectID };
}

async function assertCanModifyCustomerNote(
  tx: Transaction,
  authData: AuthData | undefined | null,
  noteID: string,
) {
  assertHasWorkspace(authData);
  const note = await tx.run(builder.customerNote.where('id', noteID).one());
  if (!note || note.deletedAt) {
    throw new MutationError('customer note not found', MutationErrorCode.NOT_FOUND, noteID);
  }
  if (note.workspaceID !== authData.workspaceID) {
    throw new MutationError('customer note not found', MutationErrorCode.CROSS_WORKSPACE, noteID);
  }
  if (note.createdByID !== authData.sub) {
    throw new MutationError('customer note not found', MutationErrorCode.NOT_AUTHORIZED, noteID);
  }
  return { note, auth: authData };
}

export const customerMutators = {
  update: defineMutator(updateCustomerArgsSchema, async ({ tx, args, ctx: authData }) => {
    const customer = await assertCanModifyCustomer(tx, authData, args.id);
    const auth = authData as WorkspaceAuthData;
    const ts = now();
    const change: Record<string, unknown> = { id: args.id, updatedAt: ts };
    const changedFields: string[] = [];

    if (args.name !== undefined && args.name !== customer.name) {
      change.name = args.name;
      changedFields.push('name');
    }
    if (args.displayName !== undefined && args.displayName !== customer.displayName) {
      change.displayName = args.displayName;
      changedFields.push('displayName');
    }
    if (args.phone !== undefined && args.phone !== customer.phone) {
      change.phone = args.phone;
      changedFields.push('phone');
    }
    if (args.location !== undefined && args.location !== customer.location) {
      change.location = args.location;
      changedFields.push('location');
    }
    if (args.metadata !== undefined) {
      change.metadata = args.metadata;
      changedFields.push('metadata');
    }

    if (changedFields.length === 0) return;

    await tx.mutate.customer.update(change as { id: string });
    await emitAudit(
      tx,
      auth,
      {
        customerID: args.id,
        kind: 'customer.updated',
        payload: { changedFields },
      },
      ts,
    );
  }),
};

export const customerNoteMutators = {
  create: defineMutator(createCustomerNoteArgsSchema, async ({ tx, args, ctx: authData }) => {
    assertHasWorkspace(authData);
    const target = await assertNoteTarget(tx, authData, args);
    const ts = now();
    await tx.mutate.customerNote.insert({
      id: args.id,
      workspaceID: authData.workspaceID,
      objectType: args.objectType,
      objectID: args.objectID,
      customerID: args.customerID,
      bodyHtml: args.bodyHtml,
      bodyText: args.bodyText,
      pinned: args.pinned ?? false,
      createdByID: authData.sub,
      editedAt: undefined,
      deletedAt: undefined,
      createdAt: ts,
      updatedAt: ts,
    });
    await emitAudit(
      tx,
      authData,
      {
        ticketID: target.ticketID,
        customerID: args.customerID,
        kind: 'customer.note_created',
        payload: {
          noteID: args.id,
          objectType: args.objectType,
          objectID: args.objectID,
          pinned: args.pinned ?? false,
        },
      },
      ts,
    );
  }),

  update: defineMutator(updateCustomerNoteArgsSchema, async ({ tx, args, ctx: authData }) => {
    const { note, auth } = await assertCanModifyCustomerNote(tx, authData, args.id);
    const ts = now();
    await tx.mutate.customerNote.update({
      id: args.id,
      bodyHtml: args.bodyHtml,
      bodyText: args.bodyText,
      editedAt: ts,
      updatedAt: ts,
    });
    await emitAudit(
      tx,
      auth,
      {
        ticketID: note.objectType === 'ticket' ? note.objectID : undefined,
        customerID: note.customerID,
        kind: 'customer.note_updated',
        payload: { noteID: args.id, objectType: note.objectType, objectID: note.objectID },
      },
      ts,
    );
  }),

  delete: defineMutator(customerNoteIDOnlyArgsSchema, async ({ tx, args, ctx: authData }) => {
    const { note, auth } = await assertCanModifyCustomerNote(tx, authData, args.id);
    const ts = now();
    await tx.mutate.customerNote.update({ id: args.id, deletedAt: ts, updatedAt: ts });
    await emitAudit(
      tx,
      auth,
      {
        ticketID: note.objectType === 'ticket' ? note.objectID : undefined,
        customerID: note.customerID,
        kind: 'customer.note_deleted',
        payload: { noteID: args.id, objectType: note.objectType, objectID: note.objectID },
      },
      ts,
    );
  }),

  togglePin: defineMutator(customerNoteIDOnlyArgsSchema, async ({ tx, args, ctx: authData }) => {
    const { note, auth } = await assertCanModifyCustomerNote(tx, authData, args.id);
    const ts = now();
    const pinned = !note.pinned;
    await tx.mutate.customerNote.update({ id: args.id, pinned, updatedAt: ts });
    await emitAudit(
      tx,
      auth,
      {
        ticketID: note.objectType === 'ticket' ? note.objectID : undefined,
        customerID: note.customerID,
        kind: pinned ? 'customer.note_pinned' : 'customer.note_unpinned',
        payload: { noteID: args.id, objectType: note.objectType, objectID: note.objectID },
      },
      ts,
    );
  }),
};
