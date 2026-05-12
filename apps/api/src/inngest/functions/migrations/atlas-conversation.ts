// migration/atlas.conversation
//
// One execution per Atlas conversation. Fetches the header (or relies on the
// list cache — v0 always re-fetches for simplicity) + all messages, then runs
// the persist transaction. Idempotency-keyed by (runId, conversationId) so
// retries are free.

import { randomUUID } from 'node:crypto';
import { getClient } from '@salve/db';
import { AtlasClient, toCanonicalMessage, toCanonicalTicket } from '@salve/migration-atlas';
import { type UploadedAttachment, uploadAtlasAttachment } from '../../../migrations/attachments.js';
import { persistConversation } from '../../../migrations/persist.js';
import { inngest } from '../../client.js';
import { MIGRATION_EVENT, migrationAtlasConversationDataSchema } from '../../events.js';

const SOURCE = 'atlas';

export const migrationAtlasConversation = inngest.createFunction(
  {
    id: 'migration-atlas-conversation',
    name: 'Migration · Atlas · conversation',
    retries: 4,
    concurrency: [{ scope: 'fn', key: 'event.data.runId', limit: 4 }],
    throttle: { key: 'event.data.runId', limit: 8, period: '1s' },
    idempotency: 'event.data.runId + "/" + event.data.conversationId',
    triggers: [{ event: MIGRATION_EVENT.ATLAS_CONVERSATION }],
  },
  // biome-ignore lint/suspicious/noExplicitAny: Inngest 4 event typing kept local.
  async ({ event, step, logger }: any) => {
    const data = migrationAtlasConversationDataSchema.parse(event.data);
    const sql = getClient();

    // Re-read credentials from `secrets.migration_credential`. Event payloads
    // intentionally carry only IDs (see events.ts), and Zero never sees this
    // schema (see packages/db/src/schema/migration.ts header).
    const credRows = await sql<{ api_key: string; base_url: string | null }[]>`
      SELECT c.api_key, c.base_url
      FROM secrets.migration_credential c
      JOIN migration_run r ON r.id = c.run_id
      WHERE c.run_id = ${data.runId} AND r.workspace_id = ${data.workspaceID}
      LIMIT 1
    `;
    const cred = credRows[0];
    if (!cred?.api_key) {
      logger.error('migration_run missing apiKey on conversation', { runId: data.runId });
      return { ok: false, reason: 'no-api-key' };
    }
    const atlas = new AtlasClient({ apiKey: cred.api_key, baseUrl: cred.base_url ?? undefined });

    const header = await step.run('fetch-conversation', async () =>
      atlas.getConversation(data.conversationId),
    );
    const messages = await step.run('fetch-messages', async () =>
      atlas.listAllMessages(data.conversationId),
    );

    const canonicalTicket = toCanonicalTicket(header);
    // step.run loses generic types in the `any`-typed handler; pin the array
    // shape so .flatMap downstream doesn't infer `any`.
    const canonicalMessages: ReturnType<typeof toCanonicalMessage>[] =
      messages.map(toCanonicalMessage);

    // Upload attachments to our S3 BEFORE the persist tx — so the tx stays
    // short. Each attachment's HTTP fetch is wrapped in its own step.run so
    // an oversize/404 file doesn't fail the whole conversation.
    const refs = canonicalMessages.flatMap((m) => m.attachments);
    // Stable synthetic ticketId for the S3 key prefix when the conversation
    // turns out to be a fresh insert. Generated upstream of persist so the
    // S3 keys we build now match what the persist tx will use.
    const ticketIdHint = await step.run('alloc-ticket-id-for-uploads', async () => randomUUID());

    const uploadedEntries = await step.run('upload-attachments', async () => {
      const out: Array<[string, UploadedAttachment]> = [];
      for (const ref of refs) {
        const lookupKey = ref.handle ?? ref.url;
        try {
          const u = await uploadAtlasAttachment({
            workspaceId: data.workspaceID,
            attachment: ref,
            ticketId: ticketIdHint,
          });
          if (u) out.push([lookupKey, u]);
        } catch (err) {
          logger.warn('atlas attachment upload failed', {
            url: ref.url,
            err: err instanceof Error ? err.message : String(err),
          });
        }
      }
      return out;
    });
    const attachmentMap = new Map<string, UploadedAttachment>(uploadedEntries);

    const result = await step.run('persist', async () =>
      persistConversation(
        { workspaceId: data.workspaceID, source: SOURCE, runId: data.runId },
        canonicalTicket,
        canonicalMessages,
        attachmentMap,
      ),
    );

    await step.run('bump-counters', async () => {
      const ticketKey = result.reused ? 'tickets_reused' : 'tickets_imported';
      await sql`
        UPDATE migration_run SET
          counters = counters
            || jsonb_build_object(
                 ${ticketKey}::text,
                 COALESCE((counters ->> ${ticketKey}::text)::int, 0) + 1,
                 'messages_imported'::text,
                 COALESCE((counters ->> 'messages_imported')::int, 0) + ${result.messagesInserted}::int,
                 'messages_skipped'::text,
                 COALESCE((counters ->> 'messages_skipped')::int, 0) + ${result.messagesSkipped}::int,
                 'ticket_field_values'::text,
                 COALESCE((counters ->> 'ticket_field_values')::int, 0) + ${result.ticketFieldValues}::int,
                 'customer_field_values'::text,
                 COALESCE((counters ->> 'customer_field_values')::int, 0) + ${result.customerFieldValues}::int,
                 'ticket_tags_applied'::text,
                 COALESCE((counters ->> 'ticket_tags_applied')::int, 0) + ${result.ticketTagsApplied}::int,
                 'attachments_inserted'::text,
                 COALESCE((counters ->> 'attachments_inserted')::int, 0) + ${result.attachmentsInserted}::int
               ),
          updated_at = now()
        WHERE id = ${data.runId}
      `;
    });

    // Reconcile run completion atomically. The WHERE clause includes
    // `status = 'backfilling'`, so concurrent winners are no-ops on the
    // second-and-later UPDATE (idempotent flip). `discovered` is set by
    // atlas-start once it knows the headers.length; once imported+reused
    // catches up to it, the run is done.
    await step.run('check-completion', async () => {
      await sql`
        UPDATE migration_run SET
          status = 'completed',
          completed_at = now(),
          updated_at = now()
        WHERE id = ${data.runId}
          AND status = 'backfilling'
          AND COALESCE((counters ->> 'discovered')::int, 0) > 0
          AND COALESCE((counters ->> 'tickets_imported')::int, 0)
            + COALESCE((counters ->> 'tickets_reused')::int, 0)
            >= COALESCE((counters ->> 'discovered')::int, 0)
      `;
    });

    logger.info('imported atlas conversation', {
      runId: data.runId,
      conversationId: data.conversationId,
      ticketId: result.ticketId,
      reused: result.reused,
      messagesInserted: result.messagesInserted,
      messagesSkipped: result.messagesSkipped,
    });

    return { ok: true, ticketId: result.ticketId, ...result };
  },
);
