const REPLY_PREFIX_RE = /^(?:\s*(?:re|fw|fwd|aw|sv|vs|wg|antw|antwort)\s*:\s*)+/i;
const BRACKET_PREFIX_RE = /^(?:\s*\[[^\]]{1,80}\]\s*)+/;
const REQUEST_RECEIVED_RE =
  /^(?:request\s+received|ticket\s+received|new\s+request|support\s+request|your\s+request)\s*[:-]\s*/i;
const AUTO_TICKET_PREFIX_RE = /^(?:\[?ticket\s*#?\d+\]?\s*[:-]?\s*)/i;

export function normalizeSubjectForThreading(subject: string | null | undefined): string {
  let normalized = (subject ?? '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  for (let i = 0; i < 12; i += 1) {
    const before = normalized;
    normalized = normalized
      .replace(REPLY_PREFIX_RE, '')
      .replace(BRACKET_PREFIX_RE, '')
      .replace(REQUEST_RECEIVED_RE, '')
      .replace(AUTO_TICKET_PREFIX_RE, '')
      .trim();

    if (normalized === before) {
      break;
    }
  }

  return normalized.toLocaleLowerCase().replace(/\s+/g, '');
}

export function subjectsMatchForThreading(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  const normalizedLeft = normalizeSubjectForThreading(left);
  const normalizedRight = normalizeSubjectForThreading(right);
  return normalizedLeft.length > 0 && normalizedLeft === normalizedRight;
}
