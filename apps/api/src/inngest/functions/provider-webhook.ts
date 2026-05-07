import { getClient } from '@salve/db';
import type postgres from 'postgres';
import { inngest } from '../client.js';
import { DELIVERY_EVENT, PROVIDER_EVENT, providerWebhookReceivedDataSchema } from '../events.js';

type Sql = postgres.Sql<Record<string, unknown>>;

interface WebhookEventRow {
  id: string;
  workspace_id: string | null;
  channel_id: string | null;
  source: string;
  payload: unknown;
}

interface MailgunEventData {
  event?: string;
  severity?: string;
  recipient?: string;
  message?: { headers?: { 'message-id'?: string } };
  'delivery-status'?: { code?: number; description?: string; message?: string };
}

interface SesNotification {
  notificationType?: string;
  eventType?: string;
  mail?: {
    messageId?: string;
    destination?: string[];
  };
  delivery?: {
    timestamp?: string;
    recipients?: string[];
  };
  bounce?: {
    bounceType?: string;
    bounceSubType?: string;
    bouncedRecipients?: Array<{ emailAddress?: string; status?: string; diagnosticCode?: string }>;
  };
  complaint?: {
    complaintFeedbackType?: string;
    complainedRecipients?: Array<{ emailAddress?: string }>;
  };
}

interface StatusUpdate {
  kind: 'delivered' | 'bounced' | 'complained';
  workspaceID: string;
  channelID: string;
  providerMessageID: string;
  recipient?: string;
  hard?: boolean;
  code?: string;
}

export const processProviderWebhook = inngest.createFunction(
  {
    id: 'process-provider-webhook',
    name: 'Process provider webhook',
    retries: 4,
    // Pre-launch: capped at 5 (Inngest free plan). Bump back to 50 on Pro.
    batchEvents: { maxSize: 5, timeout: '2s', key: 'event.data.source' },
    triggers: [{ event: PROVIDER_EVENT.WEBHOOK_RECEIVED }],
  },
  // biome-ignore lint/suspicious/noExplicitAny: Inngest batch typing is version-sensitive; each event is Zod-validated below.
  async ({ events, event, step }: any) => {
    const incoming = events ?? [event];
    const parsed: Array<{ webhookEventID: string; source: string }> = incoming.map(
      (e: { data: unknown }) => providerWebhookReceivedDataSchema.parse(e.data),
    );

    const rows: WebhookEventRow[] = await step.run('load-webhook-events', async () =>
      loadWebhookEvents(
        getClient(),
        parsed.map((p) => p.webhookEventID),
      ),
    );

    const updates: StatusUpdate[] = await step.run('apply-provider-events', async () => {
      const out: StatusUpdate[] = [];
      for (const row of rows) {
        if (row.source === 'mailgun') {
          const eventData = unwrapMailgunEventData(row.payload);
          const providerMessageID = eventData?.message?.headers?.['message-id']?.replace(
            /^<|>$/g,
            '',
          );
          if (!eventData || !providerMessageID) continue;
          const applied = await applyMailgunEvent(getClient(), row, providerMessageID, eventData);
          if (applied) out.push(...applied);
          continue;
        }
        const notification = unwrapSesNotification(row.payload);
        if (!notification) continue;
        const providerMessageID = notification.mail?.messageId;
        if (!providerMessageID) continue;
        const applied = await applySesNotification(
          getClient(),
          row,
          providerMessageID,
          notification,
        );
        if (applied) out.push(...applied);
      }
      return out;
    });

    await step.run('mark-webhooks-processed', async () =>
      markWebhookEventsProcessed(
        getClient(),
        rows.map((row) => row.id),
      ),
    );

    await step.run('emit-delivery-status-events', async () => {
      for (const update of updates) {
        if (update.kind === 'delivered') {
          await step.sendEvent(`delivered-${update.providerMessageID}`, {
            id: `prov-delivered-${update.providerMessageID}`,
            name: DELIVERY_EVENT.MESSAGE_DELIVERED,
            data: {
              workspaceID: update.workspaceID,
              channelID: update.channelID,
              providerMessageID: update.providerMessageID,
              deliveredAt: new Date().toISOString(),
            },
          });
        } else if (update.kind === 'bounced') {
          await step.sendEvent(
            `bounced-${update.providerMessageID}-${update.recipient ?? 'unknown'}`,
            {
              id: `prov-bounced-${update.providerMessageID}-${update.recipient ?? 'unknown'}`,
              name: DELIVERY_EVENT.MESSAGE_BOUNCED,
              data: {
                workspaceID: update.workspaceID,
                channelID: update.channelID,
                providerMessageID: update.providerMessageID,
                hard: update.hard ?? false,
                recipient: update.recipient,
                code: update.code,
              },
            },
          );
        } else {
          await step.sendEvent(`complained-${update.providerMessageID}`, {
            id: `prov-complained-${update.providerMessageID}`,
            name: DELIVERY_EVENT.MESSAGE_COMPLAINED,
            data: {
              workspaceID: update.workspaceID,
              channelID: update.channelID,
              providerMessageID: update.providerMessageID,
              recipient: update.recipient,
            },
          });
        }
      }
    });

    return { processed: rows.length, emitted: updates.length };
  },
);

async function loadWebhookEvents(sql: Sql, ids: string[]): Promise<WebhookEventRow[]> {
  if (ids.length === 0) return [];
  return sql<WebhookEventRow[]>`
    SELECT id, workspace_id, channel_id, source, payload
    FROM webhook_event
    WHERE id = ANY(${ids})
      AND processed_at IS NULL
  `;
}

function unwrapMailgunEventData(raw: unknown): MailgunEventData | null {
  if (!raw || typeof raw !== 'object') return null;
  const eventData = (raw as { 'event-data'?: unknown })['event-data'];
  if (!eventData || typeof eventData !== 'object') return null;
  return eventData as MailgunEventData;
}

async function applyMailgunEvent(
  sql: Sql,
  row: WebhookEventRow,
  providerMessageID: string,
  eventData: MailgunEventData,
): Promise<StatusUpdate[] | null> {
  const matches = await sql<
    Array<{ id: string; workspace_id: string; channel_id: string; provider_message_id: string }>
  >`
    SELECT id, workspace_id, channel_id, provider_message_id
    FROM outbound_message
    WHERE provider_message_id = ${providerMessageID}
    LIMIT 1
  `;
  const outbound = matches[0];
  if (!outbound) return null;

  const workspaceID = outbound.workspace_id;
  const channelID = outbound.channel_id;
  const meta = { provider: 'mailgun', eventData };
  const event = (eventData.event ?? '').toLowerCase();
  const recipient = eventData.recipient;
  const code = eventData['delivery-status']?.description ?? eventData['delivery-status']?.message;

  if (event === 'delivered') {
    await sql`
      UPDATE outbound_message
      SET status = 'delivered',
          delivered_at = now(),
          provider_meta = COALESCE(provider_meta, '{}'::jsonb) || ${JSON.stringify(asJson(meta))}::jsonb,
          updated_at = now()
      WHERE id = ${outbound.id}
    `;
    return [{ kind: 'delivered', workspaceID, channelID, providerMessageID }];
  }

  if (event === 'failed') {
    // Mailgun's `severity` field maps directly: 'permanent' = hard bounce,
    // 'temporary' = soft bounce. Soft bounces don't write to suppression.
    const hard = (eventData.severity ?? '').toLowerCase() === 'permanent';
    await sql`
      UPDATE outbound_message
      SET status = 'bounced',
          provider_meta = COALESCE(provider_meta, '{}'::jsonb) || ${JSON.stringify(asJson(meta))}::jsonb,
          updated_at = now()
      WHERE id = ${outbound.id}
    `;
    if (hard && recipient) {
      await upsertSuppression(sql, {
        workspaceID,
        channelID,
        target: recipient,
        reason: 'hard_bounce',
      });
    }
    return [
      {
        kind: 'bounced',
        workspaceID,
        channelID,
        providerMessageID,
        recipient,
        hard,
        code,
      },
    ];
  }

  if (event === 'complained') {
    await sql`
      UPDATE outbound_message
      SET status = 'complained',
          provider_meta = COALESCE(provider_meta, '{}'::jsonb) || ${JSON.stringify(asJson(meta))}::jsonb,
          updated_at = now()
      WHERE id = ${outbound.id}
    `;
    if (recipient) {
      await upsertSuppression(sql, {
        workspaceID,
        channelID,
        target: recipient,
        reason: 'complaint',
      });
    }
    return [{ kind: 'complained', workspaceID, channelID, providerMessageID, recipient }];
  }

  if (event === 'unsubscribed' && recipient) {
    await upsertSuppression(sql, {
      workspaceID,
      channelID,
      target: recipient,
      reason: 'unsubscribe',
    });
    // Treat unsubscribe like a complaint for downstream telemetry — same
    // outcome (don't send to this address again).
    return [{ kind: 'complained', workspaceID, channelID, providerMessageID, recipient }];
  }

  // Unknown / accepted / opened / clicked — no state change. Mark the row
  // so we don't reprocess.
  await sql`
    UPDATE webhook_event
    SET payload = ${JSON.stringify(asJson({ ...(row.payload as Record<string, unknown>), ignoredEvent: event }))}::jsonb
    WHERE id = ${row.id}
  `;
  return null;
}

function unwrapSesNotification(raw: unknown): SesNotification | null {
  if (!raw || typeof raw !== 'object') return null;
  const maybeSns = raw as { Message?: unknown };
  if (typeof maybeSns.Message === 'string') {
    try {
      return JSON.parse(maybeSns.Message) as SesNotification;
    } catch {
      return null;
    }
  }
  return raw as SesNotification;
}

async function applySesNotification(
  sql: Sql,
  row: WebhookEventRow,
  providerMessageID: string,
  notification: SesNotification,
): Promise<StatusUpdate[] | null> {
  const matches = await sql<
    Array<{ id: string; workspace_id: string; channel_id: string; provider_message_id: string }>
  >`
    SELECT id, workspace_id, channel_id, provider_message_id
    FROM outbound_message
    WHERE provider_message_id = ${providerMessageID}
    LIMIT 1
  `;
  const outbound = matches[0];
  if (!outbound) return null;

  const workspaceID = outbound.workspace_id;
  const channelID = outbound.channel_id;
  const statusType = notification.notificationType ?? notification.eventType;
  const meta = { provider: 'ses', notification };

  if (statusType === 'Delivery') {
    await sql`
      UPDATE outbound_message
      SET status = 'delivered',
          delivered_at = now(),
          provider_meta = COALESCE(provider_meta, '{}'::jsonb) || ${JSON.stringify(asJson(meta))}::jsonb,
          updated_at = now()
      WHERE id = ${outbound.id}
    `;
    return [
      {
        kind: 'delivered',
        workspaceID,
        channelID,
        providerMessageID,
      },
    ];
  }

  if (statusType === 'Bounce') {
    const hard = notification.bounce?.bounceType !== 'Transient';
    const recipients = notification.bounce?.bouncedRecipients ?? [];
    await sql`
      UPDATE outbound_message
      SET status = 'bounced',
          provider_meta = COALESCE(provider_meta, '{}'::jsonb) || ${JSON.stringify(asJson(meta))}::jsonb,
          updated_at = now()
      WHERE id = ${outbound.id}
    `;
    if (hard) {
      for (const recipient of recipients) {
        if (recipient.emailAddress) {
          await upsertSuppression(sql, {
            workspaceID,
            channelID,
            target: recipient.emailAddress,
            reason: 'hard_bounce',
          });
        }
      }
    }
    return recipients.map((recipient) => ({
      kind: 'bounced' as const,
      workspaceID,
      channelID,
      providerMessageID,
      recipient: recipient.emailAddress,
      hard,
      code: recipient.status ?? recipient.diagnosticCode,
    }));
  }

  if (statusType === 'Complaint') {
    const recipients = notification.complaint?.complainedRecipients ?? [];
    await sql`
      UPDATE outbound_message
      SET status = 'complained',
          provider_meta = COALESCE(provider_meta, '{}'::jsonb) || ${JSON.stringify(asJson(meta))}::jsonb,
          updated_at = now()
      WHERE id = ${outbound.id}
    `;
    for (const recipient of recipients) {
      if (recipient.emailAddress) {
        await upsertSuppression(sql, {
          workspaceID,
          channelID,
          target: recipient.emailAddress,
          reason: 'complaint',
        });
      }
    }
    return recipients.map((recipient) => ({
      kind: 'complained' as const,
      workspaceID,
      channelID,
      providerMessageID,
      recipient: recipient.emailAddress,
    }));
  }

  await sql`
    UPDATE webhook_event
    SET payload = ${JSON.stringify(asJson({ ...(row.payload as Record<string, unknown>), ignoredStatusType: statusType }))}::jsonb
    WHERE id = ${row.id}
  `;
  return null;
}

function asJson(value: unknown): postgres.JSONValue {
  return JSON.parse(JSON.stringify(value)) as postgres.JSONValue;
}

async function upsertSuppression(
  sql: Sql,
  args: { workspaceID: string; channelID: string; target: string; reason: string },
): Promise<void> {
  await sql`
    INSERT INTO suppression (workspace_id, channel_id, target, reason)
    VALUES (${args.workspaceID}, ${args.channelID}, ${args.target}, ${args.reason})
    ON CONFLICT (workspace_id, channel_id, target) DO UPDATE
    SET reason = EXCLUDED.reason
  `;
}

async function markWebhookEventsProcessed(sql: Sql, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await sql`
    UPDATE webhook_event
    SET processed_at = now()
    WHERE id = ANY(${ids})
  `;
}
