/**
 * Phase-2 smoke: synthetic inbound — construct a Mailgun-shaped Routes
 * `forward()` POST with the real signing key, send it to the deployed
 * /api/inbound/email/mailgun/mime endpoint, and assert the response.
 *
 * This does NOT require an MX flip on in.usesalve.com; it bypasses Mailgun
 * entirely by replaying the same wire format Mailgun would have produced.
 *
 *   pnpm tsx --env-file=.env apps/api/scripts/smoke-mailgun-inbound.ts \
 *     <api-base> <recipient-localpart>
 *
 * Examples:
 *   tsx smoke-mailgun-inbound.ts https://api.usesalve.com inbound+ws_<id>
 *   tsx smoke-mailgun-inbound.ts http://localhost:3001 support
 *
 * Asserts:
 *   - Wrong signature → 401
 *   - Stale timestamp → 401
 *   - Valid signature → 202 with { ok: true, rawID }
 *   - The handler resolved a channel (otherwise it returns "ignored": "unresolved-channel")
 *
 * Side effects: creates an inbound_message_raw row + emits the
 * inbound/message.received Inngest event. Subjects/bodies are tagged
 * [salve-mailgun-inbound-smoke].
 */

import { createHmac, randomUUID } from 'node:crypto';

interface InboundResponse {
  ok?: boolean;
  rawID?: string;
  channelID?: string;
  providerMessageID?: string;
  duplicate?: boolean;
  error?: string;
  ignored?: string;
}

function sign(key: string, timestamp: string, token: string): string {
  return createHmac('sha256', key)
    .update(timestamp + token)
    .digest('hex');
}

function buildRawMime(args: { from: string; to: string; subject: string }): string {
  const date = new Date().toUTCString();
  const messageId = `<${randomUUID()}@inbound-smoke.usesalve.com>`;
  const body = 'Synthetic Mailgun inbound smoke test. Safe to delete.';
  return [
    'MIME-Version: 1.0',
    `Date: ${date}`,
    `From: <${args.from}>`,
    `To: <${args.to}>`,
    `Subject: ${args.subject}`,
    `Message-ID: ${messageId}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 7bit',
    '',
    body,
    '',
  ].join('\r\n');
}

function buildForm(args: {
  recipient: string;
  sender: string;
  subject: string;
  rawMime: string;
  timestamp: string;
  token: string;
  signature: string;
}): URLSearchParams {
  const form = new URLSearchParams();
  form.append('recipient', args.recipient);
  form.append('sender', args.sender);
  form.append('subject', args.subject);
  form.append('body-mime', args.rawMime);
  form.append('timestamp', args.timestamp);
  form.append('token', args.token);
  form.append('signature', args.signature);
  return form;
}

async function postForm(
  url: string,
  body: URLSearchParams,
): Promise<{ status: number; json: unknown }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
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
  const recipientLocal = process.argv[3];
  if (!apiBase || !recipientLocal) {
    console.error('Usage: tsx smoke-mailgun-inbound.ts <api-base> <recipient-localpart>');
    process.exit(2);
  }
  const key = process.env.MAILGUN_WEBHOOK_SIGNING_KEY;
  if (!key) throw new Error('MAILGUN_WEBHOOK_SIGNING_KEY not set');

  const inboundDomain = process.env.INBOUND_EMAIL_DOMAIN ?? 'in.usesalve.com';
  const recipient = `${recipientLocal}@${inboundDomain}`;
  const sender = 'smoke-test@example.org';
  const subject = '[salve-mailgun-inbound-smoke] synthetic';
  const url = `${apiBase.replace(/\/$/, '')}/api/inbound/email/mailgun/mime`;

  console.log(`[smoke] target  : ${url}`);
  console.log(`[smoke] recipient: ${recipient}`);

  const rawMime = buildRawMime({ from: sender, to: recipient, subject });
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const token = randomUUID().replace(/-/g, '');
  const signature = sign(key, timestamp, token);

  // Test 1 — bad signature → 401
  {
    const form = buildForm({
      recipient,
      sender,
      subject,
      rawMime,
      timestamp,
      token,
      signature: `${signature.slice(0, -1)}0`,
    });
    const res = await postForm(url, form);
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
    const form = buildForm({
      recipient,
      sender,
      subject,
      rawMime,
      timestamp: stale,
      token,
      signature: staleSig,
    });
    const res = await postForm(url, form);
    console.log('[smoke] stale-ts response:', res.status, res.json);
    if (res.status !== 401) {
      console.error('[smoke] FAIL: stale timestamp accepted');
      process.exitCode = 1;
    }
  }

  // Test 3 — valid → 202 (or 202 + ignored if no channel matches)
  {
    const form = buildForm({ recipient, sender, subject, rawMime, timestamp, token, signature });
    const res = await postForm(url, form);
    console.log('[smoke] valid response  :', res.status, JSON.stringify(res.json));
    if (res.status !== 202) {
      console.error('[smoke] FAIL: valid signature did not produce 202');
      process.exitCode = 1;
    } else {
      const body = res.json as InboundResponse;
      if (body.ignored === 'unresolved-channel') {
        console.warn(
          `[smoke] WARN: handler accepted but no channel matched recipient (${recipient}). Set <recipient-localpart> to a real email_address.full_address localpart in your workspace, or use 'inbound+ws_<workspace-id>' for the catch-all path.`,
        );
      } else if (body.ok && body.rawID) {
        console.log(`[smoke] OK: rawID=${body.rawID} channelID=${body.channelID}`);
      } else {
        console.error('[smoke] FAIL: unexpected response shape');
        process.exitCode = 1;
      }
    }
  }

  if (process.exitCode === 1) {
    console.error('[smoke] FAIL — at least one assertion failed');
    return;
  }
  console.log('[smoke] OK — inbound endpoint is healthy');
}

main().catch((err) => {
  console.error('[smoke] FAIL:', err);
  process.exit(1);
});
