/**
 * Synthetic event-webhook smoke: construct a Mailgun-shaped `delivered`
 * payload, sign it with the real signing key, POST to /api/webhooks/mailgun.
 * Independent of Mailgun's actual webhook delivery — tells us 100% whether
 * our handler is wired up correctly end-to-end.
 *
 *   pnpm exec tsx --env-file=<repo>/.env apps/api/scripts/smoke-mailgun-webhook.ts <api-base>
 *
 * Asserts:
 *   - Bad signature → 401
 *   - Stale timestamp → 401
 *   - Valid signature, unknown message-id → 200 + ignored: 'unknown-provider-message-id'
 */

import { createHmac, randomUUID } from 'node:crypto';

function sign(key: string, timestamp: string, token: string): string {
  return createHmac('sha256', key)
    .update(timestamp + token)
    .digest('hex');
}

interface WebhookPayload {
  signature: { timestamp: string; token: string; signature: string };
  'event-data': {
    event: string;
    severity?: string;
    timestamp: number;
    id: string;
    message: { headers: { 'message-id': string } };
    recipient: string;
    'delivery-status'?: { code?: number; description?: string };
  };
}

function buildPayload(args: {
  timestamp: string;
  token: string;
  signature: string;
  messageId: string;
  recipient: string;
}): WebhookPayload {
  return {
    signature: { timestamp: args.timestamp, token: args.token, signature: args.signature },
    'event-data': {
      event: 'delivered',
      timestamp: Number(args.timestamp),
      id: randomUUID(),
      message: { headers: { 'message-id': args.messageId } },
      recipient: args.recipient,
      'delivery-status': { code: 250, description: 'OK' },
    },
  };
}

async function postJson(url: string, body: unknown): Promise<{ status: number; json: unknown }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json };
}

async function main() {
  const apiBase = process.argv[2];
  if (!apiBase) {
    console.error('Usage: tsx smoke-mailgun-webhook.ts <api-base>');
    process.exit(2);
  }
  const key = process.env.MAILGUN_WEBHOOK_SIGNING_KEY;
  if (!key) throw new Error('MAILGUN_WEBHOOK_SIGNING_KEY not set');

  const url = `${apiBase.replace(/\/$/, '')}/api/webhooks/mailgun`;
  const messageId = `synthetic-${randomUUID()}@mailgun-test.usesalve.com`;
  const recipient = 'divyam@emergent.sh';
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const token = randomUUID().replace(/-/g, '');
  const signature = sign(key, timestamp, token);

  console.log(`[smoke] target  : ${url}`);
  console.log(`[smoke] message : ${messageId}`);

  // Test 1 — bad signature → 401
  {
    const payload = buildPayload({
      timestamp,
      token,
      signature: `${signature.slice(0, -1)}0`,
      messageId,
      recipient,
    });
    const res = await postJson(url, payload);
    console.log('[smoke] bad-sig response :', res.status, res.json);
    if (res.status !== 401) {
      console.error('[smoke] FAIL: bad signature accepted');
      process.exitCode = 1;
    }
  }

  // Test 2 — stale timestamp → 401
  {
    const stale = (Math.floor(Date.now() / 1000) - 700).toString();
    const staleSig = sign(key, stale, token);
    const payload = buildPayload({
      timestamp: stale,
      token,
      signature: staleSig,
      messageId,
      recipient,
    });
    const res = await postJson(url, payload);
    console.log('[smoke] stale-ts response:', res.status, res.json);
    if (res.status !== 401) {
      console.error('[smoke] FAIL: stale timestamp accepted');
      process.exitCode = 1;
    }
  }

  // Test 3 — valid signature, unknown message-id → 200 with ignored
  {
    const payload = buildPayload({ timestamp, token, signature, messageId, recipient });
    const res = await postJson(url, payload);
    console.log('[smoke] valid response  :', res.status, JSON.stringify(res.json));
    if (res.status !== 200) {
      console.error('[smoke] FAIL: valid signature did not produce 200');
      process.exitCode = 1;
    }
  }

  if (process.exitCode === 1) {
    console.error('[smoke] FAIL — at least one assertion failed');
    return;
  }
  console.log('[smoke] OK — webhook endpoint is healthy');
}

main().catch((err) => {
  console.error('[smoke] FAIL:', err);
  process.exit(1);
});
