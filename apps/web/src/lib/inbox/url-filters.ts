// Phase 40 — URL filter encoding.
//
// Active inbox filter chips ride in the `?f=<token>` search param so users
// can copy/share a filtered URL. Encoded as URI-safe base64 of a JSON array
// of `Filter` records. The format is intentionally opaque to URL readers —
// scattered query keys would explode under 12+ fields × 11 operators.
//
// Keep this module dependency-free apart from `Filter` so the encoder can
// move into a Worker if we ever need it.

import type { Filter } from '@opendesk/zero-schema';

const VERSION = 1 as const;

interface EncodedPayload {
  v: typeof VERSION;
  f: Filter[];
}

/**
 * Encode a filter list to a URI-safe token. Always returns a token, even
 * for an empty list — the *presence* of `?f=` is the drift signal, so a
 * user who clears every chip on a saved view still produces a different
 * URL than the unmodified view (which has no `f` param at all). Without
 * this, "remove the saved view's last filter" would silently fall back
 * to the saved baseline.
 */
export function encodeFilters(filters: ReadonlyArray<Filter>): string {
  const payload: EncodedPayload = { v: VERSION, f: filters as Filter[] };
  const json = JSON.stringify(payload);
  if (typeof window === 'undefined') {
    // SSR-safe path; we don't actually SSR yet but staying defensive.
    return Buffer.from(json, 'utf8').toString('base64url');
  }
  return base64UrlEncode(json);
}

/**
 * Decode a token from `?f=` back into a filter list. Bad tokens or wrong
 * versions return [] instead of throwing — corrupt URLs should never crash
 * the inbox; the user just sees the saved view's baseline.
 */
export function decodeFilters(token: string | undefined | null): Filter[] {
  if (!token) return [];
  try {
    const json =
      typeof window === 'undefined'
        ? Buffer.from(token, 'base64url').toString('utf8')
        : base64UrlDecode(token);
    const parsed = JSON.parse(json) as Partial<EncodedPayload>;
    if (parsed?.v !== VERSION || !Array.isArray(parsed.f)) return [];
    return parsed.f as Filter[];
  } catch {
    return [];
  }
}

function base64UrlEncode(input: string): string {
  // btoa requires latin-1; encode UTF-8 first.
  const bytes = new TextEncoder().encode(input);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return window.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(token: string): string {
  const padded = token.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (padded.length % 4)) % 4;
  const binary = window.atob(padded + '='.repeat(padLen));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/**
 * Replace one filter in the list. Used by chip-edit popovers.
 */
export function replaceFilter(
  filters: ReadonlyArray<Filter>,
  index: number,
  next: Filter,
): Filter[] {
  const out = [...filters];
  if (index < 0 || index >= out.length) {
    out.push(next);
    return out;
  }
  out[index] = next;
  return out;
}

/**
 * Remove a chip by index. Used by the X button on each chip.
 */
export function removeFilter(filters: ReadonlyArray<Filter>, index: number): Filter[] {
  return filters.filter((_, i) => i !== index);
}

/**
 * Append a new chip. Used by the `+ Filter` popover.
 */
export function appendFilter(filters: ReadonlyArray<Filter>, next: Filter): Filter[] {
  return [...filters, next];
}

/**
 * Compare two filter lists for structural equality. Used by drift detection
 * (URL filters vs saved view's baseline).
 */
export function filtersEqual(a: ReadonlyArray<Filter>, b: ReadonlyArray<Filter>): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) return false;
  }
  return true;
}
