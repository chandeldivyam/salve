// Mailgun transport + signature verification.
//
// Lives next to mailer.ts because the two collaborate: mailer.ts picks the
// backend, mailgun.ts owns the wire format. Both webhook (event) and Routes
// (forward) callbacks are HMAC-signed with the *HTTP webhook signing key*
// (distinct from the API key). The replay window is 10 minutes — anything
// older than that we treat as a replay attempt regardless of signature
// validity.

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { SendResult } from './mailer.js';

const REPLAY_WINDOW_SECONDS = 600;

export interface MailgunSigParts {
  timestamp: string;
  token: string;
  signature: string;
}

export function verifyMailgunSig(args: MailgunSigParts): boolean {
  const key = process.env.MAILGUN_WEBHOOK_SIGNING_KEY;
  if (!key || !args.timestamp || !args.token || !args.signature) return false;

  const ts = Number(args.timestamp);
  if (!Number.isFinite(ts)) return false;
  const ageSec = Math.abs(Date.now() / 1000 - ts);
  if (ageSec > REPLAY_WINDOW_SECONDS) return false;

  const expected = createHmac('sha256', key)
    .update(args.timestamp + args.token)
    .digest('hex');
  let a: Buffer;
  let b: Buffer;
  try {
    a = Buffer.from(expected, 'hex');
    b = Buffer.from(args.signature, 'hex');
  } catch {
    return false;
  }
  if (a.length === 0 || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export interface MailgunSendArgs {
  /**
   * Mailgun routing domain — must be verified in Mailgun. The MIME `From:`
   * does not need to match this domain; DMARC alignment is satisfied by
   * relaxed-mode (subdomain) for system mail through `mg.usesalve.com`.
   */
  domain: string;
  to: string;
  raw: Buffer;
  fallbackMessageID?: string;
}

export async function sendMimeViaMailgun(args: MailgunSendArgs): Promise<SendResult> {
  const apiKey = process.env.MAILGUN_API_KEY;
  if (!apiKey) throw new Error('mailgun: MAILGUN_API_KEY not configured');

  const base = (process.env.MAILGUN_API_BASE ?? 'https://api.mailgun.net').replace(/\/$/, '');
  const auth = `Basic ${Buffer.from(`api:${apiKey}`).toString('base64')}`;

  const form = new FormData();
  form.append('to', args.to);
  // Copy into a fresh Uint8Array so the Blob constructor's lib.dom typing
  // accepts it. A view into Buffer.buffer trips TS's ArrayBuffer-vs-
  // SharedArrayBuffer check; `Uint8Array.from` allocates a new ArrayBuffer.
  const messageBytes = Uint8Array.from(args.raw);
  form.append('message', new Blob([messageBytes], { type: 'message/rfc822' }), 'message.eml');

  const url = `${base}/v3/${encodeURIComponent(args.domain)}/messages.mime`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: auth },
    body: form,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`mailgun send failed (${res.status}) on ${args.domain}: ${text}`);
  }
  const json = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
  // Mailgun returns the id with angle brackets — strip them so the value
  // matches the `Message-ID:` header we sign into outbound MIME, which is
  // what subsequent event webhooks (`event-data.message.headers.message-id`)
  // reference.
  const id = (json.id ?? '').replace(/^<|>$/g, '');
  return {
    providerMessageID: id || args.fallbackMessageID || '',
    backend: 'mailgun',
  };
}

export function getMailgunSystemDomain(): string {
  const value = process.env.MAILGUN_SYSTEM_DOMAIN;
  if (!value) throw new Error('mailgun: MAILGUN_SYSTEM_DOMAIN not configured');
  return value;
}
