import { normalizeEmailAddress } from './address.js';

export type HeaderBag =
  | Headers
  | Map<string, string>
  | Record<string, string | readonly string[] | null | undefined>;

export type LoopGuardReason =
  | 'auto_submitted'
  | 'bulk_precedence'
  | 'auto_response_header'
  | 'bounce_sender'
  | 'no_reply_sender'
  | 'own_message_reference';

export type LoopGuardInput = {
  headers?: HeaderBag | null;
  from?: string | null;
  ownMessageIDs?: Iterable<string>;
  ownMessageIDDomains?: Iterable<string>;
};

export type LoopGuardResult = {
  shouldSkip: boolean;
  reasons: LoopGuardReason[];
};

const BULK_PRECEDENCE_VALUES = new Set(['bulk', 'junk', 'list']);
const AUTO_RESPONSE_HEADERS = [
  'x-autoreply',
  'x-autoresponder',
  'x-autoresponse',
  'x-autoresponse-suppress',
  'x-auto-response-suppress',
];
const BOUNCE_LOCALPART_RE =
  /^(?:mailer-daemon|postmaster|bounce|bounces|mailer|mail-daemon)(?:[+._-].*)?$/i;
const NO_REPLY_LOCALPART_RE = /^(?:no-?reply|do-?not-?reply|donotreply|notifications?)$/i;
const MESSAGE_ID_RE = /<([^<>]+)>/g;

export function evaluateInboundLoopGuard(input: LoopGuardInput): LoopGuardResult {
  const reasons: LoopGuardReason[] = [];

  if (hasAutoSubmittedHeader(input.headers)) {
    reasons.push('auto_submitted');
  }
  if (hasBulkPrecedence(input.headers)) {
    reasons.push('bulk_precedence');
  }
  if (hasAutoResponseHeader(input.headers)) {
    reasons.push('auto_response_header');
  }
  if (isBounceLikeSender(input.from)) {
    reasons.push('bounce_sender');
  } else if (isNoReplyLikeSender(input.from)) {
    reasons.push('no_reply_sender');
  }
  if (
    referencesContainOwnMessageID(input.headers, {
      ownMessageIDDomains: input.ownMessageIDDomains,
      ownMessageIDs: input.ownMessageIDs,
    })
  ) {
    reasons.push('own_message_reference');
  }

  return {
    shouldSkip: reasons.length > 0,
    reasons,
  };
}

export function hasAutoSubmittedHeader(headers: HeaderBag | null | undefined): boolean {
  const value = getHeader(headers, 'auto-submitted')?.toLowerCase();
  return !!value && value !== 'no' && value.startsWith('auto-');
}

export function hasBulkPrecedence(headers: HeaderBag | null | undefined): boolean {
  const value = getHeader(headers, 'precedence')?.toLowerCase().trim();
  return !!value && BULK_PRECEDENCE_VALUES.has(value);
}

export function hasAutoResponseHeader(headers: HeaderBag | null | undefined): boolean {
  return AUTO_RESPONSE_HEADERS.some((header) => {
    const value = getHeader(headers, header);
    return value !== undefined && value.trim().toLowerCase() !== 'no';
  });
}

export function isBounceLikeSender(address: string | null | undefined): boolean {
  const normalized = normalizeEmailAddress(address);
  const localPart = normalized.split('@')[0] ?? '';
  return BOUNCE_LOCALPART_RE.test(localPart);
}

export function isNoReplyLikeSender(address: string | null | undefined): boolean {
  const normalized = normalizeEmailAddress(address);
  const localPart = normalized.split('@')[0] ?? '';
  return NO_REPLY_LOCALPART_RE.test(localPart);
}

export function referencesContainOwnMessageID(
  headers: HeaderBag | null | undefined,
  options: Pick<LoopGuardInput, 'ownMessageIDs' | 'ownMessageIDDomains'>,
): boolean {
  const references = [
    getHeader(headers, 'references'),
    getHeader(headers, 'in-reply-to'),
    getHeader(headers, 'message-id'),
  ]
    .filter((value): value is string => !!value)
    .flatMap(extractMessageIDs);

  if (references.length === 0) {
    return false;
  }

  const ownIDs = new Set([...(options.ownMessageIDs ?? [])].map((id) => normalizeMessageID(id)));
  const ownDomains = new Set(
    [...(options.ownMessageIDDomains ?? [])].map((domain) => domain.toLowerCase()),
  );

  return references.some((id) => {
    const normalized = normalizeMessageID(id);
    if (ownIDs.has(normalized)) {
      return true;
    }

    const domain = normalized.split('@').at(1);
    return !!domain && ownDomains.has(domain.toLowerCase());
  });
}

export function extractMessageIDs(value: string): string[] {
  const bracketed = [...value.matchAll(MESSAGE_ID_RE)]
    .map((match) => match[1])
    .filter((id): id is string => !!id);
  if (bracketed.length > 0) {
    return bracketed;
  }
  return value
    .split(/\s+/)
    .map((part) => part.trim())
    .filter((part) => part.includes('@'));
}

export function getHeader(headers: HeaderBag | null | undefined, name: string): string | undefined {
  if (!headers) {
    return undefined;
  }

  const lowerName = name.toLowerCase();

  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    return headers.get(name) ?? undefined;
  }

  if (headers instanceof Map) {
    return headers.get(name) ?? headers.get(lowerName) ?? undefined;
  }

  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== lowerName || value === null || value === undefined) {
      continue;
    }
    return Array.isArray(value) ? value.join(', ') : value;
  }

  return undefined;
}

function normalizeMessageID(value: string): string {
  return value.trim().replace(/^<|>$/g, '').toLowerCase();
}
