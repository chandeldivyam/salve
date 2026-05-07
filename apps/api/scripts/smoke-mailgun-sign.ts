/**
 * Phase-2 smoke: round-trip the Mailgun HMAC signing/verifying logic with
 * the real signing key. No network. Asserts:
 *   - A signature we generate verifies as true
 *   - A tampered signature verifies as false
 *   - An expired timestamp (> 10 min old) verifies as false
 *
 * Run with the live .env loaded:
 *
 *   pnpm tsx --env-file=.env apps/api/scripts/smoke-mailgun-sign.ts
 */

import { createHmac } from 'node:crypto';
import { verifyMailgunSig } from '../src/email/mailgun.js';

function sign(key: string, timestamp: string, token: string): string {
  return createHmac('sha256', key)
    .update(timestamp + token)
    .digest('hex');
}

function assert(cond: boolean, label: string) {
  if (cond) {
    console.log(`  ok  ${label}`);
  } else {
    console.error(`  FAIL ${label}`);
    process.exitCode = 1;
  }
}

function main() {
  const key = process.env.MAILGUN_WEBHOOK_SIGNING_KEY;
  if (!key) throw new Error('MAILGUN_WEBHOOK_SIGNING_KEY not set');

  const now = Math.floor(Date.now() / 1000).toString();
  const token = 'a'.repeat(50);
  const valid = sign(key, now, token);

  console.log('[smoke] verifyMailgunSig vectors:');
  assert(verifyMailgunSig({ timestamp: now, token, signature: valid }), 'fresh signature verifies');
  assert(
    !verifyMailgunSig({ timestamp: now, token, signature: `${valid.slice(0, -1)}0` }),
    'tampered signature rejected',
  );
  assert(!verifyMailgunSig({ timestamp: now, token, signature: '' }), 'empty signature rejected');
  const expired = (Math.floor(Date.now() / 1000) - 700).toString();
  const expiredSig = sign(key, expired, token);
  assert(
    !verifyMailgunSig({ timestamp: expired, token, signature: expiredSig }),
    'expired timestamp rejected (>10 min old)',
  );
  assert(!verifyMailgunSig({ timestamp: '', token, signature: valid }), 'empty timestamp rejected');
  assert(
    !verifyMailgunSig({ timestamp: 'not-a-number', token, signature: valid }),
    'non-numeric timestamp rejected',
  );

  if (process.exitCode === 1) {
    console.error('[smoke] FAIL — at least one assertion failed');
    return;
  }
  console.log('[smoke] OK — verifyMailgunSig is healthy');
}

main();
