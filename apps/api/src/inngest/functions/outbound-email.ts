// Phase 3a — outbound-email Inngest function.
//
// Triggered by `email/send.requested` events that the outbox poller dispatches
// for every unprocessed `outbox.kind = 'email.send'` row.
//
// Steps (each one is a separately retried Inngest step — exponential backoff,
// max 5 attempts via Inngest's defaults):
//   1. Load outbox + message + ticket + customer + sending-domain.
//   2. Suppression check: if `(workspaceID, customer.email)` is suppressed,
//      mark `outbound_message.status='suppressed'` and stop.
//   3. Build the envelope.
//   4. Persist `outbound_message` with status='sending' BEFORE sending — so
//      the `rfc_message_id` is in the DB when the customer's reply arrives.
//   5. Call `sendRawEmail`. On success → 'sent' + ses_message_id. On failure
//      → 'failed' + retry.
//   6. Mark the outbox row processed.

import { getDb, schema } from '@opendesk/db';
import { and, asc, eq } from 'drizzle-orm';
import { buildEnvelope, type PriorMessage } from '../../email/envelope.js';
import { sendRawEmail } from '../../email/mailer.js';
import { inngest } from '../client.js';

export const outboundEmail = inngest.createFunction(
  {
    id: 'outbound-email',
    name: 'Outbound email',
    // Inngest defaults to retry-on-throw with exponential backoff.
    retries: 5,
    triggers: [{ event: 'email/send.requested' }],
  },
  // biome-ignore lint/suspicious/noExplicitAny: Inngest 4.x has migrated EventSchemas; for the lone Phase 3a function we cast event.data to the shape we wrote in the poller.
  async ({ event, step, logger }: any) => {
    const data = event.data as {
      outboxID: string;
      workspaceID: string;
      messageID: string;
      ticketID: string;
      customerID: string;
    };
    const { outboxID, workspaceID, messageID, ticketID, customerID } = data;

    // ---------- Step 1: load everything we need ----------
    const loaded = await step.run('load', async () => {
      const db = getDb();
      const [outboxRow] = await db
        .select()
        .from(schema.outbox)
        .where(eq(schema.outbox.id, outboxID))
        .limit(1);
      if (!outboxRow) throw new Error(`outbox ${outboxID} not found`);
      if (outboxRow.processedAt) {
        return { skip: 'already-processed' as const };
      }

      const [msg] = await db
        .select()
        .from(schema.message)
        .where(eq(schema.message.id, messageID))
        .limit(1);
      if (!msg) throw new Error(`message ${messageID} not found`);

      const [tkt] = await db
        .select()
        .from(schema.ticket)
        .where(eq(schema.ticket.id, ticketID))
        .limit(1);
      if (!tkt) throw new Error(`ticket ${ticketID} not found`);

      const [cust] = await db
        .select()
        .from(schema.customer)
        .where(eq(schema.customer.id, customerID))
        .limit(1);
      if (!cust) throw new Error(`customer ${customerID} not found`);

      const [org] = await db
        .select()
        .from(schema.organization)
        .where(eq(schema.organization.id, workspaceID))
        .limit(1);
      if (!org) throw new Error(`workspace ${workspaceID} not found`);

      // Sending domain: prefer the workspace's default verified one. Phase 3a
      // always picks the first verified domain (or first row if none verified
      // yet — UI lets the user dev-override the verification status).
      const sendingDomains = await db
        .select()
        .from(schema.sendingDomain)
        .where(eq(schema.sendingDomain.workspaceId, workspaceID));
      const verifiedDomain =
        sendingDomains.find((d) => d.dnsStatus === 'verified') ?? sendingDomains[0];

      const priorMessages = await db
        .select({
          id: schema.outboundMessage.id,
          rfcMessageId: schema.outboundMessage.rfcMessageId,
        })
        .from(schema.outboundMessage)
        .where(eq(schema.outboundMessage.ticketId, ticketID))
        .orderBy(asc(schema.outboundMessage.createdAt));

      // Suppression check — same step so we can short-circuit cleanly.
      const [supp] = await db
        .select()
        .from(schema.suppression)
        .where(
          and(
            eq(schema.suppression.workspaceId, workspaceID),
            eq(schema.suppression.emailAddress, cust.email),
          ),
        )
        .limit(1);

      return {
        skip: undefined,
        outboxRow,
        msg,
        tkt,
        cust,
        org,
        sendingDomain: verifiedDomain ?? null,
        priorMessages,
        suppressed: Boolean(supp),
      } as const;
    });

    if ('skip' in loaded && loaded.skip === 'already-processed') {
      logger.info('outbox already processed; skipping', { outboxID });
      return { skipped: 'already-processed' as const };
    }
    if (loaded.skip) return { skipped: loaded.skip };

    if (!loaded.sendingDomain) {
      // No sending domain configured at all — surface as failed; the workspace
      // needs to add one in Settings → Email domains. Mark outbox processed so
      // we don't retry forever.
      await step.run('mark-no-domain', async () => {
        const db = getDb();
        await db
          .update(schema.outbox)
          .set({ processedAt: new Date() })
          .where(eq(schema.outbox.id, outboxID));
      });
      logger.warn('no sending domain configured for workspace', { workspaceID });
      return { skipped: 'no-sending-domain' as const };
    }

    // ---------- Step 2: persist suppression decision ----------
    if (loaded.suppressed) {
      await step.run('record-suppressed', async () => {
        const db = getDb();
        await db.insert(schema.outboundMessage).values({
          workspaceId: workspaceID,
          ticketId: ticketID,
          messageId: messageID,
          rfcMessageId: `<suppressed-${outboxID}@local>`,
          fromAddress: '',
          toAddress: loaded.cust.email,
          replyTo: '',
          subject: loaded.tkt.title,
          status: 'suppressed',
        });
        await db
          .update(schema.outbox)
          .set({ processedAt: new Date() })
          .where(eq(schema.outbox.id, outboxID));
      });
      logger.info('recipient suppressed; skipped', {
        workspaceID,
        email: loaded.cust.email,
      });
      return { skipped: 'suppressed' as const };
    }

    // ---------- Step 3: build envelope ----------
    const built = await step.run('build-envelope', async () => {
      const priors: PriorMessage[] = loaded.priorMessages.map((p: { rfcMessageId: string }) => ({
        rfcMessageID: p.rfcMessageId,
      }));
      const env = buildEnvelope({
        workspace: { id: loaded.org.id, name: loaded.org.name, slug: loaded.org.slug },
        ticket: {
          id: loaded.tkt.id,
          shortID: loaded.tkt.shortId,
          title: loaded.tkt.title,
        },
        message: {
          id: loaded.msg.id,
          bodyHtml: loaded.msg.bodyHtml,
          bodyText: loaded.msg.bodyText,
        },
        customer: {
          email: loaded.cust.email,
          name: loaded.cust.name,
          displayName: loaded.cust.displayName,
        },
        sendingDomain: { domain: loaded.sendingDomain.domain },
        priorMessages: priors,
        // Placeholder — Phase 3b/c signs this token like the reply-plus.
        unsubscribeToken: `${workspaceID}.${loaded.cust.id}`,
      });
      return env;
    });

    // ---------- Step 4: persist outbound_message row (status: 'sending') ----------
    const outboundRowID = await step.run('persist-sending', async () => {
      const db = getDb();
      const [row] = await db
        .insert(schema.outboundMessage)
        .values({
          workspaceId: workspaceID,
          ticketId: ticketID,
          messageId: messageID,
          rfcMessageId: built.rfcMessageID,
          fromAddress: built.from,
          toAddress: built.to,
          replyTo: built.replyTo,
          subject: built.subject,
          status: 'sending',
        })
        .returning({ id: schema.outboundMessage.id });
      return row?.id ?? null;
    });

    // ---------- Step 5: send ----------
    try {
      const result = await step.run('send', async () => sendRawEmail(built));

      await step.run('mark-sent', async () => {
        const db = getDb();
        if (outboundRowID) {
          await db
            .update(schema.outboundMessage)
            .set({
              status: 'sent',
              sesMessageId: result.providerMessageID,
              sentAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(schema.outboundMessage.id, outboundRowID));
        }
        await db
          .update(schema.outbox)
          .set({ processedAt: new Date() })
          .where(eq(schema.outbox.id, outboxID));
      });

      return { ok: true, providerMessageID: result.providerMessageID };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      await step.run('mark-failed', async () => {
        const db = getDb();
        if (outboundRowID) {
          await db
            .update(schema.outboundMessage)
            .set({ status: 'failed', error: errMsg, updatedAt: new Date() })
            .where(eq(schema.outboundMessage.id, outboundRowID));
        }
      });
      // Re-throw so Inngest's retry policy kicks in.
      throw err;
    }
  },
);
