export type ParsedEmailAddress = {
  address: string;
  name?: string;
};

export type NormalizeEmailAddressOptions = {
  stripPlusTag?: boolean;
  normalizeGmailDots?: boolean;
};

const EMAIL_IN_ANGLE_BRACKETS_RE = /<([^<>@\s]+@[^<>\s]+)>/;
const BARE_EMAIL_RE = /[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)+/i;
const GMAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com']);

export function extractEmailAddress(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const angleMatch = value.match(EMAIL_IN_ANGLE_BRACKETS_RE);
  if (angleMatch?.[1]) {
    return angleMatch[1];
  }

  return value.match(BARE_EMAIL_RE)?.[0] ?? null;
}

export function parseEmailAddress(value: string | null | undefined): ParsedEmailAddress | null {
  const address = extractEmailAddress(value);
  if (!address) {
    return null;
  }

  const beforeAngle = value?.split('<')[0]?.trim();
  const name = beforeAngle
    ?.replace(/^["']|["']$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    address: normalizeEmailAddress(address),
    ...(name && !name.includes('@') ? { name } : {}),
  };
}

export function normalizeEmailAddress(
  value: string | null | undefined,
  options: NormalizeEmailAddressOptions = {},
): string {
  const extracted = extractEmailAddress(value) ?? value ?? '';
  const [rawLocal = '', rawDomain = ''] = extracted.trim().toLowerCase().split('@');
  if (!rawLocal || !rawDomain) {
    return extracted.trim().toLowerCase();
  }

  const domain = rawDomain === 'googlemail.com' ? 'gmail.com' : rawDomain;
  let local = rawLocal;

  if (options.stripPlusTag) {
    local = local.split('+')[0] ?? local;
  }

  if (options.normalizeGmailDots && GMAIL_DOMAINS.has(domain)) {
    local = local.replace(/\./g, '');
  }

  return `${local}@${domain}`;
}

export function normalizeEmailAddressForLookup(value: string | null | undefined): string {
  return normalizeEmailAddress(value, {
    normalizeGmailDots: true,
    stripPlusTag: true,
  });
}

export function getEmailDomain(value: string | null | undefined): string | null {
  const normalized = normalizeEmailAddress(value);
  const at = normalized.lastIndexOf('@');
  return at === -1 ? null : normalized.slice(at + 1);
}
