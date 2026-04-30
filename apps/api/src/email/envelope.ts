// Phase 3a — outbound envelope builder + raw RFC 5322 serializer.
//
// Pure functions, no I/O. The mailer adapter (`./mailer.ts`) calls these to
// build a fully-formed RFC 5322 message that's handed to either nodemailer
// (Mailpit dev) or SES `SendEmailCommand` with `RawMessage.Data` (prod).
//
// Why raw? We inject `List-Unsubscribe`, `List-Unsubscribe-Post`, and
// `Feedback-ID` ourselves; SES's templated path doesn't allow that level of
// header control. Research §5: these headers are required for Gmail/Yahoo
// bulk-sender compliance (RFC 8058 one-click).

import { randomUUID } from 'node:crypto';
import { signReplyAddress } from './reply-token.js';

// ---------- Subject prefix-list normalization (research §2) ----------

// Multilingual reply/forward prefixes we strip when computing "is this the
// same subject" *and* when prepending our own `Re:`. Atlas's list at
// `email.py:78-83` plus the German/Polish/Greek extras called out in their
// test suite. Comparing case-insensitively and trimming colons.
const REPLY_PREFIXES = [
  'Re',
  'RE',
  'Aw',
  'AW', // German
  'Sv',
  'Vs',
  'Vl',
  'Wg', // Nordic
  'Ynt',
  'Ilt', // Turkish/Finnish
  'Odp',
  'Pd', // Polish
  'Rv',
  'Enc',
  'Encaminhando', // Portuguese
  'ΑΠ',
  'ΣΧΕΤ', // Greek
];
const FORWARD_PREFIXES = ['Fw', 'FW', 'Fwd', 'Fwd:', 'Fr', 'WG', 'PD', 'Tr', 'I', 'VS'];

const ALL_PREFIXES = [...REPLY_PREFIXES, ...FORWARD_PREFIXES];

const PREFIX_RE = new RegExp(`^\\s*(?:${ALL_PREFIXES.join('|')})\\s*:\\s*`, 'i');
const SQUARE_BRACKET_RE = /^\s*\[[^\]]+\]\s*/;
const ZENDESK_RE = /^\s*Request received:\s*/i;

/**
 * Strip leading reply/forward prefixes (multi-pass; nested `Re: Re: [Acme]
 * Re: foo` becomes `foo`). Mirrors Atlas `email.py:727-735`. Used in two
 * places: (a) computing the canonical subject, and (b) deciding whether to
 * prepend our own `Re:` on outbound.
 */
export function stripSubjectPrefixes(subject: string): string {
  let s = subject ?? '';
  let prev: string;
  // Up to 8 passes — defends against `Re: [Acme] Re: Re: [foo] bar`.
  for (let i = 0; i < 8; i++) {
    prev = s;
    s = s.replace(PREFIX_RE, '').replace(SQUARE_BRACKET_RE, '').replace(ZENDESK_RE, '');
    if (s === prev) break;
  }
  return s.trim();
}

/**
 * Add a single `Re:` to a subject without double-prefixing. We always strip
 * first then re-add `Re:`. Empty subjects become "Re: (no subject)".
 */
export function asReplySubject(subject: string): string {
  const core = stripSubjectPrefixes(subject) || '(no subject)';
  return `Re: ${core}`;
}

// ---------- RFC 2047 encoded-word for non-ASCII display names ----------

const NON_ASCII_RE = /[^\x20-\x7E]/;

function rfc2047(input: string): string {
  if (!NON_ASCII_RE.test(input)) return input;
  // base64 with utf-8 charset.
  const b64 = Buffer.from(input, 'utf-8').toString('base64');
  return `=?UTF-8?B?${b64}?=`;
}

/**
 * Build a `Display Name <addr@host>` address pair. Quotes the display name
 * if it contains specials (RFC 5322 §3.2.3); RFC-2047 encodes it if it
 * contains non-ASCII.
 */
export function formatAddress(displayName: string | undefined, address: string): string {
  if (!displayName) return address;
  const encoded = rfc2047(displayName);
  // If we already encoded-word it, no quoting needed (encoded-word is "atom").
  if (encoded !== displayName) return `${encoded} <${address}>`;
  // Only quote if it has specials. Otherwise leave bare (cleaner).
  const SPECIALS = /[()<>@,;:\\".[\]]/;
  const safe = SPECIALS.test(displayName)
    ? `"${displayName.replace(/[\\"]/g, (m) => `\\${m}`)}"`
    : displayName;
  return `${safe} <${address}>`;
}

// ---------- Inputs ----------

export interface EnvelopeWorkspace {
  id: string;
  name: string;
  slug: string;
}

export interface EnvelopeTicket {
  id: string;
  shortID: number;
  title: string;
}

export interface EnvelopeMessage {
  id: string;
  bodyHtml: string;
  bodyText: string;
}

export interface EnvelopeCustomer {
  email: string;
  name?: string | null;
  displayName?: string | null;
}

export interface EnvelopeSendingDomain {
  domain: string;
  /** "support" by default; can be overridden per channel. */
  sendingLocalpart?: string;
  /** Fully qualified sending address, e.g. support@example.com. */
  fullAddress?: string;
}

/**
 * Prior message in the thread, oldest → newest. We use this to populate
 * `In-Reply-To` (the most-recent prior message-id) and `References` (the full
 * chain, capped at the last ~30 to keep header sizes reasonable).
 */
export interface PriorMessage {
  rfcMessageID: string;
}

export interface BuildEnvelopeArgs {
  workspace: EnvelopeWorkspace;
  ticket: EnvelopeTicket;
  message: EnvelopeMessage;
  customer: EnvelopeCustomer;
  sendingDomain: EnvelopeSendingDomain;
  emailChannel?: {
    fromName?: string | null;
    signature?: string | null;
  };
  /** Prior outbound + inbound messages on this ticket, oldest → newest. */
  priorMessages: PriorMessage[];
  /** Per-customer one-click unsubscribe token (we sign it later — placeholder for 3a). */
  unsubscribeToken: string;
  /** Test-only override for the reply-domain in the Reply-To address. */
  replyDomainOverride?: string;
}

// ---------- Output ----------

export interface BuiltEnvelope {
  /** RFC 5322 headers as a stable, ordered list of `[name, value]` pairs. */
  headers: Array<[string, string]>;
  html: string;
  text: string;
  /** SMTP MAIL FROM equivalent: the sending mailbox the SMTP envelope sees. */
  from: string;
  /** Customer's address (single recipient for Phase 3a; CC arrives in 3b). */
  to: string;
  /** RFC `Message-ID:` header value (with angle brackets). */
  rfcMessageID: string;
  /** Subject after our normalization. */
  subject: string;
  /** Reply-To we computed for the outbound (signed reply+t...). */
  replyTo: string;
}

const REFERENCES_CAP = 30;

/** Build the full RFC 5322 envelope for an agent reply. Pure. */
export function buildEnvelope(args: BuildEnvelopeArgs): BuiltEnvelope {
  const { workspace, ticket, message, customer, sendingDomain, priorMessages, unsubscribeToken } =
    args;

  const sendingLocal = sendingDomain.sendingLocalpart ?? 'support';
  const fromAddr = sendingDomain.fullAddress ?? `${sendingLocal}@${sendingDomain.domain}`;

  // Display name: prefer `<workspace.name> Support` unless the workspace name
  // already contains "support" (any case).
  const wsHasSupport = /support/i.test(workspace.name);
  const fromDisplay =
    args.emailChannel?.fromName ?? (wsHasSupport ? workspace.name : `${workspace.name} Support`);
  const fromHeader = formatAddress(fromDisplay, fromAddr);

  // Customer To. Display name from customer.displayName / .name if set.
  const toDisplay = customer.displayName ?? customer.name ?? undefined;
  const toHeader = formatAddress(toDisplay ?? undefined, customer.email);

  // Subject — `Re: ...` with double-prefix protection.
  const subject = asReplySubject(ticket.title);

  // Message-ID: <uuid@mail.<sending_domain>> per research §2.
  const rfcMessageID = `<${randomUUID()}@mail.${sendingDomain.domain}>`;

  // In-Reply-To: most recent prior message's RFC Message-ID, if any.
  const lastPrior = priorMessages.length > 0 ? priorMessages[priorMessages.length - 1] : undefined;
  const inReplyTo = lastPrior?.rfcMessageID;

  // References: full chain (oldest → newest), capped at REFERENCES_CAP.
  const refsList = priorMessages.slice(-REFERENCES_CAP).map((m) => m.rfcMessageID);
  const references = refsList.length > 0 ? refsList.join(' ') : undefined;

  // Reply-To: signed reply+t address.
  const replyTo = signReplyAddress({
    workspaceID: workspace.id,
    ticketID: ticket.id,
    domain: args.replyDomainOverride,
  });

  // List-Id per RFC 2919.
  const listId = `<${workspace.slug}.${ticket.shortID}.tickets.usesalve.com>`;

  // List-Unsubscribe with both URL + mailto. Phase 3a uses an opaque token;
  // 3b/3c will sign it like the reply-plus token.
  const unsubURL = `https://app.usesalve.com/u/${unsubscribeToken}`;
  const unsubMailto = `reply+unsub.${unsubscribeToken}@${args.replyDomainOverride ?? 'reply.usesalve.com'}`;
  const listUnsubscribe = `<${unsubURL}>, <mailto:${unsubMailto}>`;

  // Feedback-ID (research §5): SES uses this for ISP feedback loops.
  // Format: <campaign>:<customer>:<sub-customer>:<sender>. We use
  // <ticket-cohort> = month-bucket of ticket creation as a coarse cohort key
  // to avoid every ticket being its own feedback loop.
  const ticketCohort = ticket.shortID > 0 ? `t${Math.floor(ticket.shortID / 100)}` : 'tnew';
  const feedbackID = `t:${workspace.id}:${ticketCohort}:opendesk`;

  const headers: Array<[string, string]> = [
    ['MIME-Version', '1.0'],
    ['Date', new Date().toUTCString()],
    ['From', fromHeader],
    ['To', toHeader],
    ['Subject', rfc2047(subject)],
    ['Message-ID', rfcMessageID],
    ...(inReplyTo ? ([['In-Reply-To', inReplyTo]] as Array<[string, string]>) : []),
    ...(references ? ([['References', references]] as Array<[string, string]>) : []),
    ['Reply-To', `<${replyTo}>`],
    ['List-Id', listId],
    ['List-Unsubscribe', listUnsubscribe],
    ['List-Unsubscribe-Post', 'List-Unsubscribe=One-Click'],
    ['X-Workspace-ID', workspace.id],
    ['X-Ticket-ID', ticket.id],
    ['Feedback-ID', feedbackID],
  ];

  return {
    headers,
    html: appendHtmlSignature(message.bodyHtml, args.emailChannel?.signature),
    text: appendTextSignature(message.bodyText, args.emailChannel?.signature),
    from: fromAddr,
    to: customer.email,
    rfcMessageID,
    subject,
    replyTo,
  };
}

function appendHtmlSignature(html: string, signature?: string | null): string {
  if (!signature?.trim()) return html;
  return `${html}<br><br><div class="opendesk-email-signature">${signature}</div>`;
}

function appendTextSignature(text: string, signature?: string | null): string {
  if (!signature?.trim()) return text;
  const plain = signature
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .trim();
  return plain ? `${text}\n\n-- \n${plain}` : text;
}

// ---------- Raw RFC 5322 serializer ----------

/**
 * Encode a header field value. If it contains non-ASCII, RFC-2047 it. Folding
 * at 76 chars is "nice to have" but most modern mail servers accept long lines
 * — we keep it simple and only fold if absolutely necessary.
 */
function encodeHeaderValue(value: string): string {
  if (!NON_ASCII_RE.test(value)) return value;
  return rfc2047(value);
}

const CRLF = '\r\n';

/**
 * Serialize a `BuiltEnvelope` to a raw RFC 5322 message (multipart/alternative
 * for HTML + text). Returns a Buffer suitable for SES SendEmailCommand
 * `RawMessage.Data` or nodemailer's `raw:` field.
 */
export function serializeEnvelopeToRaw(env: BuiltEnvelope): Buffer {
  // Boundary uniqueness: derive from rfcMessageID — already unique-per-message.
  const boundary = `=_opendesk_${env.rfcMessageID.replace(/[^a-zA-Z0-9]/g, '').slice(0, 32)}`;

  const headerLines = [
    ...env.headers.map(([k, v]) => `${k}: ${encodeHeaderValue(v)}`),
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];

  const textBody = Buffer.from(env.text || '', 'utf-8').toString('base64');
  const htmlBody = Buffer.from(env.html || '', 'utf-8').toString('base64');

  const body = [
    `--${boundary}`,
    'Content-Type: text/plain; charset="utf-8"',
    'Content-Transfer-Encoding: base64',
    '',
    chunk(textBody, 76),
    `--${boundary}`,
    'Content-Type: text/html; charset="utf-8"',
    'Content-Transfer-Encoding: base64',
    '',
    chunk(htmlBody, 76),
    `--${boundary}--`,
    '',
  ].join(CRLF);

  return Buffer.from(headerLines.join(CRLF) + CRLF + CRLF + body, 'utf-8');
}

function chunk(s: string, n: number): string {
  const out: string[] = [];
  for (let i = 0; i < s.length; i += n) out.push(s.slice(i, i + n));
  return out.join(CRLF);
}
