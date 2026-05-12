// Atlas webhook ingestion. Verified against Atlas's source at
// /Users/divyamchandel/Documents/atlas/app/webapp/web/webhooks/.
//
// Wire envelope (every event):
//   { event: "<event-id>", data: <ExternalConversation | ExternalCustomer> }
// Atlas sends camelCase fields and serialises datetimes as integer epoch
// seconds. There is NO envelope metadata: no webhook_id, no delivery_id, no
// attempt counter — only the body and two headers:
//   X-Atlas-Webhook-Signature  hex(HMAC_SHA256(secret, `${ts}.${rawBody}`))
//   X-Atlas-Webhook-Timestamp  string of float epoch seconds (e.g. "1715179422.5486")
// The signed string uses the timestamp header verbatim, NOT a parsed/rounded
// number — we must echo the same string when verifying.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

// ---- Atlas webhook event ids ----

export const ATLAS_WEBHOOK_EVENTS = {
  CONVERSATION_CREATED: 'conversation.created',
  CONVERSATION_MESSAGE: 'conversation.message',
  CONVERSATION_STATUS: 'conversation.status',
  CONVERSATION_PRIORITY: 'conversation.priority',
  CONVERSATION_AGENT: 'conversation.agent',
  CONVERSATION_TAGS: 'conversation.tags',
  CONVERSATION_CUSTOM_FIELDS: 'conversation.custom_fields',
  CUSTOMER_CREATED: 'customer.created',
  CUSTOMER_UPDATED: 'customer.updated',
  CUSTOMER_CUSTOM_FIELDS: 'customer.custom_fields',
} as const;

export type AtlasWebhookEvent = (typeof ATLAS_WEBHOOK_EVENTS)[keyof typeof ATLAS_WEBHOOK_EVENTS];

/** Phase 4a — the four events we apply server-side; everything else is parsed
 *  but stashed in the inbox as `event_not_subscribed` (still 200 to Atlas). */
export const PHASE_4A_EVENTS: ReadonlySet<AtlasWebhookEvent> = new Set<AtlasWebhookEvent>([
  ATLAS_WEBHOOK_EVENTS.CONVERSATION_MESSAGE,
  ATLAS_WEBHOOK_EVENTS.CONVERSATION_STATUS,
  ATLAS_WEBHOOK_EVENTS.CONVERSATION_PRIORITY,
  ATLAS_WEBHOOK_EVENTS.CONVERSATION_TAGS,
]);

// ---- Signature verification ----

export interface VerifyOptions {
  /** Reject deliveries whose timestamp drifts more than this from now. Default 5 minutes. */
  maxClockSkewSeconds?: number;
}

export function verifyAtlasSignature(
  rawBody: string,
  signatureHeader: string | null | undefined,
  timestampHeader: string | null | undefined,
  secret: string,
  options: VerifyOptions = {},
): boolean {
  if (!signatureHeader || !timestampHeader || !secret) return false;
  const skew = options.maxClockSkewSeconds ?? 5 * 60;
  const ts = Number(timestampHeader);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(Date.now() / 1000 - ts) > skew) return false;
  const signed = `${timestampHeader}.${rawBody}`;
  const expected = createHmac('sha256', secret).update(signed).digest('hex');
  // timingSafeEqual rejects different-length inputs by throwing; check first.
  const a = Buffer.from(signatureHeader, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// ---- Wire schemas (camelCase, passthrough) ----
//
// We deliberately reuse only the fields we apply — passthrough() keeps the
// rest so the inbox row preserves the full payload for forensics.

const epochSeconds = z.number().int().nullable().optional();

const externalAttachmentSchema = z
  .object({
    name: z.string().nullable().optional(),
    url: z.string(),
    size: z.number().nullable().optional(),
  })
  .passthrough();

const externalUserSchema = z
  .object({
    id: z.string().nullable().optional(),
    email: z.string().nullable().optional(),
    firstName: z.string().nullable().optional(),
    lastName: z.string().nullable().optional(),
  })
  .passthrough();

const externalCustomerSchema = z
  .object({
    id: z.string(),
    externalUserId: z.string().nullable().optional(),
    accountId: z.string().nullable().optional(),
    firstName: z.string().nullable().optional(),
    lastName: z.string().nullable().optional(),
    email: z.string().nullable().optional(),
    phoneNumber: z.string().nullable().optional(),
    customFields: z.record(z.string(), z.unknown()).nullable().optional(),
    createdAt: epochSeconds,
  })
  .passthrough();

// Atlas serialises message id as a number; keep as-is and stringify at the
// EIM boundary to match the backfill path.
const externalMessageSchema = z
  .object({
    id: z.number().int(),
    side: z.enum(['customer', 'agent', 'bot']),
    type: z.string(),
    createdAt: epochSeconds,
    sentAt: epochSeconds,
    agent: externalUserSchema.nullable().optional(),
    customer: externalCustomerSchema.nullable().optional(),
    text: z.string().nullable().optional(),
    channel: z.string().nullable().optional(),
    attachments: z.array(externalAttachmentSchema).default([]),
  })
  .passthrough();

const externalConversationSchema = z
  .object({
    id: z.string(),
    number: z.number().int().nullable().optional(),
    customerId: z.string().nullable().optional(),
    customer: externalCustomerSchema.nullable().optional(),
    subject: z.string().nullable().optional(),
    status: z.string(),
    priority: z.string().nullable().optional(),
    assignedAgent: externalUserSchema.nullable().optional(),
    assignedAgentId: z.string().nullable().optional(),
    tags: z
      .array(z.string())
      .nullish()
      .transform((v) => v ?? []),
    customFields: z.record(z.string(), z.unknown()).nullable().optional(),
    startedAt: epochSeconds,
    createdAt: epochSeconds,
    closedAt: epochSeconds,
    snoozedUntil: epochSeconds,
    startedChannel: z.string().nullable().optional(),
    lastMessage: externalMessageSchema.nullable().optional(),
  })
  .passthrough();

const conversationEnvelopeSchema = z.object({
  event: z.string(),
  data: externalConversationSchema,
});

const customerEnvelopeSchema = z.object({
  event: z.string(),
  data: externalCustomerSchema,
});

export type AtlasWebhookConversation = z.infer<typeof externalConversationSchema>;
export type AtlasWebhookCustomer = z.infer<typeof externalCustomerSchema>;
export type AtlasWebhookMessage = z.infer<typeof externalMessageSchema>;

// ---- Top-level parser ----

export type ParsedAtlasWebhookEvent =
  | { kind: 'conversation'; event: AtlasWebhookEvent; data: AtlasWebhookConversation }
  | { kind: 'customer'; event: AtlasWebhookEvent; data: AtlasWebhookCustomer }
  | { kind: 'unknown'; event: string; data: unknown };

export class AtlasWebhookParseError extends Error {
  readonly reason: unknown;
  constructor(message: string, reason?: unknown) {
    super(message);
    this.name = 'AtlasWebhookParseError';
    this.reason = reason;
  }
}

const KNOWN_EVENTS: ReadonlySet<string> = new Set(Object.values(ATLAS_WEBHOOK_EVENTS));

/** Parse a verified Atlas webhook body. Throws on shape mismatch. */
export function parseAtlasWebhookEvent(rawBody: string): ParsedAtlasWebhookEvent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch (err) {
    throw new AtlasWebhookParseError('invalid-json', err);
  }
  return parseAtlasWebhookPayload(parsed);
}

/** Parse an already-decoded JSON object (e.g. read back from a jsonb column). */
export function parseAtlasWebhookPayload(parsed: unknown): ParsedAtlasWebhookEvent {
  if (!parsed || typeof parsed !== 'object' || !('event' in parsed) || !('data' in parsed)) {
    throw new AtlasWebhookParseError('missing-envelope-fields');
  }
  const event = String((parsed as { event: unknown }).event);

  if (!KNOWN_EVENTS.has(event)) {
    return { kind: 'unknown', event, data: (parsed as { data: unknown }).data };
  }

  if (event.startsWith('conversation.')) {
    const result = conversationEnvelopeSchema.safeParse(parsed);
    if (!result.success)
      throw new AtlasWebhookParseError('conversation-envelope-mismatch', result.error);
    return { kind: 'conversation', event: event as AtlasWebhookEvent, data: result.data.data };
  }
  if (event.startsWith('customer.')) {
    const result = customerEnvelopeSchema.safeParse(parsed);
    if (!result.success)
      throw new AtlasWebhookParseError('customer-envelope-mismatch', result.error);
    return { kind: 'customer', event: event as AtlasWebhookEvent, data: result.data.data };
  }
  return { kind: 'unknown', event, data: (parsed as { data: unknown }).data };
}
