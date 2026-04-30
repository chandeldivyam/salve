const TEXT_CUT_MARKERS = [
  /^-{2,}\s*forwarded message\s*-{2,}\s*$/i,
  /^-{2,}\s*original message\s*-{2,}\s*$/i,
  /^begin forwarded message:\s*$/i,
  /^forwarded message\s*$/i,
  /^on .+ wrote:\s*$/i,
];

const STRUCTURED_FORWARD_HEADER_RE = /^from:\s*.+\n(?:date|sent):\s*.+\n(?:to:|subject:)/im;
const OUTLOOK_DIV_RE = /<div\b[^>]*\bid=(["'])?(?:x_)*divRplyFwdMsg\1?[^>]*>/i;
const FORWARDED_HTML_RE =
  /(?:-{2,}\s*(?:forwarded|original)\s+message\s*-{2,}|begin forwarded message:|on\s+.{1,240}\s+wrote:)/i;

export const QUOTED_HTML_SELECTORS = [
  '.gmail_quote',
  '.gmail_attr',
  '.yahoo_quoted',
  '.protonmail_quote',
  '.moz-cite-prefix',
  '#divRplyFwdMsg',
  'blockquote[type="cite"]',
] as const;

export function stripQuotedText(value: string | null | undefined): string {
  if (!value) {
    return '';
  }

  const normalized = value.replace(/\r\n?/g, '\n').trim();
  const structuredForward = normalized.search(STRUCTURED_FORWARD_HEADER_RE);
  let lines = normalized.split('\n');

  if (structuredForward > 0) {
    return normalized.slice(0, structuredForward).trim();
  }

  const cutAt = lines.findIndex((line) => {
    const trimmed = line.trim();
    return TEXT_CUT_MARKERS.some((marker) => marker.test(trimmed));
  });

  if (cutAt >= 0) {
    lines = lines.slice(0, cutAt);
  }

  while (lines.length > 0 && isQuotedLine(lines[lines.length - 1])) {
    lines.pop();
  }

  return lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function stripQuotedHtml(value: string | null | undefined): string {
  if (!value) {
    return '';
  }

  let html = value.replace(/\r\n?/g, '\n').trim();

  html = cutBeforeOutlookReplyBlock(html);
  html = removeElementsByClass(html, [
    'gmail_quote',
    'gmail_attr',
    'yahoo_quoted',
    'protonmail_quote',
    'moz-cite-prefix',
  ]);
  html = removeElementsById(html, ['divRplyFwdMsg', 'x_divRplyFwdMsg', 'x_x_divRplyFwdMsg']);
  html = html.replace(/<blockquote\b[^>]*\btype=(["'])cite\1[^>]*>[\s\S]*?<\/blockquote>/gi, '');

  const forwardedMarker = html.search(FORWARDED_HTML_RE);
  if (forwardedMarker > 0) {
    html = html.slice(0, forwardedMarker);
  }

  return html
    .replace(/(?:<br\s*\/?>\s*){3,}/gi, '<br><br>')
    .replace(/<(?:p|div)>\s*(?:<br\s*\/?>)?\s*<\/(?:p|div)>$/gi, '')
    .trim();
}

function isQuotedLine(line: string | undefined): boolean {
  const trimmed = line?.trim() ?? '';
  return trimmed === '' || trimmed.startsWith('>') || /^sent from my /i.test(trimmed);
}

function cutBeforeOutlookReplyBlock(html: string): string {
  const match = html.match(OUTLOOK_DIV_RE);
  if (!match?.index || match.index <= 0) {
    return html;
  }

  const beforeOutlookBlock = html.slice(0, match.index);
  const hrIndex = beforeOutlookBlock.search(/<hr\b[^>]*>\s*$/i);
  return hrIndex >= 0 ? beforeOutlookBlock.slice(0, hrIndex) : beforeOutlookBlock;
}

function removeElementsByClass(html: string, classNames: readonly string[]): string {
  let result = html;
  for (const className of classNames) {
    const escaped = escapeRegExp(className);
    result = result.replace(
      new RegExp(
        `<([a-z0-9]+)\\b[^>]*class=(["'])[^"']*\\b${escaped}\\b[^"']*\\2[^>]*>[\\s\\S]*?<\\/\\1>`,
        'gi',
      ),
      '',
    );
  }
  return result;
}

function removeElementsById(html: string, ids: readonly string[]): string {
  let result = html;
  for (const id of ids) {
    result = result.replace(
      new RegExp(
        `<([a-z0-9]+)\\b[^>]*id=(["'])?${escapeRegExp(id)}\\2?[^>]*>[\\s\\S]*?<\\/\\1>`,
        'gi',
      ),
      '',
    );
  }
  return result;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
