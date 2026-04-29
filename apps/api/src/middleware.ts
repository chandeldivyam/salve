// Shared Hono middleware:
//  - resolves better-auth session from request headers
//  - looks up the user's role for the active workspace via the `member` table
//  - issues / refreshes the opendesk JWT cookie on every authenticated request
//  - enforces 401/403 for routes that require a workspace context.

import { authSchema, getDb } from '@opendesk/db';
import { and, eq } from 'drizzle-orm';
import type { Context, MiddlewareHandler } from 'hono';
import { auth } from './auth.js';
import {
  buildJwtCookieHeader,
  type CookieAttrs,
  issueOpendeskJwt,
  JWT_COOKIE_NAME,
  type OpendeskJwtClaims,
} from './jwt.js';

const isProduction = process.env.NODE_ENV === 'production';
const cookieAttrs: CookieAttrs = { isProduction };

export type AppRole = OpendeskJwtClaims['role'];

export interface AuthContext {
  userID: string;
  email: string;
  workspaceID: string | null;
  role: AppRole;
}

declare module 'hono' {
  interface ContextVariableMap {
    auth: AuthContext | null;
  }
}

function isOpendeskRole(role: string | null | undefined): AppRole {
  if (role === 'owner' || role === 'admin' || role === 'agent') return role;
  // better-auth's default member role is 'member'; map to 'agent' for opendesk semantics.
  if (role === 'member') return 'agent';
  return null;
}

async function resolveRole(userID: string, workspaceID: string): Promise<AppRole> {
  const db = getDb();
  const rows = await db
    .select({ role: authSchema.member.role })
    .from(authSchema.member)
    .where(
      and(eq(authSchema.member.userId, userID), eq(authSchema.member.organizationId, workspaceID)),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return isOpendeskRole(row.role);
}

async function buildAuthContextFromHeaders(headers: Headers): Promise<AuthContext | null> {
  const session = await auth.api.getSession({ headers });
  if (!session) return null;
  const sessionRow = session.session as { activeOrganizationId?: string | null };
  const workspaceID = sessionRow.activeOrganizationId ?? null;
  const role = workspaceID ? await resolveRole(session.user.id, workspaceID) : null;
  const effectiveWorkspaceID = role ? workspaceID : null;
  return {
    userID: session.user.id,
    email: session.user.email,
    workspaceID: effectiveWorkspaceID,
    role,
  };
}

/**
 * The opendesk auth middleware:
 *   1. Resolve the better-auth session from incoming request headers and populate
 *      `c.var.auth` so downstream handlers can use it BEFORE response time.
 *   2. After the route handler runs, re-resolve the session against headers that
 *      include any Set-Cookie just emitted by better-auth (e.g. on sign-in/sign-up
 *      a fresh `better-auth.session_token` is set on the response itself, not the
 *      request). If a session exists at that point, stamp our `jwt` cookie on the
 *      response.
 *
 * Doing the second pass makes the very first request that creates a session
 * (sign-up, sign-in) emit the opendesk JWT cookie alongside better-auth's own.
 */
export const authMiddleware: MiddlewareHandler = async (c, next) => {
  const initialCtx = await buildAuthContextFromHeaders(c.req.raw.headers);
  c.set('auth', initialCtx);

  await next();

  // Inspect the response: if better-auth (or any downstream) just emitted a
  // session cookie, derive a JWT from the now-current session and append it.
  const responseSetCookies = c.res.headers.getSetCookie();
  const sessionTokenCookie = responseSetCookies.find(
    (c) =>
      c.startsWith('better-auth.session_token=') ||
      c.startsWith('__Secure-better-auth.session_token='),
  );
  let finalCtx = initialCtx;
  if (sessionTokenCookie) {
    // Re-build a Headers object that includes the freshly-set session cookie so
    // auth.api.getSession can find it.
    const merged = new Headers(c.req.raw.headers);
    const cookieValue = sessionTokenCookie.split(';')[0] ?? '';
    const existing = merged.get('cookie');
    merged.set('cookie', existing ? `${existing}; ${cookieValue}` : cookieValue);
    finalCtx = await buildAuthContextFromHeaders(merged);
    c.set('auth', finalCtx);
  }

  if (finalCtx) {
    const token = await issueOpendeskJwt({
      userID: finalCtx.userID,
      workspaceID: finalCtx.workspaceID,
      role: finalCtx.role,
    });
    c.res.headers.append('Set-Cookie', buildJwtCookieHeader(token, cookieAttrs));
  }
};

/** Require an authenticated user (any workspace state). 401 otherwise. */
export const requireUser: MiddlewareHandler = async (c, next) => {
  if (!c.get('auth')) return c.json({ error: 'unauthenticated' }, 401);
  await next();
};

/**
 * Require an authenticated user AND an active workspace membership.
 * Returns 401 / 403 with consistent JSON.
 */
export const requireWorkspace: MiddlewareHandler = async (c, next) => {
  const ctx = c.get('auth');
  if (!ctx) return c.json({ error: 'unauthenticated' }, 401);
  if (!ctx.workspaceID || !ctx.role) {
    return c.json({ error: 'no-workspace' }, 403);
  }
  await next();
};

export function authOf(c: Context): AuthContext {
  const a = c.get('auth');
  if (!a) throw new Error('authOf called without auth context');
  return a;
}

export { JWT_COOKIE_NAME };
