// Server-side mutator wrappers. Pattern from
// `/tmp/zero-mono/apps/zbugs/server/server-mutators.ts:25-280`.
//
// Each entry below:
//   1. Calls the shared client mutator's `.fn({ tx, args, ctx })` so the same
//      validation + assertions + ZQL writes execute on the server.
//   2. Adds **server-only** post-commit work (Inngest dispatch, audit fan-out).
//
// The wrapped transaction is a postgres.js TransactionSql — accessible via
// `tx.dbTransaction.wrappedTransaction` when `tx.location === 'server'`.

import { randomUUID } from 'node:crypto';
import { createTicketArgsSchema, mutators, sendMessageArgsSchema } from '@opendesk/mutators';
import { builder } from '@opendesk/zero-schema';
import { defineMutator, defineMutators, type Transaction } from '@rocicorp/zero';
import type postgres from 'postgres';
import { inngest } from './inngest/client.js';
import { DELIVERY_EVENT } from './inngest/events.js';

type WrappedSql = postgres.TransactionSql<Record<string, unknown>>;
export type PostCommitTask = () => Promise<void>;

function getWrappedTx(tx: Transaction): WrappedSql {
  if (tx.location !== 'server') {
    throw new Error('server-mutator wrapper invoked on a client transaction');
  }
  // Zero's postgresjs adapter wraps the postgres.js TransactionSql here.
  return (tx.dbTransaction as unknown as { wrappedTransaction: WrappedSql }).wrappedTransaction;
}

export function createServerMutators(postCommitTasks: PostCommitTask[] = []) {
  return defineMutators(mutators, {
    ticket: {
      // Mirror the client mutator. Downstream fan-out moved off the rejected
      // outbox table; future ticket events should use postCommitTasks.
      create: defineMutator(createTicketArgsSchema, async ({ tx, args, ctx: authData }) => {
        await mutators.ticket.create.fn({ tx, args, ctx: authData });
      }),
    },

    message: {
      // Public agent reply on a ticket with a customer → enqueue an
      // `outbound_message` row and dispatch delivery/message.requested after
      // commit. Internal notes stay in-app only.
      send: defineMutator(sendMessageArgsSchema, async ({ tx, args, ctx: authData }) => {
        await mutators.message.send.fn({ tx, args, ctx: authData });
        if (!authData?.workspaceID) return;
        if (args.isInternal) return;

        // Re-read the ticket to find its customer (the client mutator already
        // verified workspace ownership; a second read here is fine — same
        // transaction).
        const ticket = await tx.run(builder.ticket.where('id', args.ticketID).one());
        if (!ticket?.customerID) return;

        const requestedEmailAddressID = (args as typeof args & { emailAddressID?: string })
          .emailAddressID;
        const resolved = await resolveSendingAddress(getWrappedTx(tx), {
          workspaceID: authData.workspaceID,
          requestedEmailAddressID,
        });
        if (!resolved) {
          throw new Error('no sending email address configured for this workspace');
        }

        const outboundMessageID = randomUUID();
        await insertQueuedOutboundMessage(getWrappedTx(tx), {
          id: outboundMessageID,
          workspaceID: authData.workspaceID,
          channelID: resolved.channelID,
          emailAddressID: resolved.emailAddressID,
          ticketID: args.ticketID,
          messageID: args.id,
        });

        postCommitTasks.push(async () => {
          await inngest.send({
            id: `msg-req-${args.id}`,
            name: DELIVERY_EVENT.MESSAGE_REQUESTED,
            data: {
              workspaceID: authData.workspaceID,
              channelID: resolved.channelID,
              ticketID: args.ticketID,
              messageID: args.id,
              customerID: ticket.customerID,
              outboundMessageID,
              attempt: 0,
            },
          });
        });
      }),
    },
  });
}

export type ServerMutators = ReturnType<typeof createServerMutators>;

async function resolveSendingAddress(
  sql: WrappedSql,
  args: { workspaceID: string; requestedEmailAddressID?: string },
): Promise<{ channelID: string; emailAddressID: string } | null> {
  if (args.requestedEmailAddressID) {
    const rows = await sql<Array<{ channel_id: string; id: string }>>`
      SELECT ea.channel_id, ea.id
      FROM email_address ea
      JOIN channel c ON c.id = ea.channel_id
      WHERE ea.id = ${args.requestedEmailAddressID}
        AND c.workspace_id = ${args.workspaceID}
        AND c.kind = 'email'
        AND ea.can_send = true
        AND ea.deleted_at IS NULL
      LIMIT 1
    `;
    const row = rows[0];
    return row ? { channelID: row.channel_id, emailAddressID: row.id } : null;
  }

  const rows = await sql<Array<{ channel_id: string; id: string }>>`
    SELECT ea.channel_id, ea.id
    FROM email_address ea
    JOIN channel c ON c.id = ea.channel_id
    WHERE c.workspace_id = ${args.workspaceID}
      AND c.kind = 'email'
      AND c.deleted_at IS NULL
      AND ea.can_send = true
      AND ea.deleted_at IS NULL
    ORDER BY c.is_default DESC, ea.is_default DESC, ea.created_at ASC
    LIMIT 1
  `;
  const row = rows[0];
  return row ? { channelID: row.channel_id, emailAddressID: row.id } : null;
}

async function insertQueuedOutboundMessage(
  sql: WrappedSql,
  args: {
    id: string;
    workspaceID: string;
    channelID: string;
    emailAddressID: string;
    ticketID: string;
    messageID: string;
  },
): Promise<void> {
  await sql`
    INSERT INTO outbound_message (
      id,
      workspace_id,
      channel_id,
      email_address_id,
      ticket_id,
      message_id,
      status,
      created_at,
      updated_at
    )
    VALUES (
      ${args.id},
      ${args.workspaceID},
      ${args.channelID},
      ${args.emailAddressID},
      ${args.ticketID},
      ${args.messageID},
      'queued',
      now(),
      now()
    )
  `;
}
