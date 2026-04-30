import { serve } from '@hono/node-server';
import { SERVICE_NAME } from '@opendesk/core';
import { authSchema, getDb } from '@opendesk/db';
import { type AuthData, queries, schema } from '@opendesk/zero-schema';
import { mustGetMutator, mustGetQuery, type ReadonlyJSONValue } from '@rocicorp/zero';
import { handleMutateRequest, handleQueryRequest } from '@rocicorp/zero/server';
import { zeroPostgresJS } from '@rocicorp/zero/server/adapters/postgresjs';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { auth } from './auth.js';
import { buildJwtCookieHeader, issueOpendeskJwt, readJwtCookie, verifyOpendeskJwt } from './jwt.js';
import { authMiddleware, authOf, requireUser } from './middleware.js';
import { createServerMutators } from './server-mutators.js';

const app = new Hono();

// Trusted origins for cross-origin browser fetches. In dev the web app is
// served same-origin via Vite's server.proxy, so CORS is essentially a no-op
// there. In prod (web on app.salve.app, API on api.salve.app) this is what
// allows the browser to send cookie-bearing requests.
const trustedOrigins = (process.env.BETTER_AUTH_TRUSTED_ORIGINS ?? 'http://localhost:5173')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  '/api/*',
  cors({
    origin: (origin) => (origin && trustedOrigins.includes(origin) ? origin : undefined),
    credentials: true,
    allowHeaders: ['Content-Type', 'Authorization'],
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    maxAge: 600,
  }),
);

// Run before every request. Populates `c.var.auth` and refreshes the opendesk
// JWT cookie on authenticated requests.
app.use('*', authMiddleware);

app.get('/', (c) =>
  c.text(`Hello from ${SERVICE_NAME}-api. Brand: Salve. See /healthz for status.`),
);

app.get('/healthz', (c) =>
  c.json({
    status: 'ok',
    service: 'opendesk-api',
    version: '0.0.0',
  }),
);

// Re-issue the opendesk JWT for a different workspace. Verifies membership
// server-side and updates better-auth's activeOrganizationId via the org plugin
// so subsequent /api/auth/get-session reflects the change. Registered BEFORE
// the catch-all better-auth handler so /api/auth/switch-workspace doesn't get
// swallowed by it.
app.post('/api/auth/switch-workspace', requireUser, async (c) => {
  const body = (await c.req.json().catch(() => null)) as { workspaceID?: string } | null;
  const workspaceID = body?.workspaceID?.trim();
  if (!workspaceID) {
    return c.json({ error: 'workspaceID required' }, 400);
  }
  const ctxAuth = authOf(c);

  const db = getDb();
  const rows = await db
    .select({ role: authSchema.member.role })
    .from(authSchema.member)
    .where(
      and(
        eq(authSchema.member.userId, ctxAuth.userID),
        eq(authSchema.member.organizationId, workspaceID),
      ),
    )
    .limit(1);
  const membership = rows[0];
  if (!membership) {
    return c.json({ error: 'not a member of that workspace' }, 403);
  }

  // Tell better-auth's organization plugin to update the session row.
  await auth.api.setActiveOrganization({
    body: { organizationId: workspaceID },
    headers: c.req.raw.headers,
  });

  // Stamp a fresh opendesk JWT cookie eagerly (saves the client a round-trip).
  // Per RFC 6265 the appended Set-Cookie wins on the client over any earlier one
  // emitted by `authMiddleware` for the previous workspace.
  const role =
    membership.role === 'owner' || membership.role === 'admin' || membership.role === 'agent'
      ? membership.role
      : 'agent';
  const token = await issueOpendeskJwt({
    userID: ctxAuth.userID,
    workspaceID,
    role,
  });
  c.header(
    'Set-Cookie',
    buildJwtCookieHeader(token, { isProduction: process.env.NODE_ENV === 'production' }),
    { append: true },
  );

  return c.body(null, 204);
});

// Mount better-auth's full handler at /api/auth/*. Better-auth handles:
//   sign-up/email, sign-in/email, sign-out, get-session,
//   organization/create, organization/set-active, organization/list, ...
//   magic-link/sign-in/magic-link, callback/{provider}.
app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw));

// ---------------------------------------------------------------------------
// Zero custom mutator + query endpoints.
//
// zero-cache is configured (via apps/zero-cache/.env) with
//   ZERO_MUTATE_URL=http://localhost:3001/api/zero/mutate
//   ZERO_QUERY_URL=http://localhost:3001/api/zero/query
// and forwards the browser's `jwt` cookie verbatim
// (ZERO_MUTATE_FORWARD_COOKIES / ZERO_QUERY_FORWARD_COOKIES). We verify that
// JWT here and derive the AuthData ctx that mutators / queries see.
//
// Pattern from `/tmp/zero-mono/apps/zbugs/api/index.ts:160-228` adapted to
// Hono and the postgres.js adapter.

const upstreamDB = process.env.DATABASE_URL ?? '';
let _zql: ReturnType<typeof zeroPostgresJS<typeof schema>> | undefined;
function getZql() {
  if (!_zql) {
    if (!upstreamDB) throw new Error('DATABASE_URL is not set; cannot init Zero server adapter');
    // Independent postgres.js client so server-mutator transactions are
    // isolated from the @opendesk/db drizzle pool (different transaction
    // semantics expected by Zero's adapter). Pass the connection string
    // directly so the postgres types come from Zero's pinned `postgres@3.4.7`
    // (avoids the duplicated `Sql<{}>` vs `Sql<Record<string, unknown>>`
    // mismatch that arises when api itself imports the slightly newer
    // postgres@3.4.9).
    _zql = zeroPostgresJS(schema, upstreamDB);
  }
  return _zql;
}

async function authDataFromRequest(c: { req: { raw: Request } }): Promise<AuthData | undefined> {
  const cookieHeader = c.req.raw.headers.get('cookie');
  const token = readJwtCookie(cookieHeader);
  if (!token) return undefined;
  try {
    const claims = await verifyOpendeskJwt(token);
    return {
      sub: claims.sub,
      workspaceID: claims.workspaceID,
      role: claims.role,
    };
  } catch (e) {
    console.warn('[opendesk-api] zero endpoint: rejecting bad jwt', (e as Error).message);
    return undefined;
  }
}

app.post('/api/zero/mutate', async (c) => {
  const authData = await authDataFromRequest(c);
  const url = new URL(c.req.raw.url);
  const queryString: Record<string, string> = {};
  url.searchParams.forEach((v, k) => {
    queryString[k] = v;
  });
  const body = (await c.req.raw.json()) as ReadonlyJSONValue;

  const serverMutators = createServerMutators();

  const response = await handleMutateRequest(
    getZql(),
    (transact) =>
      // biome-ignore lint/suspicious/noExplicitAny: Zero's transact callback is generic-erased here
      transact((tx: any, name: string, args: any) => {
        const mutator = mustGetMutator(serverMutators, name);
        return mutator.fn({ tx, args, ctx: authData });
      }),
    queryString,
    body,
    'info',
  );

  return c.json(response);
});

app.post('/api/zero/query', async (c) => {
  const authData = await authDataFromRequest(c);
  const body = (await c.req.raw.json()) as ReadonlyJSONValue;

  const response = await handleQueryRequest(
    // biome-ignore lint/suspicious/noExplicitAny: erased query name+args
    (name: string, args: any) => {
      const query = mustGetQuery(queries, name);
      return query.fn({ args, ctx: authData });
    },
    schema,
    body,
    'info',
  );

  return c.json(response);
});

const port = Number.parseInt(process.env.PORT ?? '3001', 10);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[opendesk-api] listening on http://localhost:${info.port}`);
});
