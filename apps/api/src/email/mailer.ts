// Phase 3a — mailer adapter. Three backends: Mailpit (dev), SES, Mailgun.
//
// Picked by env:
//   - MAILER_BACKEND=mailpit  → nodemailer SMTP localhost:1025 (Mailpit, no auth)
//   - MAILER_BACKEND=ses      → @aws-sdk/client-sesv2 SendEmailCommand raw path
//   - MAILER_BACKEND=mailgun  → POST /v3/{domain}/messages.mime (basic auth: api:KEY)
//   - unset                   → 'mailpit' if NODE_ENV !== 'production', else 'ses'
//
// All three backends serialize via `serializeEnvelopeToRaw` so the wire format
// is identical — the headers Mailpit shows are the same headers SES/Mailgun
// will inject.

import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import nodemailer, { type Transporter } from 'nodemailer';
import { type BuiltEnvelope, serializeEnvelopeToRaw } from './envelope.js';
import { getMailgunSystemDomain, sendMimeViaMailgun } from './mailgun.js';

export type MailerBackend = 'mailpit' | 'ses' | 'mailgun';

export interface SendResult {
  providerMessageID: string;
  backend: MailerBackend;
}

export function getMailerBackend(): MailerBackend {
  const explicit = process.env.MAILER_BACKEND;
  if (explicit === 'ses') return 'ses';
  if (explicit === 'mailgun') return 'mailgun';
  if (explicit === 'mailpit') return 'mailpit';
  return process.env.NODE_ENV === 'production' ? 'ses' : 'mailpit';
}

// ---------- Mailpit (dev) ----------

let _smtp: Transporter | undefined;
function getSmtp(): Transporter {
  if (!_smtp) {
    _smtp = nodemailer.createTransport({
      host: process.env.MAILPIT_HOST ?? 'localhost',
      port: Number.parseInt(process.env.MAILPIT_PORT ?? '1025', 10),
      secure: false,
      ignoreTLS: true,
      // Mailpit does not require auth; nodemailer is fine without `auth`.
    });
  }
  return _smtp;
}

async function sendViaMailpit(env: BuiltEnvelope): Promise<SendResult> {
  const raw = serializeEnvelopeToRaw(env);
  const result = await getSmtp().sendMail({
    envelope: { from: env.from, to: env.to },
    raw,
  });
  // nodemailer's `messageId` echoes back the Message-ID header it observed,
  // typically with angle brackets. Mailpit returns its own queue id in
  // `response`; either is fine for our audit.
  return {
    providerMessageID: result.messageId ?? env.rfcMessageID,
    backend: 'mailpit',
  };
}

// ---------- SES (prod) ----------

let _ses: SESv2Client | undefined;
function getSes(): SESv2Client {
  if (!_ses) {
    _ses = new SESv2Client({
      region: process.env.AWS_REGION ?? 'us-east-1',
    });
  }
  return _ses;
}

async function sendViaSes(env: BuiltEnvelope): Promise<SendResult> {
  const raw = serializeEnvelopeToRaw(env);
  // ConfigurationSet is what tells SES to publish Bounce/Complaint/Delivery
  // events to the SNS topic our webhook ingests. Without it, the entire
  // bounce-suppression pipeline downstream (webhooks/ses.ts +
  // provider-webhook.ts → local `suppression` table) gets nothing.
  const configurationSet = process.env.SES_CONFIGURATION_SET || undefined;
  const cmd = new SendEmailCommand({
    Content: {
      Raw: { Data: raw },
    },
    // SMTP envelope override; SES will use these for `MAIL FROM` / `RCPT TO`
    // regardless of the headers in the raw payload.
    FromEmailAddress: env.from,
    Destination: { ToAddresses: [env.to] },
    ...(configurationSet ? { ConfigurationSetName: configurationSet } : {}),
  });
  const out = await getSes().send(cmd);
  return {
    providerMessageID: out.MessageId ?? env.rfcMessageID,
    backend: 'ses',
  };
}

// ---------- Mailgun (prod via HTTP messages.mime) ----------

async function sendViaMailgun(env: BuiltEnvelope): Promise<SendResult> {
  const raw = serializeEnvelopeToRaw(env);
  // Routing-domain rule: for ticket replies the From is `support@<tenant>` so
  // we route via the tenant's own verified Mailgun domain. For system mail
  // (where the From is on `usesalve.com` apex but we can't add the apex to
  // Mailgun without breaking SES), callers go through `sendRawBuffer` and
  // pass `mailgunDomain: MAILGUN_SYSTEM_DOMAIN` explicitly.
  const fromDomain = env.from.split('@')[1];
  if (!fromDomain) throw new Error('mailer: malformed from address');
  return sendMimeViaMailgun({
    domain: fromDomain,
    to: env.to,
    raw,
    fallbackMessageID: env.rfcMessageID,
  });
}

// ---------- Public API ----------

export async function sendRawEmail(env: BuiltEnvelope): Promise<SendResult> {
  const backend = getMailerBackend();
  if (backend === 'ses') return sendViaSes(env);
  if (backend === 'mailgun') return sendViaMailgun(env);
  return sendViaMailpit(env);
}

/**
 * Low-level primitive: send a pre-serialized RFC 5322 buffer through the
 * configured backend. Useful for transactional mail (invitations, magic
 * links) where the per-ticket `BuiltEnvelope` machinery is overkill.
 *
 * `mailgunDomain` overrides the Mailgun routing-domain (defaults to
 * `MAILGUN_SYSTEM_DOMAIN`). Ignored for SES / Mailpit backends.
 */
export async function sendRawBuffer(args: {
  from: string;
  to: string;
  raw: Buffer;
  fallbackMessageID?: string;
  mailgunDomain?: string;
}): Promise<SendResult> {
  const backend = getMailerBackend();
  if (backend === 'ses') {
    const cmd = new SendEmailCommand({
      Content: { Raw: { Data: args.raw } },
      FromEmailAddress: args.from,
      Destination: { ToAddresses: [args.to] },
    });
    const out = await getSes().send(cmd);
    return { providerMessageID: out.MessageId ?? args.fallbackMessageID ?? '', backend: 'ses' };
  }
  if (backend === 'mailgun') {
    return sendMimeViaMailgun({
      domain: args.mailgunDomain ?? getMailgunSystemDomain(),
      to: args.to,
      raw: args.raw,
      fallbackMessageID: args.fallbackMessageID,
    });
  }
  const result = await getSmtp().sendMail({
    envelope: { from: args.from, to: args.to },
    raw: args.raw,
  });
  return {
    providerMessageID: result.messageId ?? args.fallbackMessageID ?? '',
    backend: 'mailpit',
  };
}
