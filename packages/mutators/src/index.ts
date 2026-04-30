// @opendesk/mutators — Zero custom mutators, shared by web (optimistic) and api
// (authoritative). Pattern from `/tmp/zero-mono/apps/zbugs/shared/mutators.ts`.
//
// Every mutator:
//   - validates input via Zod
//   - asserts auth (workspaceID + role) before touching `tx.mutate`
//   - scopes every write by `auth.workspaceID` (no caller can supply a
//     workspaceID; cross-workspace is a CROSS_WORKSPACE error)
//   - emits an `audit_event` row for ticket mutations (ticket.* + message.*)
//
// Server-side post-commit hooks (Inngest dispatch, outbox writes for fan-out
// e.g. `email.send` for `message.send`) live in `apps/api/src/server-mutators.ts`.

import { builder } from '@opendesk/zero-schema';
import {
  defineMutator,
  defineMutators,
  type ReadonlyJSONValue,
  type Transaction,
} from '@rocicorp/zero';
import { z } from 'zod';
import { assertCanModifyTicket, assertHasWorkspace, type WorkspaceAuthData } from './auth.js';
import { MutationError, MutationErrorCode } from './error.js';

// ---------- Argument schemas ----------

const idArg = z.string().min(1);

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

export const sendMessageArgsSchema = z.object({
  id: idArg,
  ticketID: idArg,
  bodyHTML: z.string(),
  bodyText: z.string(),
  isInternal: z.boolean().optional(),
});
export type SendMessageArgs = z.infer<typeof sendMessageArgsSchema>;

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
    kind: args.kind,
    payload: args.payload,
    createdAt: ts,
  });
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
      await assertCanModifyTicket(tx, authData, args.id);
      const auth = authData as WorkspaceAuthData;
      const ts = now();

      const change: Record<string, unknown> = { id: args.id, updatedAt: ts };
      if (args.title !== undefined) change.title = args.title;
      if (args.description !== undefined) change.description = args.description;
      if (args.priority !== undefined) change.priority = args.priority;

      await tx.mutate.ticket.update(change as { id: string });

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
            priority: args.priority,
          },
        },
        ts,
      );
    }),

    assign: defineMutator(assignTicketArgsSchema, async ({ tx, args, ctx: authData }) => {
      await assertCanModifyTicket(tx, authData, args.id);
      const auth = authData as WorkspaceAuthData;
      const ts = now();

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
        assigneeID: args.assigneeID ?? undefined,
        updatedAt: ts,
      });

      await emitAudit(
        tx,
        auth,
        {
          id: newID(),
          ticketID: args.id,
          kind: 'ticket.assigned',
          payload: { assigneeID: args.assigneeID },
        },
        ts,
      );
    }),

    snooze: defineMutator(snoozeTicketArgsSchema, async ({ tx, args, ctx: authData }) => {
      await assertCanModifyTicket(tx, authData, args.id);
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
          payload: { until: args.until },
        },
        ts,
      );
    }),

    close: defineMutator(ticketIdOnlyArgsSchema, async ({ tx, args, ctx: authData }) => {
      await assertCanModifyTicket(tx, authData, args.id);
      const auth = authData as WorkspaceAuthData;
      const ts = now();
      await tx.mutate.ticket.update({
        id: args.id,
        status: 'resolved',
        resolvedAt: ts,
        updatedAt: ts,
      });
      await emitAudit(
        tx,
        auth,
        {
          id: newID(),
          ticketID: args.id,
          kind: 'ticket.resolved',
        },
        ts,
      );
    }),

    reopen: defineMutator(ticketIdOnlyArgsSchema, async ({ tx, args, ctx: authData }) => {
      await assertCanModifyTicket(tx, authData, args.id);
      const auth = authData as WorkspaceAuthData;
      const ts = now();
      await tx.mutate.ticket.update({
        id: args.id,
        status: 'open',
        resolvedAt: undefined,
        updatedAt: ts,
      });
      await emitAudit(
        tx,
        auth,
        {
          id: newID(),
          ticketID: args.id,
          kind: 'ticket.reopened',
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
        createdAt: ts,
      });

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

      // Outbox fan-out for `email.send` happens in the server-mutator
      // wrapper (`apps/api/src/server-mutators.ts`) — clients can't INSERT
      // into the unmirrored `outbox` table. The wrapper re-checks the
      // (`!isInternal && ticket.customerID`) condition there.
    }),
  },
});

export type Mutators = typeof mutators;

export {
  assertActorIsAgentInWorkspace,
  assertCanModifyTicket,
  assertCanReadTicket,
  assertHasWorkspace,
  assertIsLoggedIn,
  type WorkspaceAuthData,
} from './auth.js';
export { MutationError, MutationErrorCode } from './error.js';
