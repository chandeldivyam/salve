// Server-side mutator wrappers. Pattern from
// `/tmp/zero-mono/apps/zbugs/server/server-mutators.ts:25-280`.
//
// Each entry below:
//   1. Calls the shared client mutator's `.fn({ tx, args, ctx })` so the same
//      validation + assertions + ZQL writes execute on the server.
//   2. Adds **server-only** post-commit work (currently: outbox row INSERTs
//      that the Phase-3 Inngest dispatcher will pick up).
//
// The wrapped transaction is a postgres.js TransactionSql — accessible via
// `tx.dbTransaction.wrappedTransaction` when `tx.location === 'server'`.

import { createTicketArgsSchema, mutators, sendMessageArgsSchema } from '@opendesk/mutators';
import { builder, ZERO_OUTBOX_KIND } from '@opendesk/zero-schema';
import { defineMutator, defineMutators, type Transaction } from '@rocicorp/zero';
import type postgres from 'postgres';
import { enqueueOutbox } from './outbox.js';

type WrappedSql = postgres.TransactionSql<Record<string, unknown>>;

function getWrappedTx(tx: Transaction): WrappedSql {
  if (tx.location !== 'server') {
    throw new Error('server-mutator wrapper invoked on a client transaction');
  }
  // Zero's postgresjs adapter wraps the postgres.js TransactionSql here.
  return (tx.dbTransaction as unknown as { wrappedTransaction: WrappedSql }).wrappedTransaction;
}

export function createServerMutators() {
  return defineMutators(mutators, {
    ticket: {
      // Mirror the client mutator and additionally enqueue a `ticket.created`
      // outbox row for downstream fan-out (auto-assign in Phase 4 will
      // subscribe to this).
      create: defineMutator(createTicketArgsSchema, async ({ tx, args, ctx: authData }) => {
        await mutators.ticket.create.fn({ tx, args, ctx: authData });
        if (!authData?.workspaceID) return;
        await enqueueOutbox(getWrappedTx(tx), {
          workspaceID: authData.workspaceID,
          kind: ZERO_OUTBOX_KIND.TICKET_CREATED,
          payload: { ticketID: args.id, title: args.title },
        });
      }),
    },

    message: {
      // Public agent reply on a ticket with a customer → enqueue an
      // `email.send` outbox row so the Phase-3 dispatcher can ship the SES
      // SendEmail call. Internal notes stay in-app only.
      send: defineMutator(sendMessageArgsSchema, async ({ tx, args, ctx: authData }) => {
        await mutators.message.send.fn({ tx, args, ctx: authData });
        if (!authData?.workspaceID) return;
        if (args.isInternal) return;

        // Re-read the ticket to find its customer (the client mutator already
        // verified workspace ownership; a second read here is fine — same
        // transaction).
        const ticket = await tx.run(builder.ticket.where('id', args.ticketID).one());
        if (!ticket?.customerID) return;

        await enqueueOutbox(getWrappedTx(tx), {
          workspaceID: authData.workspaceID,
          kind: ZERO_OUTBOX_KIND.EMAIL_SEND,
          payload: {
            messageID: args.id,
            ticketID: args.ticketID,
            customerID: ticket.customerID,
          },
        });

        // And a generic `message.sent` event for downstream notification fns.
        await enqueueOutbox(getWrappedTx(tx), {
          workspaceID: authData.workspaceID,
          kind: ZERO_OUTBOX_KIND.MESSAGE_SENT,
          payload: {
            messageID: args.id,
            ticketID: args.ticketID,
            isInternal: args.isInternal ?? false,
          },
        });
      }),
    },
  });
}

export type ServerMutators = ReturnType<typeof createServerMutators>;
