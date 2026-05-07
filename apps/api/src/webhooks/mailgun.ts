// Mailgun event-webhook ingest. Mirrors webhooks/ses.ts.
//
// Mailgun POSTs a JSON body with a top-level `signature: { timestamp, token,
// signature }` and an `event-data` object. We HMAC-verify, look up the
// originating outbound_message by Message-ID, persist a `webhook_event` row,
// and dispatch the same Inngest `provider/webhook.received` event the SES
// path uses — provider-webhook.ts branches on `webhook_event.source`.
//
// Auth: HMAC-SHA256(timestamp + token) with MAILGUN_WEBHOOK_SIGNING_KEY.
// The signing key is *not* the API key; configure it under Mailgun →
// Settings → API Security → "HTTP webhook signing key".

import { randomUUID } from 'node:crypto';
import { getClient } from '@salve/db';
import type { Context } from 'hono';
import { verifyMailgunSig } from '../email/mailgun.js';
import { inngest } from '../inngest/client.js';
import { PROVIDER_EVENT } from '../inngest/events.js';

interface MailgunEventBody {
  signature?: { timestamp?: string; token?: string; signature?: string };
  'event-data'?: {
    event?: string;
    severity?: string;
    timestamp?: number;
    id?: string;
    message?: { headers?: { 'message-id'?: string } };
    recipient?: string;
    'delivery-status'?: { code?: number; description?: string; message?: string };
  };
}

export async function handleMailgunWebhook(c: Context): Promise<Response> {
  const body = (await c.req.raw.json().catch(() => null)) as MailgunEventBody | null;
  if (!body) return c.json({ error: 'invalid-json' }, 400);

  const sig = body.signature;
  if (!sig?.timestamp || !sig.token || !sig.signature) {
    return c.json({ error: 'missing-signature' }, 401);
  }
  if (
    !verifyMailgunSig({
      timestamp: sig.timestamp,
      token: sig.token,
      signature: sig.signature,
    })
  ) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  const eventData = body['event-data'];
  const rawMessageId = eventData?.message?.headers?.['message-id'] ?? null;
  // Mailgun reports message-id without angle brackets in event payloads, but
  // strip defensively in case the format changes.
  const providerMessageID = rawMessageId ? rawMessageId.replace(/^<|>$/g, '') : null;
  const eventType = (eventData?.event ?? 'unknown').toLowerCase();

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
      'mailgun',
      ${eventType},
      ${providerMessageID ?? null},
      ${JSON.stringify(body)}::jsonb,
      now()
    )
  `;

  if (match) {
    await inngest.send({
      id: `webhook-${webhookEventID}`,
      name: PROVIDER_EVENT.WEBHOOK_RECEIVED,
      data: {
        webhookEventID,
        source: 'mailgun',
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
