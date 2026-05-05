import { randomUUID } from 'node:crypto';
import { getClient } from '@salve/db';
import type { Context } from 'hono';
import { inngest } from '../inngest/client.js';
import { PROVIDER_EVENT } from '../inngest/events.js';

interface SesSnsBody {
  Type?: string;
  Message?: string;
  SubscribeURL?: string;
}

interface SesNotification {
  notificationType?: string;
  eventType?: string;
  mail?: {
    messageId?: string;
  };
}

export async function handleSesWebhook(c: Context): Promise<Response> {
  // The webhook lets external callers write `webhook_event` rows for any
  // `provider_message_id` and fan out an Inngest job that touches whatever
  // workspace owns that ID. With no secret configured ANY request would be
  // accepted — that's a cross-tenant write. Require the secret
  // unconditionally; refuse with 500 if env is mis-configured rather than
  // silently allowing forged notifications.
  const secret = process.env.SES_WEBHOOK_SECRET;
  if (!secret) {
    return c.json({ error: 'webhook-secret-required' }, 500);
  }
  if (c.req.header('x-salve-webhook-secret') !== secret) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  const raw = (await c.req.raw.json().catch(() => null)) as SesSnsBody | null;
  if (!raw) return c.json({ error: 'invalid-json' }, 400);

  if (raw.Type === 'SubscriptionConfirmation') {
    if (process.env.SES_SNS_AUTO_CONFIRM === '1' && raw.SubscribeURL) {
      try {
        await fetch(raw.SubscribeURL);
      } catch (error) {
        // SNS retries the confirmation, so a single failed fetch is not
        // fatal. Log and surface so an operator can investigate; never
        // 200-OK a confirmation we didn't actually fetch.
        console.error('[ses-webhook] auto-confirm fetch failed', error);
        return c.json({ error: 'auto-confirm-failed' }, 502);
      }
    }
    return c.json({ ok: true, subscriptionConfirmation: true });
  }

  const notification = unwrapNotification(raw);
  const providerMessageID = notification?.mail?.messageId;
  const sql = getClient();
  const matches = providerMessageID
    ? await sql<Array<{ workspace_id: string; channel_id: string }>>`
        SELECT workspace_id, channel_id
        FROM outbound_message
        WHERE provider_message_id = ${providerMessageID}
        LIMIT 1
      `
    : [];
  const match = matches[0] ?? null;

  const webhookEventID = randomUUID();
  const eventType = (
    notification?.notificationType ??
    notification?.eventType ??
    'unknown'
  ).toLowerCase();
  await sql`
    INSERT INTO webhook_event (
      id,
      workspace_id,
      channel_id,
      source,
      event_type,
      provider_message_id,
      payload,
      created_at
    )
    VALUES (
      ${webhookEventID},
      ${match?.workspace_id ?? null},
      ${match?.channel_id ?? null},
      'ses',
      ${eventType},
      ${providerMessageID ?? null},
      ${JSON.stringify(raw)}::jsonb,
      now()
    )
  `;

  if (match) {
    await inngest.send({
      id: `webhook-${webhookEventID}`,
      name: PROVIDER_EVENT.WEBHOOK_RECEIVED,
      data: {
        webhookEventID,
        source: 'ses',
      },
    });
  }

  return c.json({
    ok: true,
    webhookEventID,
    queued: Boolean(match),
    ignored: match
      ? undefined
      : providerMessageID
        ? 'unknown-provider-message-id'
        : 'missing-provider-message-id',
  });
}

function unwrapNotification(raw: SesSnsBody): SesNotification | null {
  if (!raw.Message) return raw as SesNotification;
  try {
    return JSON.parse(raw.Message) as SesNotification;
  } catch {
    return null;
  }
}
