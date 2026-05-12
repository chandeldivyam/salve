// Atlas webhook receive endpoint.
//
//   POST /api/migrations/atlas/webhook/:subId
//
// `:subId` is the Salve-generated subscription id we registered with Atlas.
// We pick the per-subscription URL on subscription creation so the receiver
// can locate the right secret + workspace by the URL alone — Atlas does not
// expose subscription_id in the dispatch.
//
// Hot path budget: < 50 ms p99 (Atlas dispatches synchronously inside their
// user request transaction; slow webhooks back-pressure their UI). All real
// work runs in the `migration/atlas.webhook.received` Inngest function.

import { createHash, randomUUID } from 'node:crypto';
import { getClient } from '@salve/db';
import { verifyAtlasSignature } from '@salve/migration-atlas';
import type { Context } from 'hono';
import { inngest } from '../inngest/client.js';
import { MIGRATION_EVENT } from '../inngest/events.js';

interface SubscriptionRow {
  id: string;
  workspace_id: string;
  run_id: string | null;
  signing_secret: string | null;
  status: string;
  event: string;
}

export async function handleAtlasWebhookReceive(c: Context): Promise<Response> {
  const subId = c.req.param('subId');
  if (!subId) return c.json({ error: 'missing-subscription' }, 404);

  // Read the raw body BEFORE any json parse — HMAC signs the byte stream.
  const rawBody = await c.req.raw.text();
  const signatureHeader = c.req.header('x-atlas-webhook-signature') ?? null;
  const timestampHeader = c.req.header('x-atlas-webhook-timestamp') ?? null;

  const sql = getClient();
  // Secret lives in `secrets.migration_webhook_credential` — joined here so
  // Zero's `public`-only replication never sees it.
  const subRows = await sql<SubscriptionRow[]>`
    SELECT s.id, s.workspace_id, s.run_id, c.signing_secret, s.status, s.event
    FROM migration_webhook_subscription s
    LEFT JOIN secrets.migration_webhook_credential c ON c.subscription_id = s.id
    WHERE s.id = ${subId}
    LIMIT 1
  `;
  const sub = subRows[0];
  if (!sub) {
    // Returning 410 (rather than 404) so Atlas stops retrying immediately
    // when the operator has deleted a subscription; per Atlas's retry
    // contract any 4xx still triggers retries, but 410 documents intent.
    return c.json({ error: 'subscription-not-found' }, 410);
  }
  if (sub.status !== 'active') {
    // Defense-in-depth: inactive subscriptions retain their credential row
    // (Atlas issues secrets once on create; rotating means recreate) but we
    // reject deliveries to them BEFORE running verifyAtlasSignature, so a
    // leaked old signature can't be replayed to an inactive sub.
    return c.json({ error: 'subscription-inactive' }, 410);
  }
  if (!sub.signing_secret) {
    // Sub row exists but credential missing — treat as gone.
    return c.json({ error: 'subscription-credential-missing' }, 410);
  }

  if (!verifyAtlasSignature(rawBody, signatureHeader, timestampHeader, sub.signing_secret)) {
    return c.json({ error: 'invalid-signature' }, 401);
  }

  // Compute delivery key for replay/dedup.
  //
  // Atlas does NOT send a delivery-id header, and on retry their
  // `webhooks/services/execution.py:_perform_request` re-stamps the
  // X-Atlas-Webhook-Timestamp header — so a timestamp-inclusive key would
  // treat every retry of the same payload as a brand-new delivery and
  // re-process it. We deliberately exclude `timestampHeader` here so
  // retries collapse to the same row.
  //
  // The timestamp still matters for signature replay defense; that check
  // lives inside verifyAtlasSignature (max clock skew), not here.
  //
  // Body-hash collision: two genuinely-distinct events with byte-identical
  // bodies would collapse. In practice Atlas payloads carry the full
  // ExternalConversation including time-varying fields (lastMessage,
  // updatedAt-like), so collisions are vanishingly rare; the cost of
  // collapsing one of those is much smaller than re-processing every retry.
  const deliveryKey = createHash('sha256')
    .update(sub.workspace_id)
    .update('|')
    .update(sub.id)
    .update('|')
    .update(rawBody)
    .digest('hex');

  // Parse the body once so we can both pull event_type and quarantine
  // malformed payloads as JSON-safe rows. `${rawBody}::jsonb` would throw
  // here for invalid JSON, dropping the row before any forensics happens.
  let eventType = sub.event;
  let payloadForInsert: unknown = { _malformed: true, body: rawBody };
  let malformed = false;
  try {
    const parsed = JSON.parse(rawBody) as { event?: unknown };
    payloadForInsert = parsed;
    if (typeof parsed.event === 'string' && parsed.event.length > 0) eventType = parsed.event;
  } catch {
    malformed = true;
  }

  const inboxId = `inb_${randomUUID()}`;
  const inserted = malformed
    ? await sql<{ id: string }[]>`
        INSERT INTO migration_event_inbox (
          id, workspace_id, run_id, source, subscription_id, event_type,
          delivery_key, atlas_timestamp, payload, received_at,
          processed_at, error_kind, error
        ) VALUES (
          ${inboxId}, ${sub.workspace_id}, ${sub.run_id}, 'atlas', ${sub.id}, ${eventType},
          ${deliveryKey}, ${timestampHeader ?? ''},
          ${JSON.stringify(payloadForInsert)}::jsonb, now(),
          now(), 'malformed-json', 'webhook body was not valid JSON'
        )
        ON CONFLICT (workspace_id, delivery_key) DO NOTHING
        RETURNING id
      `
    : await sql<{ id: string }[]>`
        INSERT INTO migration_event_inbox (
          id, workspace_id, run_id, source, subscription_id, event_type,
          delivery_key, atlas_timestamp, payload, received_at
        ) VALUES (
          ${inboxId}, ${sub.workspace_id}, ${sub.run_id}, 'atlas', ${sub.id}, ${eventType},
          ${deliveryKey}, ${timestampHeader ?? ''},
          ${JSON.stringify(payloadForInsert)}::jsonb, now()
        )
        ON CONFLICT (workspace_id, delivery_key) DO NOTHING
        RETURNING id
      `;

  if (inserted.length === 0) {
    // Duplicate — Atlas retried a delivery we already accepted. 200 + done.
    return c.json({ ok: true, dedup: true });
  }
  if (malformed) {
    // Body wasn't valid JSON. Row is already stamped processed with
    // error_kind='malformed-json'. Don't dispatch — Inngest would re-fail.
    return c.json({ ok: true, quarantined: 'malformed-json' });
  }

  // Fire-and-forget Inngest dispatch. We `await` because Inngest's `send`
  // returns once the event is durable in their queue (microseconds), so the
  // total receive time stays well under our 50ms budget.
  await inngest.send({
    id: `mig-webhook-${inboxId}`,
    name: MIGRATION_EVENT.ATLAS_WEBHOOK_RECEIVED,
    data: { inboxId, workspaceID: sub.workspace_id },
  });

  return c.json({ ok: true });
}
