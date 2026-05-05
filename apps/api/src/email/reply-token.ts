// Phase 3a — HMAC-signed reply-routing token.
//
// An unsigned reply-plus localpart lets anyone who knows the format and
// guesses two values inject messages into a ticket. HMAC-signing closes that.
//
// Shape:
//   reply+t.<workspaceID>.<ticketID>.<expiry>.<sigPrefix>@reply.usesalve.com
//
// `sigPrefix` is HMAC-SHA256 over `<workspaceID>.<ticketID>.<expiry>` keyed
// with `AUTH_SECRET`, base64url-truncated to 12 chars (~72 bits — plenty
// against guessing). `expiry` is unix-seconds; default 90 days.
//
// Verification rejects malformed parts, wrong sig, wrong domain, expired tokens.

import { createHmac, timingSafeEqual } from 'node:crypto';

export const REPLY_DOMAIN = process.env.REPLY_DOMAIN ?? 'reply.usesalve.com';
export const REPLY_LOCALPART_PREFIX = 'reply+t.';
const SIG_PREFIX_LEN = 12;
const DEFAULT_TTL_SECS = 60 * 60 * 24 * 90; // 90 days

function getSecret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error('AUTH_SECRET is not set');
  return s;
}

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function sigFor(workspaceID: string, ticketID: string, expiry: number, secret: string): string {
  const h = createHmac('sha256', secret);
  h.update(`${workspaceID}.${ticketID}.${expiry}`);
  return base64url(h.digest()).slice(0, SIG_PREFIX_LEN);
}

export interface SignReplyArgs {
  workspaceID: string;
  ticketID: string;
  ttlSecs?: number;
  /** Override the domain (test-only). */
  domain?: string;
  /** Override the secret (test-only). */
  secretOverride?: string;
  /** Override "now" (test-only, unix-seconds). */
  nowOverride?: number;
}

export function signReplyAddress({
  workspaceID,
  ticketID,
  ttlSecs = DEFAULT_TTL_SECS,
  domain = REPLY_DOMAIN,
  secretOverride,
  nowOverride,
}: SignReplyArgs): string {
  const secret = secretOverride ?? getSecret();
  const now = nowOverride ?? Math.floor(Date.now() / 1000);
  const expiry = now + ttlSecs;
  const sig = sigFor(workspaceID, ticketID, expiry, secret);
  return `${REPLY_LOCALPART_PREFIX}${workspaceID}.${ticketID}.${expiry}.${sig}@${domain}`;
}

export interface ParsedReply {
  workspaceID: string;
  ticketID: string;
}

export interface ParseReplyOpts {
  domain?: string;
  secretOverride?: string;
  nowOverride?: number;
}

/**
 * Parse + verify a reply address. Returns null on any failure (malformed
 * shape, wrong domain, bad signature, expired). Never throws — caller treats
 * null as "no shortcut, fall back to header-based threading" (Phase 3b).
 */
export function parseReplyAddress(address: string, opts: ParseReplyOpts = {}): ParsedReply | null {
  if (!address) return null;
  const trimmed = address.trim();
  const atIdx = trimmed.indexOf('@');
  if (atIdx <= 0) return null;
  // Localpart preserves case (the base64url signature is case-sensitive).
  // RFC 5321 says domains are case-insensitive; lowercase only the right side.
  const localpart = trimmed.slice(0, atIdx);
  const domainPart = trimmed.slice(atIdx + 1).toLowerCase();

  const expectedDomain = (opts.domain ?? REPLY_DOMAIN).toLowerCase();
  if (domainPart !== expectedDomain) return null;
  if (!localpart.startsWith(REPLY_LOCALPART_PREFIX)) return null;

  const tail = localpart.slice(REPLY_LOCALPART_PREFIX.length);
  const parts = tail.split('.');
  if (parts.length !== 4) return null;
  const [workspaceID, ticketID, expiryStr, sig] = parts as [string, string, string, string];
  if (!workspaceID || !ticketID || !expiryStr || !sig) return null;

  const expiry = Number.parseInt(expiryStr, 10);
  if (!Number.isFinite(expiry) || expiry <= 0) return null;

  const now = opts.nowOverride ?? Math.floor(Date.now() / 1000);
  if (expiry < now) return null;

  let secret: string;
  try {
    secret = opts.secretOverride ?? getSecret();
  } catch {
    return null;
  }

  const expected = sigFor(workspaceID, ticketID, expiry, secret);
  if (expected.length !== sig.length) return null;
  // timingSafeEqual requires equal-length buffers.
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  if (!timingSafeEqual(a, b)) return null;

  return { workspaceID, ticketID };
}

// ---------- Body-marker HMAC (defense against marker spoofing) ----------
//
// `::tid:<ticketID>::` is the unsigned legacy form — accepted by some
// inbound mail (e.g. older outbound flows from third-party systems). It's
// trivially forgeable: a customer who knows another ticket's UUID can
// inject the marker into a reply and have it threaded into the wrong
// ticket. Replace with `::tid:<ticketID>:<sigPrefix>::` and only treat
// markers whose HMAC verifies as authoritative thread hints. A `null`
// return means "ignore this marker, fall back to other layers".
const BODY_MARKER_SIG_LEN = 12;

function bodyMarkerSig(workspaceID: string, ticketID: string, secret: string): string {
  const h = createHmac('sha256', secret);
  h.update(`body-marker:${workspaceID}:${ticketID}`);
  return base64url(h.digest()).slice(0, BODY_MARKER_SIG_LEN);
}

export function signBodyMarker(
  workspaceID: string,
  ticketID: string,
  secretOverride?: string,
): string {
  const secret = secretOverride ?? getSecret();
  return `::tid:${ticketID}:${bodyMarkerSig(workspaceID, ticketID, secret)}::`;
}

export function verifyBodyMarker(
  workspaceID: string,
  ticketID: string,
  sig: string,
  secretOverride?: string,
): boolean {
  let secret: string;
  try {
    secret = secretOverride ?? getSecret();
  } catch {
    return false;
  }
  const expected = bodyMarkerSig(workspaceID, ticketID, secret);
  if (expected.length !== sig.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
}

// ---------- Inline tests (run with `tsx reply-token.ts`) ----------
//
// Guard with import.meta.url check so the module is import-safe. There is no
// Vitest in the repo yet (per Phase 3a constraints) — these are the only unit
// tests for the token shape. Run with `pnpm exec tsx apps/api/src/email/reply-token.ts`.

if (import.meta.url === `file://${process.argv[1]}`) {
  const SECRET = 'test-secret-do-not-use-in-prod';
  const opts = { secretOverride: SECRET, domain: 'reply.usesalve.com' };

  let pass = 0;
  let fail = 0;
  function assert(cond: unknown, label: string) {
    if (cond) {
      pass++;
      console.log(`  ok  ${label}`);
    } else {
      fail++;
      console.log(`  FAIL ${label}`);
    }
  }

  // Round-trip
  const addr = signReplyAddress({
    workspaceID: 'ws_abc',
    ticketID: 't_123',
    secretOverride: SECRET,
  });
  assert(addr.startsWith('reply+t.ws_abc.t_123.'), 'address has expected prefix');
  assert(addr.endsWith('@reply.usesalve.com'), 'address has expected domain');

  const parsed = parseReplyAddress(addr, opts);
  assert(parsed?.workspaceID === 'ws_abc', 'round-trip: workspaceID');
  assert(parsed?.ticketID === 't_123', 'round-trip: ticketID');

  // Malformed
  assert(parseReplyAddress('', opts) === null, 'empty rejected');
  assert(parseReplyAddress('not-an-address', opts) === null, 'no @ rejected');
  assert(
    parseReplyAddress('reply+t.ws.t.0.deadbeef@reply.usesalve.com', opts) === null,
    'expired (epoch 0) rejected',
  );
  assert(
    parseReplyAddress('reply+t.ws.t.99999999999.bad@reply.usesalve.com', opts) === null,
    'bad sig rejected',
  );
  assert(
    parseReplyAddress(addr, { ...opts, domain: 'wrong.usesalve.com' }) === null,
    'wrong domain rejected',
  );
  assert(
    parseReplyAddress('reply+t.ws.t@reply.usesalve.com', opts) === null,
    'too few parts rejected',
  );
  assert(
    parseReplyAddress(addr, { ...opts, secretOverride: 'different-secret' }) === null,
    'wrong secret rejected (sig changes)',
  );

  // Expiry
  const expired = signReplyAddress({
    workspaceID: 'ws',
    ticketID: 't',
    ttlSecs: -10,
    secretOverride: SECRET,
  });
  assert(parseReplyAddress(expired, opts) === null, 'past-expiry rejected');

  // Body markers — HMAC verification
  const marker = signBodyMarker('ws_a', 't_1', SECRET);
  assert(/^::tid:t_1:[A-Za-z0-9_-]{12}::$/.test(marker), 'body marker has expected shape');
  const sigPart = marker.slice(marker.indexOf(':t_1:') + ':t_1:'.length, marker.length - 2);
  assert(verifyBodyMarker('ws_a', 't_1', sigPart, SECRET), 'verify accepts own signature');
  assert(!verifyBodyMarker('ws_b', 't_1', sigPart, SECRET), 'verify rejects different workspace');
  assert(!verifyBodyMarker('ws_a', 't_2', sigPart, SECRET), 'verify rejects different ticket');
  assert(
    !verifyBodyMarker('ws_a', 't_1', 'forged000000', SECRET),
    'verify rejects forged signature',
  );

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}
