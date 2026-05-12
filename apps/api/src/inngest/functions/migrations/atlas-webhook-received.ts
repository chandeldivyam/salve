// migration/atlas.webhook.received
//
// Triggered once per inbox row inserted by the webhook receiver. Loads the
// row, decides whether the event is in scope (Phase 4a: status, priority,
// tags, message), runs the apply path, marks the inbox row processed.
//
// Lazy-expand: a `conversation.message` event for an unmapped conversation
// dispatches the existing `migration/atlas.conversation` event to backfill
// just that one ticket — its idempotent persist tx then absorbs the new
// message without us having to re-apply the webhook.

import { getClient } from '@salve/db';
import {
  type ParsedAtlasWebhookEvent,
  PHASE_4A_EVENTS,
  parseAtlasWebhookPayload,
} from '@salve/migration-atlas';
import {
  applyConversationMessage,
  applyConversationPriority,
  applyConversationStatus,
  applyConversationTags,
} from '../../../migrations/webhook-apply.js';
import { inngest } from '../../client.js';
import { MIGRATION_EVENT, migrationAtlasWebhookReceivedDataSchema } from '../../events.js';

interface InboxRow {
  id: string;
  workspace_id: string;
  run_id: string | null;
  source: string;
  subscription_id: string | null;
  event_type: string;
  payload: Record<string, unknown>;
  processed_at: Date | null;
  attempt_count: number;
}

interface RunHasCredRow {
  id: string;
  has_credential: boolean;
}

export const migrationAtlasWebhookReceived = inngest.createFunction(
  {
    id: 'migration-atlas-webhook-received',
    name: 'Migration · Atlas · webhook received',
    retries: 4,
    concurrency: [{ scope: 'fn', key: 'event.data.workspaceID', limit: 8 }],
    triggers: [{ event: MIGRATION_EVENT.ATLAS_WEBHOOK_RECEIVED }],
  },
  // biome-ignore lint/suspicious/noExplicitAny: Inngest 4 event typing kept local.
  async ({ event, step, logger }: any) => {
    const data = migrationAtlasWebhookReceivedDataSchema.parse(event.data);
    const sql = getClient();

    const rows = await sql<InboxRow[]>`
      SELECT id, workspace_id, run_id, source, subscription_id, event_type,
             payload, processed_at, attempt_count
      FROM migration_event_inbox
      WHERE id = ${data.inboxId}
      LIMIT 1
    `;
    const inbox = rows[0];
    if (!inbox) {
      logger.warn('atlas webhook inbox row missing', { inboxId: data.inboxId });
      return { ok: false, reason: 'inbox-missing' };
    }
    if (inbox.workspace_id !== data.workspaceID) {
      logger.error('atlas webhook workspace mismatch', {
        inboxId: data.inboxId,
        rowWorkspace: inbox.workspace_id,
        eventWorkspace: data.workspaceID,
      });
      return { ok: false, reason: 'workspace-mismatch' };
    }
    if (inbox.processed_at) {
      return { ok: true, skipped: 'already-processed' };
    }

    // Phase 4a guard: only the four canonical events get applied. Everything
    // else (or anything we couldn't parse) gets stamped processed with an
    // explanatory error_kind so it shows up clearly in the inbox query but
    // doesn't churn through retries.
    let parsed: ParsedAtlasWebhookEvent;
    try {
      parsed = parseAtlasWebhookPayload(inbox.payload);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await markInboxFailed(sql, inbox.id, 'parse-error', msg);
      logger.warn('atlas webhook parse failed', { inboxId: inbox.id, msg });
      return { ok: false, reason: 'parse-error' };
    }

    if (parsed.kind === 'unknown' || parsed.kind === 'customer') {
      await markInboxNotSubscribed(sql, inbox.id, parsed.event ?? inbox.event_type);
      return { ok: true, skipped: 'event-not-subscribed-phase-4a' };
    }
    if (!PHASE_4A_EVENTS.has(parsed.event)) {
      await markInboxNotSubscribed(sql, inbox.id, parsed.event);
      return { ok: true, skipped: 'event-not-subscribed-phase-4a' };
    }

    const ctx = {
      workspaceId: inbox.workspace_id,
      runId: inbox.run_id ?? '',
    };

    try {
      if (parsed.event === 'conversation.status') {
        const r = await step.run('apply-status', async () =>
          applyConversationStatus(ctx, parsed.data),
        );
        logger.info('atlas webhook applied status', { inboxId: inbox.id, ...r });
      } else if (parsed.event === 'conversation.priority') {
        const r = await step.run('apply-priority', async () =>
          applyConversationPriority(ctx, parsed.data),
        );
        logger.info('atlas webhook applied priority', { inboxId: inbox.id, ...r });
      } else if (parsed.event === 'conversation.tags') {
        const r = await step.run('apply-tags', async () => applyConversationTags(ctx, parsed.data));
        logger.info('atlas webhook applied tags', { inboxId: inbox.id, ...r });
      } else if (parsed.event === 'conversation.message') {
        const r = await step.run('apply-message', async () =>
          applyConversationMessage(ctx, parsed.data),
        );
        if (r.kind === 'lazy-expand-needed') {
          await dispatchLazyExpand(step, sql, inbox, r.conversationId, logger);
        }
        logger.info('atlas webhook applied message', { inboxId: inbox.id, kind: r.kind });
      }

      await step.run('mark-processed', async () => {
        await sql`
          UPDATE migration_event_inbox
          SET processed_at = now(), error = NULL, error_kind = NULL,
              attempt_count = attempt_count + 1
          WHERE id = ${inbox.id}
        `;
      });
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await sql`
        UPDATE migration_event_inbox
        SET error = ${msg}, error_kind = 'apply-failed',
            attempt_count = attempt_count + 1
        WHERE id = ${inbox.id}
      `;
      throw err; // let Inngest retry
    }
  },
);

async function markInboxFailed(
  sql: ReturnType<typeof getClient>,
  inboxId: string,
  kind: string,
  message: string,
): Promise<void> {
  await sql`
    UPDATE migration_event_inbox
    SET processed_at = now(), error = ${message}, error_kind = ${kind},
        attempt_count = attempt_count + 1
    WHERE id = ${inboxId}
  `;
}

async function markInboxNotSubscribed(
  sql: ReturnType<typeof getClient>,
  inboxId: string,
  event: string,
): Promise<void> {
  await sql`
    UPDATE migration_event_inbox
    SET processed_at = now(), error_kind = 'event-not-subscribed', error = ${event},
        attempt_count = attempt_count + 1
    WHERE id = ${inboxId}
  `;
}

async function dispatchLazyExpand(
  // biome-ignore lint/suspicious/noExplicitAny: same Inngest 4 typing concession.
  step: any,
  sql: ReturnType<typeof getClient>,
  inbox: InboxRow,
  conversationId: string,
  // biome-ignore lint/suspicious/noExplicitAny: logger is the Inngest one.
  logger: any,
): Promise<void> {
  if (!inbox.run_id) {
    logger.warn('atlas webhook lazy-expand: subscription has no run_id', {
      inboxId: inbox.id,
      conversationId,
    });
    return;
  }
  // Probe — only dispatch if the run actually has credentials, so the
  // conversation function can complete. The function itself re-reads the
  // apiKey from secrets.migration_credential; we just check presence here.
  const runs = await sql<RunHasCredRow[]>`
    SELECT r.id, (c.run_id IS NOT NULL) AS has_credential
    FROM migration_run r
    LEFT JOIN secrets.migration_credential c ON c.run_id = r.id
    WHERE r.id = ${inbox.run_id}
    LIMIT 1
  `;
  if (!runs[0]?.has_credential) {
    logger.warn('atlas webhook lazy-expand: no apiKey on run', {
      inboxId: inbox.id,
      runId: inbox.run_id,
      conversationId,
    });
    return;
  }
  await step.sendEvent('lazy-expand', {
    id: `mig-conv-${inbox.run_id}-${conversationId}`,
    name: MIGRATION_EVENT.ATLAS_CONVERSATION,
    data: {
      runId: inbox.run_id,
      workspaceID: inbox.workspace_id,
      conversationId,
    },
  });
  logger.info('atlas webhook lazy-expand dispatched', {
    inboxId: inbox.id,
    runId: inbox.run_id,
    conversationId,
  });
}
