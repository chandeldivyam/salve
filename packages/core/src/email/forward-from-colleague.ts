import { normalizeEmailAddress, type ParsedEmailAddress, parseEmailAddress } from './address.js';

export type ForwardedRequester = ParsedEmailAddress & {
  source: 'forwarded_from_header';
};

export type ForwardFromColleagueInput = {
  forwarderAddress?: string | null;
  subject?: string | null;
  bodyText?: string | null;
  bodyHtml?: string | null;
};

export type ForwardFromColleagueResult = {
  detected: boolean;
  requester?: ForwardedRequester;
  colleagueAddress?: string;
};

const FORWARDED_MARKER_RE =
  /(?:^-+\s*forwarded message\s*-+$|^begin forwarded message:$|^fw:|^fwd:)/im;
const STRUCTURED_FORWARD_RE = /^from:\s*(.+?)\s*$(?:\n|\r\n?)(?:date|sent):/im;
const FROM_LINE_RE = /^from:\s*(.+?)\s*$/im;

export function extractOriginalRequesterFromForward(
  body: string | null | undefined,
): ForwardedRequester | null {
  if (!body) {
    return null;
  }

  const normalized = htmlToText(body).replace(/\r\n?/g, '\n');
  const structuredMatch = normalized.match(STRUCTURED_FORWARD_RE);
  const fromLine = structuredMatch?.[1] ?? normalized.match(FROM_LINE_RE)?.[1];
  const parsed = parseEmailAddress(fromLine);

  return parsed ? { ...parsed, source: 'forwarded_from_header' } : null;
}

export function detectForwardFromColleague(
  input: ForwardFromColleagueInput,
): ForwardFromColleagueResult {
  const body = input.bodyText ?? input.bodyHtml ?? '';
  const subject = input.subject ?? '';
  const looksForwarded = FORWARDED_MARKER_RE.test(subject) || FORWARDED_MARKER_RE.test(body);

  if (!looksForwarded) {
    return { detected: false };
  }

  const requester = extractOriginalRequesterFromForward(body);
  if (!requester) {
    return { detected: false };
  }

  const colleagueAddress = normalizeEmailAddress(input.forwarderAddress);
  if (colleagueAddress && requester.address === colleagueAddress) {
    return { detected: false };
  }

  return {
    detected: true,
    requester,
    ...(colleagueAddress ? { colleagueAddress } : {}),
  };
}

function htmlToText(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
