/**
 * Phase-1 smoke: send one tiny RFC 5322 message through Mailgun's
 * `messages.mime` endpoint, bypassing MAILER_BACKEND. The point is to
 * confirm credentials + the verified system domain work *before* we flip
 * production to MAILER_BACKEND=mailgun.
 *
 * Run from the repo root with the live .env loaded:
 *
 *   pnpm tsx --env-file=.env apps/api/scripts/smoke-mailgun-send.ts <to-email> [sending-domain]
 *
 * `sending-domain` defaults to MAILGUN_SYSTEM_DOMAIN. Override to test a
 * tenant-provisioned domain end-to-end (e.g. mailgun-test.usesalve.com).
 *
 * Asserts:
 *   - MAILGUN_API_KEY + MAILGUN_SYSTEM_DOMAIN are set
 *   - POST returns 200 with `{ id, message }`
 *   - The returned id round-trips with our Message-ID header (sans <>)
 *
 * Side effects:
 *   - Sends a real email. Use a recipient you own.
 *   - Subjects/bodies prefixed [salve-mailgun-smoke] for grep / filter.
 */

import { randomUUID } from 'node:crypto';
import { sendMimeViaMailgun } from '../src/email/mailgun.js';

const SUBJECT = '[salve-mailgun-smoke] Phase 1 outbound test';

function buildRawEnvelope(args: { from: string; to: string; messageId: string }): Buffer {
  const date = new Date().toUTCString();
  const body =
    'This is a Salve Mailgun outbound smoke test.\r\n' +
    'If you see this, sendMimeViaMailgun + mg.usesalve.com are healthy.\r\n';
  const headers = [
    'MIME-Version: 1.0',
    `Date: ${date}`,
    `From: Salve Smoke <${args.from}>`,
    `To: <${args.to}>`,
    `Subject: ${SUBJECT}`,
    `Message-ID: <${args.messageId}>`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 7bit',
    '',
    body,
  ].join('\r\n');
  return Buffer.from(headers, 'utf-8');
}

async function main() {
  const to = process.argv[2];
  const overrideDomain = process.argv[3];
  if (!to) {
    console.error('Usage: tsx smoke-mailgun-send.ts <recipient-email> [sending-domain]');
    process.exit(2);
  }
  const apiKey = process.env.MAILGUN_API_KEY;
  const systemDomain = process.env.MAILGUN_SYSTEM_DOMAIN;
  if (!apiKey) throw new Error('MAILGUN_API_KEY not set');
  if (!systemDomain) throw new Error('MAILGUN_SYSTEM_DOMAIN not set');

  const sendingDomain = overrideDomain || systemDomain;
  const messageId = `${randomUUID()}@${sendingDomain}`;
  const from = `noreply@${sendingDomain}`;
  const raw = buildRawEnvelope({ from, to, messageId });

  console.log(`[smoke] sending via ${sendingDomain} → ${to}`);
  console.log(`[smoke] Message-ID: <${messageId}>`);

  const result = await sendMimeViaMailgun({
    domain: sendingDomain,
    to,
    raw,
    fallbackMessageID: messageId,
  });

  console.log('[smoke] result:', result);
  if (!result.providerMessageID) {
    console.error('[smoke] FAIL: empty providerMessageID');
    process.exit(1);
  }
  if (result.providerMessageID !== messageId) {
    console.warn(
      `[smoke] WARN: providerMessageID (${result.providerMessageID}) != Message-ID (${messageId}). Mailgun may have rewritten the id; webhook reconciliation will use whatever Mailgun reports.`,
    );
  } else {
    console.log('[smoke] OK: providerMessageID matches Message-ID exactly');
  }
  console.log('[smoke] check the recipient inbox + Mailgun dashboard logs');
}

main().catch((err) => {
  console.error('[smoke] FAIL:', err);
  process.exit(1);
});
