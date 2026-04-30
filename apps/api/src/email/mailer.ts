// Phase 3a — mailer adapter. Two backends: Mailpit (dev) and SES (prod-stub).
//
// Picked by env:
//   - MAILER_BACKEND=mailpit  → nodemailer SMTP localhost:1025 (Mailpit, no auth)
//   - MAILER_BACKEND=ses      → @aws-sdk/client-sesv2 SendEmailCommand raw path
//   - unset                   → 'mailpit' if NODE_ENV !== 'production', else 'ses'
//
// Both backends serialize via `serializeEnvelopeToRaw` so the wire format is
// identical — the headers Mailpit shows are the same headers SES will inject.

import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import nodemailer, { type Transporter } from 'nodemailer';
import { type BuiltEnvelope, serializeEnvelopeToRaw } from './envelope.js';

export type MailerBackend = 'mailpit' | 'ses';

export interface SendResult {
  providerMessageID: string;
  backend: MailerBackend;
}

export function getMailerBackend(): MailerBackend {
  const explicit = process.env.MAILER_BACKEND;
  if (explicit === 'ses') return 'ses';
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
  const cmd = new SendEmailCommand({
    Content: {
      Raw: { Data: raw },
    },
    // SMTP envelope override; SES will use these for `MAIL FROM` / `RCPT TO`
    // regardless of the headers in the raw payload.
    FromEmailAddress: env.from,
    Destination: { ToAddresses: [env.to] },
  });
  const out = await getSes().send(cmd);
  return {
    providerMessageID: out.MessageId ?? env.rfcMessageID,
    backend: 'ses',
  };
}

// ---------- Public API ----------

export async function sendRawEmail(env: BuiltEnvelope): Promise<SendResult> {
  const backend = getMailerBackend();
  if (backend === 'ses') return sendViaSes(env);
  return sendViaMailpit(env);
}
