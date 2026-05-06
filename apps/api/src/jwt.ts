// Custom JWT issuance for salve.
//
// After better-auth sets a session, we issue OUR OWN HS256 JWT signed with
// AUTH_SECRET (same value zero-cache reads as ZERO_AUTH_SECRET). The cookie is
// stamped on every authenticated request so claims (workspaceID, role) stay
// fresh without forcing a sign-out/in cycle.

import { jwtVerify, SignJWT } from 'jose';

const COOKIE_NAME = 'jwt';
const ALG = 'HS256';
const SEVEN_DAYS_SECONDS = 60 * 60 * 24 * 7;

export interface SalveJwtClaims {
  sub: string;
  workspaceID: string | null;
  role: 'owner' | 'admin' | 'agent' | null;
  iat: number;
  exp: number;
}

export interface IssueJwtInput {
  userID: string;
  workspaceID: string | null;
  role: SalveJwtClaims['role'];
}

function getSecretBytes(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error('AUTH_SECRET is not set; cannot sign salve JWT.');
  }
  return new TextEncoder().encode(secret);
}

export async function issueSalveJwt(input: IssueJwtInput): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + SEVEN_DAYS_SECONDS;
  return await new SignJWT({
    workspaceID: input.workspaceID,
    role: input.role,
  })
    .setProtectedHeader({ alg: ALG, typ: 'JWT' })
    .setSubject(input.userID)
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(getSecretBytes());
}

export async function verifySalveJwt(token: string): Promise<SalveJwtClaims> {
  const { payload } = await jwtVerify(token, getSecretBytes(), {
    algorithms: [ALG],
  });
  if (typeof payload.sub !== 'string') {
    throw new Error('jwt missing sub');
  }
  return {
    sub: payload.sub,
    workspaceID: (payload.workspaceID as string | null | undefined) ?? null,
    role: (payload.role as SalveJwtClaims['role']) ?? null,
    iat: typeof payload.iat === 'number' ? payload.iat : 0,
    exp: typeof payload.exp === 'number' ? payload.exp : 0,
  };
}

export interface CookieAttrs {
  isProduction: boolean;
  /**
   * Optional Domain attribute. In prod we set this to the eTLD+1 (e.g.
   * `usesalve.com`) so the JWT cookie is shared across all subdomains —
   * api.usesalve.com (server), app.usesalve.com (web SPA), and most
   * importantly sync.usesalve.com (zero-cache, which must receive the
   * cookie via WS handshake → `ZERO_QUERY_FORWARD_COOKIES` to authenticate
   * server-mutators against /api/zero/mutate).
   *
   * In dev we omit it so the cookie scopes to `localhost` (Vite proxies
   * /api/** to the Hono server, all same-origin).
   */
  domain?: string;
}

export function buildJwtCookieHeader(token: string, attrs: CookieAttrs): string {
  const parts = [
    `${COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${SEVEN_DAYS_SECONDS}`,
  ];
  if (attrs.domain) parts.push(`Domain=${attrs.domain}`);
  if (attrs.isProduction) parts.push('Secure');
  return parts.join('; ');
}

export function clearJwtCookieHeader(attrs: CookieAttrs): string {
  const parts = [`${COOKIE_NAME}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (attrs.domain) parts.push(`Domain=${attrs.domain}`);
  if (attrs.isProduction) parts.push('Secure');
  return parts.join('; ');
}

export function readJwtCookie(cookieHeader: string | null | undefined): string | null {
  if (!cookieHeader) return null;
  const cookies = cookieHeader.split(';').map((c) => c.trim());
  for (const c of cookies) {
    const eq = c.indexOf('=');
    if (eq === -1) continue;
    const name = c.slice(0, eq);
    if (name === COOKIE_NAME) {
      return c.slice(eq + 1);
    }
  }
  return null;
}

export const JWT_COOKIE_NAME = COOKIE_NAME;
