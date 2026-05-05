// @salve/mutators — Zero custom mutators, shared by web (optimistic) and api
// (authoritative). Pattern from `/tmp/zero-mono/apps/zbugs/shared/mutators.ts`.
//
// Every mutator:
//   - validates input via Zod
//   - asserts auth (workspaceID + role) before touching `tx.mutate`
//   - scopes every write by `auth.workspaceID` (no caller can supply a
//     workspaceID; cross-workspace is a CROSS_WORKSPACE error)
//   - emits an `audit_event` row for ticket mutations (ticket.* + message.*)
//
// Server-side post-commit hooks (Inngest fan-out, e.g.
// `delivery/message.requested` for `message.send`) live in
// `apps/api/src/server-mutators.ts`.

import {
  defineMutator,
  defineMutators,
  type ReadonlyJSONValue,
  type Transaction,
} from '@rocicorp/zero';
import { builder } from '@salve/zero-schema';
import { z } from 'zod';
import {
  assertCanModifyTicket,
  assertHasWorkspace,
  auditActorKind,
  type WorkspaceAuthData,
} from './auth.js';
import { customFieldMutators } from './custom-field-mutators.js';
import { customerMutators, customerNoteMutators } from './customer-mutators.js';
import { MutationError, MutationErrorCode } from './error.js';
import { emailSettingsMutators } from './settings-email-mutators.js';
import { tagGroupMutators, tagMutators } from './tag-mutators.js';
import { viewMutators } from './view-mutators.js';

export {
  type CreateEmailAddressArgs,
  type CreateEmailDomainArgs,
  createEmailAddressArgsSchema,
  createEmailDomainArgsSchema,
  type UpsertEmailRoutingRuleArgs,
  upsertEmailRoutingRuleArgsSchema,
} from './settings-email-mutators.js';

// ---------- Argument schemas ----------

const idArg = z.string().min(1);
export const MESSAGE_EDIT_WINDOW_MS = 15 * 60 * 1000;

export const createTicketArgsSchema = z.object({
  id: idArg,
  title: z.string().min(1).max(500),
  description: z.string().optional(),
  customerEmail: z.string().email().optional(),
  customerName: z.string().optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
});
export type CreateTicketArgs = z.infer<typeof createTicketArgsSchema>;

export const updateTicketArgsSchema = z.object({
  id: idArg,
  title: z.string().min(1).max(500).optional(),
  description: z.string().optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
});
export type UpdateTicketArgs = z.infer<typeof updateTicketArgsSchema>;

export const assignTicketArgsSchema = z.object({
  id: idArg,
  assigneeID: z.union([z.string().min(1), z.null()]),
});
export type AssignTicketArgs = z.infer<typeof assignTicketArgsSchema>;

export const snoozeTicketArgsSchema = z.object({
  id: idArg,
  // epoch ms
  until: z.number().int().nonnegative(),
});
export type SnoozeTicketArgs = z.infer<typeof snoozeTicketArgsSchema>;

export const ticketIdOnlyArgsSchema = z.object({ id: idArg });
export type TicketIDOnlyArgs = z.infer<typeof ticketIdOnlyArgsSchema>;

export const messageAttachmentSchema = z.object({
  id: idArg,
  s3Key: z.string().min(1),
  filename: z.string().min(1),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
});
export type MessageAttachmentInput = z.infer<typeof messageAttachmentSchema>;

export const sendMessageArgsSchema = z.object({
  id: idArg,
  ticketID: idArg,
  emailAddressID: z.union([idArg, z.null()]).optional(),
  bodyHTML: z.string(),
  bodyText: z.string(),
  isInternal: z.boolean().optional(),
  attachments: z.array(messageAttachmentSchema).optional(),
});
export type SendMessageArgs = z.infer<typeof sendMessageArgsSchema>;

export const updateMessageArgsSchema = z.object({
  id: idArg,
  ticketID: idArg,
  bodyHTML: z.string().min(1).max(200_000),
  bodyText: z.string().min(1).max(100_000),
});
export type UpdateMessageArgs = z.infer<typeof updateMessageArgsSchema>;

export const deleteMessageArgsSchema = z.object({
  id: idArg,
  ticketID: idArg,
});
export type DeleteMessageArgs = z.infer<typeof deleteMessageArgsSchema>;

// ---------- Helpers ----------

function now(): number {
  return Date.now();
}

/**
 * Find an existing customer by `(workspaceID, email)` or insert one. We
 * tolerate races by re-reading after the insert attempt — the `customer`
 * table has a unique index on `(workspace_id, email)` (see
 * `packages/db/src/schema/domain.ts`).
 */
async function findOrCreateCustomerByEmail(
  tx: Transaction,
  authData: WorkspaceAuthData,
  email: string,
  name: string | undefined,
  customerID: string,
  ts: number,
): Promise<string> {
  const existing = await tx.run(
    builder.customer.where('workspaceID', authData.workspaceID).where('email', email).one(),
  );
  if (existing) return existing.id;
  await tx.mutate.customer.insert({
    id: customerID,
    workspaceID: authData.workspaceID,
    email,
    name: name ?? undefined,
    firstSeenAt: ts,
    lastSeenAt: undefined,
    phone: undefined,
    location: undefined,
    metadata: {},
    createdAt: ts,
    updatedAt: ts,
  });
  return customerID;
}

async function emitAudit(
  tx: Transaction,
  authData: WorkspaceAuthData,
  args: {
    id: string;
    ticketID: string;
    kind: string;
    payload?: ReadonlyJSONValue;
  },
  ts: number,
) {
  await tx.mutate.auditEvent.insert({
    id: args.id,
    workspaceID: authData.workspaceID,
    ticketID: args.ticketID,
    actorID: authData.sub,
    actorKind: auditActorKind(authData),
    kind: args.kind,
    payload: args.payload,
    createdAt: ts,
  });
}

async function assertCanModifyOwnMessage(
  tx: Transaction,
  authData: WorkspaceAuthData,
  args: { id: string; ticketID: string },
) {
  await assertCanModifyTicket(tx, authData, args.ticketID);
  const message = await tx.run(builder.message.where('id', '=', args.id).one());
  if (!message || message.deletedAt) {
    throw new MutationError('message not found', MutationErrorCode.NOT_FOUND, args.id);
  }
  if (message.workspaceID !== authData.workspaceID) {
    throw new MutationError('message not found', MutationErrorCode.CROSS_WORKSPACE, args.id);
  }
  if (message.ticketID !== args.ticketID) {
    throw new MutationError('message not found', MutationErrorCode.NOT_FOUND, args.id);
  }
  if (message.authorType !== 'agent' || message.authorUserID !== authData.sub) {
    throw new MutationError(
      'only the message author can change this message',
      MutationErrorCode.NOT_AUTHORIZED,
      args.id,
    );
  }
  // Phase B: edit/delete is only permitted on internal notes. Public outbound
  // messages (email today; WhatsApp/Slack/etc. in the future) become immutable
  // the moment they're authored — there's nothing on our side to un-send.
  // Future: a per-channel send-delay setting will open a grace window during
  // which `outbound_message.status='queued'` is editable / cancellable, and
  // channels that natively support edit (WhatsApp, Slack) will gain a
  // post-send edit path that calls the channel API. Until those land, gating
  // is binary: internal-only.
  if (!message.isInternal) {
    throw new MutationError(
      'public replies are immutable once sent',
      MutationErrorCode.NOT_AUTHORIZED,
      args.id,
    );
  }
  return message;
}

/**
 * Generate a fresh UUID for sub-rows the mutator creates server-side
 * (audit events, customers). Drizzle types these columns as Postgres `uuid`
 * so the suffix-based derivation we tried first failed `invalid input syntax
 * for type uuid`. Both client and server have `crypto.randomUUID` (modern
 * browsers + Node 19+); this means optimistic and authoritative paths will
 * insert different IDs for the same logical row, which is fine because Zero
 * reconciles by primary key and the audit_event rows are append-only.
 */
function newID(): string {
  return crypto.randomUUID();
}

// ---------- Mutators ----------

export const mutators = defineMutators({
  tagGroup: tagGroupMutators,
  tag: tagMutators,
  customField: customFieldMutators,
  customer: customerMutators,
  customerNote: customerNoteMutators,
  settings: {
    email: emailSettingsMutators,
  },
  view: viewMutators,

  ticket: {
    create: defineMutator(createTicketArgsSchema, async ({ tx, args, ctx: authData }) => {
      assertHasWorkspace(authData);
      const ts = now();

      let customerID: string | undefined;
      if (args.customerEmail) {
        customerID = await findOrCreateCustomerByEmail(
          tx,
          authData,
          args.customerEmail,
          args.customerName,
          newID(),
          ts,
        );
      }

      await tx.mutate.ticket.insert({
        id: args.id,
        workspaceID: authData.workspaceID,
        // The Postgres trigger fills `short_id` per-workspace on insert when
        // it sees 0; ZQL doesn't expose triggers but the server replay path
        // commits to PG, which runs the trigger. The optimistic client just
        // sees `0` until the server replay confirms — acceptable for now.
        shortID: 0,
        title: args.title,
        description: args.description,
        status: 'open',
        priority: args.priority ?? 'normal',
        customerID,
        assigneeID: undefined,
        createdByID: authData.sub,
        createdAt: ts,
        updatedAt: ts,
        firstResponseAt: undefined,
        resolvedAt: undefined,
        resolvedByID: undefined,
        closedAt: undefined,
        closedByID: undefined,
      });

      await emitAudit(
        tx,
        authData,
        {
          id: newID(),
          ticketID: args.id,
          kind: 'ticket.created',
          payload: { title: args.title, priority: args.priority ?? 'normal' },
        },
        ts,
      );
    }),

    update: defineMutator(updateTicketArgsSchema, async ({ tx, args, ctx: authData }) => {
      const ticket = await assertCanModifyTicket(tx, authData, args.id);
      const auth = authData as WorkspaceAuthData;
      const ts = now();

      const change: Record<string, unknown> = { id: args.id, updatedAt: ts };
      const contentChanged =
        (args.title !== undefined && args.title !== ticket.title) ||
        (args.description !== undefined && args.description !== ticket.description);
      const priorityChanged = args.priority !== undefined && args.priority !== ticket.priority;
      if (args.title !== undefined) change.title = args.title;
      if (args.description !== undefined) change.description = args.description;
      if (args.priority !== undefined) change.priority = args.priority;
      if (!contentChanged && !priorityChanged) return;

      await tx.mutate.ticket.update(change as { id: string });

      if (contentChanged) {
        await emitAudit(
          tx,
          auth,
          {
            id: newID(),
            ticketID: args.id,
            kind: 'ticket.updated',
            payload: {
              title: args.title,
              description: args.description,
            },
          },
          ts,
        );
      }
      if (priorityChanged) {
        await emitAudit(
          tx,
          auth,
          {
            id: newID(),
            ticketID: args.id,
            kind: 'ticket.priority_changed',
            payload: {
              oldPriority: ticket.priority,
              priority: args.priority,
            },
          },
          ts,
        );
      }
    }),

    assign: defineMutator(assignTicketArgsSchema, async ({ tx, args, ctx: authData }) => {
      const ticket = await assertCanModifyTicket(tx, authData, args.id);
      const auth = authData as WorkspaceAuthData;
      const ts = now();
      const nextAssigneeID = args.assigneeID ?? undefined;

      if ((ticket.assigneeID ?? undefined) === nextAssigneeID) return;

      if (args.assigneeID) {
        // Verify assignee is a member of the same workspace (`member` is the
        // better-auth org-plugin junction). This blocks "assign to a user
        // from another tenant" via a forged client-side mutation.
        const membership = await tx.run(
          builder.member
            .where('userId', args.assigneeID)
            .where('organizationId', auth.workspaceID)
            .one(),
        );
        if (!membership) {
          throw new MutationError(
            'assignee is not a member of this workspace',
            MutationErrorCode.NOT_AUTHORIZED,
            args.assigneeID,
          );
        }
      }

      await tx.mutate.ticket.update({
        id: args.id,
        assigneeID: nextAssigneeID,
        updatedAt: ts,
      });

      await emitAudit(
        tx,
        auth,
        {
          id: newID(),
          ticketID: args.id,
          kind: 'ticket.assigned',
          payload: { oldAssigneeID: ticket.assigneeID ?? null, assigneeID: args.assigneeID },
        },
        ts,
      );
    }),

    snooze: defineMutator(snoozeTicketArgsSchema, async ({ tx, args, ctx: authData }) => {
      const ticket = await assertCanModifyTicket(tx, authData, args.id);
      const auth = authData as WorkspaceAuthData;
      const ts = now();
      await tx.mutate.ticket.update({
        id: args.id,
        status: 'snoozed',
        updatedAt: ts,
      });
      await emitAudit(
        tx,
        auth,
        {
          id: newID(),
          ticketID: args.id,
          kind: 'ticket.snoozed',
          payload: { oldStatus: ticket.status, status: 'snoozed', until: args.until },
        },
        ts,
      );
    }),

    close: defineMutator(ticketIdOnlyArgsSchema, async ({ tx, args, ctx: authData }) => {
      const ticket = await assertCanModifyTicket(tx, authData, args.id);
      const auth = authData as WorkspaceAuthData;
      const ts = now();
      if (ticket.status === 'closed') return;
      await tx.mutate.ticket.update({
        id: args.id,
        status: 'closed',
        closedAt: ts,
        closedByID: auth.sub,
        updatedAt: ts,
      });
      await emitAudit(
        tx,
        auth,
        {
          id: newID(),
          ticketID: args.id,
          kind: 'ticket.status_changed',
          payload: { oldStatus: ticket.status, status: 'closed' },
        },
        ts,
      );
    }),

    resolve: defineMutator(ticketIdOnlyArgsSchema, async ({ tx, args, ctx: authData }) => {
      const ticket = await assertCanModifyTicket(tx, authData, args.id);
      const auth = authData as WorkspaceAuthData;
      const ts = now();
      if (ticket.status === 'resolved') return;
      await tx.mutate.ticket.update({
        id: args.id,
        status: 'resolved',
        resolvedAt: ts,
        resolvedByID: auth.sub,
        closedAt: undefined,
        closedByID: undefined,
        updatedAt: ts,
      });
      await emitAudit(
        tx,
        auth,
        {
          id: newID(),
          ticketID: args.id,
          kind: 'ticket.status_changed',
          payload: { oldStatus: ticket.status, status: 'resolved' },
        },
        ts,
      );
    }),

    markInProgress: defineMutator(ticketIdOnlyArgsSchema, async ({ tx, args, ctx: authData }) => {
      const ticket = await assertCanModifyTicket(tx, authData, args.id);
      const auth = authData as WorkspaceAuthData;
      const ts = now();
      if (
        ticket.status === 'in_progress' &&
        !ticket.resolvedAt &&
        !ticket.resolvedByID &&
        !ticket.closedAt &&
        !ticket.closedByID
      ) {
        return;
      }
      await tx.mutate.ticket.update({
        id: args.id,
        status: 'in_progress',
        resolvedAt: undefined,
        resolvedByID: undefined,
        closedAt: undefined,
        closedByID: undefined,
        updatedAt: ts,
      });
      await emitAudit(
        tx,
        auth,
        {
          id: newID(),
          ticketID: args.id,
          kind: 'ticket.status_changed',
          payload: { oldStatus: ticket.status, status: 'in_progress' },
        },
        ts,
      );
    }),

    reopen: defineMutator(ticketIdOnlyArgsSchema, async ({ tx, args, ctx: authData }) => {
      const ticket = await assertCanModifyTicket(tx, authData, args.id);
      const auth = authData as WorkspaceAuthData;
      const ts = now();
      if (ticket.status === 'open' && !ticket.resolvedAt && !ticket.closedAt) return;
      await tx.mutate.ticket.update({
        id: args.id,
        status: 'open',
        resolvedAt: undefined,
        resolvedByID: undefined,
        closedAt: undefined,
        closedByID: undefined,
        updatedAt: ts,
      });
      await emitAudit(
        tx,
        auth,
        {
          id: newID(),
          ticketID: args.id,
          kind: ticket.status === 'snoozed' ? 'ticket.unsnoozed' : 'ticket.status_changed',
          payload: { oldStatus: ticket.status, status: 'open' },
        },
        ts,
      );
    }),
  },

  message: {
    send: defineMutator(sendMessageArgsSchema, async ({ tx, args, ctx: authData }) => {
      const ticket = await assertCanModifyTicket(tx, authData, args.ticketID);
      const auth = authData as WorkspaceAuthData;
      const ts = now();
      const isInternal = args.isInternal ?? false;

      await tx.mutate.message.insert({
        id: args.id,
        workspaceID: auth.workspaceID,
        ticketID: args.ticketID,
        authorType: 'agent',
        authorUserID: auth.sub,
        authorCustomerID: undefined,
        bodyHtml: args.bodyHTML,
        bodyText: args.bodyText,
        isInternal,
        editedAt: undefined,
        deletedAt: undefined,
        createdAt: ts,
        updatedAt: ts,
      });

      // Phase 2c: persist any uploaded-but-unattached attachments. Mutator
      // runs on both client (optimistic) and server — same code path. The
      // S3 object was already PUT by the browser via the /api/files/presign
      // URL; we only stamp the DB row here.
      if (args.attachments?.length) {
        for (const a of args.attachments) {
          await tx.mutate.attachment.insert({
            id: a.id,
            workspaceID: auth.workspaceID,
            messageID: args.id,
            s3Key: a.s3Key,
            filename: a.filename,
            mimeType: a.mimeType,
            sizeBytes: a.sizeBytes,
            createdAt: ts,
          });
        }
      }

      // Bump ticket activity; stamp first_response_at if this is the first
      // agent reply.
      const ticketUpdate: Record<string, unknown> = {
        id: args.ticketID,
        updatedAt: ts,
      };
      if (!ticket.firstResponseAt && !isInternal) {
        ticketUpdate.firstResponseAt = ts;
      }
      await tx.mutate.ticket.update(ticketUpdate as { id: string });

      await emitAudit(
        tx,
        auth,
        {
          id: newID(),
          ticketID: args.ticketID,
          kind: isInternal ? 'message.note_added' : 'message.sent',
          payload: { messageID: args.id, isInternal },
        },
        ts,
      );

      // Delivery fan-out for `delivery/message.requested` happens in the
      // server-mutator wrapper (`apps/api/src/server-mutators.ts`). The
      // wrapper re-checks the (`!isInternal && ticket.customerID`) condition.
    }),

    update: defineMutator(updateMessageArgsSchema, async ({ tx, args, ctx: authData }) => {
      assertHasWorkspace(authData);
      const message = await assertCanModifyOwnMessage(tx, authData, args);
      const ts = now();
      if (ts - message.createdAt > MESSAGE_EDIT_WINDOW_MS) {
        throw new MutationError(
          'message edit window has expired',
          MutationErrorCode.NOT_AUTHORIZED,
          args.id,
        );
      }
      if (message.bodyHtml === args.bodyHTML && message.bodyText === args.bodyText) return;

      await tx.mutate.message.update({
        id: args.id,
        bodyHtml: args.bodyHTML,
        bodyText: args.bodyText,
        editedAt: ts,
        updatedAt: ts,
      });
      await tx.mutate.ticket.update({ id: args.ticketID, updatedAt: ts });
      await emitAudit(
        tx,
        authData,
        {
          id: newID(),
          ticketID: args.ticketID,
          kind: 'message.edited',
          payload: { messageID: args.id, isInternal: message.isInternal },
        },
        ts,
      );
    }),

    delete: defineMutator(deleteMessageArgsSchema, async ({ tx, args, ctx: authData }) => {
      assertHasWorkspace(authData);
      const message = await assertCanModifyOwnMessage(tx, authData, args);
      const ts = now();
      await tx.mutate.message.update({
        id: args.id,
        deletedAt: ts,
        updatedAt: ts,
      });
      await tx.mutate.ticket.update({ id: args.ticketID, updatedAt: ts });
      await emitAudit(
        tx,
        authData,
        {
          id: newID(),
          ticketID: args.ticketID,
          kind: 'message.deleted',
          payload: { messageID: args.id, isInternal: message.isInternal },
        },
        ts,
      );
    }),
  },
});

export type Mutators = typeof mutators;

export {
  assertActorIsAgentInWorkspace,
  assertCanModifyCustomer,
  assertCanModifyTicket,
  assertCanReadCustomer,
  assertCanReadTicket,
  assertHasWorkspace,
  assertIsLoggedIn,
  auditActorKind,
  type WorkspaceAuthData,
} from './auth.js';
export {
  type ClearCustomFieldValueOnCustomerArgs,
  type ClearCustomFieldValueOnTicketArgs,
  type CreateCustomFieldArgs,
  clearCustomFieldValueOnCustomerArgsSchema,
  clearCustomFieldValueOnTicketArgsSchema,
  createCustomFieldArgsSchema,
  customFieldIDOnlyArgsSchema,
  type SetCustomFieldValueOnCustomerArgs,
  type SetCustomFieldValueOnTicketArgs,
  setCustomFieldValueOnCustomerArgsSchema,
  setCustomFieldValueOnTicketArgsSchema,
  type UpdateCustomFieldArgs,
  updateCustomFieldArgsSchema,
  validateCustomFieldValue,
} from './custom-field-mutators.js';
export {
  type CreateCustomerNoteArgs,
  type CustomerNoteIDOnlyArgs,
  createCustomerNoteArgsSchema,
  customerNoteIDOnlyArgsSchema,
  type UpdateCustomerArgs,
  type UpdateCustomerNoteArgs,
  updateCustomerArgsSchema,
  updateCustomerNoteArgsSchema,
} from './customer-mutators.js';
export { MutationError, MutationErrorCode } from './error.js';
export {
  type CreateTagArgs,
  type CreateTagGroupArgs,
  type CustomerTagArgs,
  createTagArgsSchema,
  createTagGroupArgsSchema,
  customerTagArgsSchema,
  type ReplaceTicketTagsArgs,
  replaceTicketTagsArgsSchema,
  type TicketTagArgs,
  tagIDOnlyArgsSchema,
  ticketTagArgsSchema,
  type UpdateTagArgs,
  type UpdateTagGroupArgs,
  updateTagArgsSchema,
  updateTagGroupArgsSchema,
} from './tag-mutators.js';
export {
  type ViewCreateArgs,
  type ViewDuplicateArgs,
  type ViewReorderArgs,
  type ViewUpdateArgs,
  viewCreateArgsSchema,
  viewDuplicateArgsSchema,
  viewIDOnlyArgsSchema,
  viewReorderArgsSchema,
  viewUpdateArgsSchema,
} from './view-mutators.js';
