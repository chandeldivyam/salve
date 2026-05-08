import { serve } from '@hono/node-server';
import { mustGetMutator, mustGetQuery, type ReadonlyJSONValue } from '@rocicorp/zero';
import { handleMutateRequest, handleQueryRequest } from '@rocicorp/zero/server';
import { SERVICE_NAME } from '@salve/core';
import { authSchema, getDb } from '@salve/db';
import { type AuthData, queries, schema } from '@salve/zero-schema';
import { and, eq } from 'drizzle-orm';
import { Hono, type MiddlewareHandler } from 'hono';
import { cors } from 'hono/cors';
import { serve as inngestServe } from 'inngest/hono';
import { auth } from './auth.js';
import { handleCustomerEventIngest } from './customer-events.js';
import { handleGetSigned, handlePresign } from './files.js';
import {
  handleDevInboundEmail,
  handleMailgunInboundEmail,
  handleSesInboundEmail,
} from './inbound/email.js';
import { inngest } from './inngest/client.js';
import {
  bounceRateWatchdog,
  deliverMessage,
  deliverMessageRecovery,
  processProviderWebhook,
  provisionDomain,
  pruneIdempotencyRecords,
  routeInboundMessage,
  verifyDomain,
} from './inngest/functions/index.js';
import { buildJwtCookieHeader, issueSalveJwt, readJwtCookie, verifySalveJwt } from './jwt.js';
import { authMiddleware, authOf, requireUser, requireWorkspace } from './middleware.js';
import {
  handleCreatePat,
  handleCreateServiceAccount,
  handleDeleteServiceAccount,
  handleRevokePat,
} from './public-api/api-tokens.js';
import { customerNotesRouter, customersRouter } from './public-api/customers.js';
import { requestIDMiddleware } from './public-api/middleware/idempotency.js';
import { handleOpenApi } from './public-api/openapi.js';
import { settingsRouter } from './public-api/settings.js';
import { ticketsRouter } from './public-api/tickets.js';
import { viewsRouter } from './public-api/views.js';
import { handleWhoami, handleWorkspaceList } from './public-api/whoami.js';
import { handleSearch } from './routes/search.js';
import { createServerMutators, type PostCommitTask } from './server-mutators.js';
import {
  handleEmailAddressAdd,
  handleEmailDomainAdd,
  handleEmailDomainVerify,
  handleEmailDomainVerifyDev,
  handleEmailRoutingRuleUpsert,
} from './settings/email-domains.js';
import { handleMailgunWebhook } from './webhooks/mailgun.js';
import { handleSesWebhook } from './webhooks/ses.js';
import { getZql } from './zero-upstream.js';

const app = new Hono();

// Trusted origins for cross-origin browser fetches. In dev the web app is
// served same-origin via Vite's server.proxy, so CORS is essentially a no-op
// there. In prod (web on app.usesalve.com, API on api.usesalve.com) this is what
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

app.use(
  '/v1/*',
  cors({
    origin: (origin) => (origin && trustedOrigins.includes(origin) ? origin : undefined),
    credentials: false,
    allowHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Request-Id'],
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    maxAge: 600,
  }),
);

// Run before every request. Populates `c.var.auth` and refreshes the salve
// JWT cookie on authenticated requests.
app.use('*', authMiddleware);

app.get('/', (c) =>
  c.text(`Hello from ${SERVICE_NAME}-api. Brand: Salve. See /healthz for status.`),
);

app.get('/healthz', (c) =>
  c.json({
    status: 'ok',
    service: 'salve-api',
    version: '0.0.0',
  }),
);

// Re-issue the salve JWT for a different workspace. Verifies membership
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

  // Stamp a fresh salve JWT cookie eagerly (saves the client a round-trip).
  // Per RFC 6265 the appended Set-Cookie wins on the client over any earlier one
  // emitted by `authMiddleware` for the previous workspace.
  const role =
    membership.role === 'owner' || membership.role === 'admin' || membership.role === 'agent'
      ? membership.role
      : 'agent';
  const token = await issueSalveJwt({
    userID: ctxAuth.userID,
    email: ctxAuth.email,
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

// File presign endpoints (Phase 2c). Both require an active workspace —
// the s3Key is namespaced under `workspaces/<workspaceID>/`. See
// `apps/api/src/files.ts`.
app.post('/api/files/presign', requireWorkspace, handlePresign);
app.post('/api/files/get', requireWorkspace, handleGetSigned);
app.get('/api/search', requireWorkspace, handleSearch);
app.post('/api/customers/:customerID/events', requireWorkspace, handleCustomerEventIngest);

// Phase 3a settings: email domains (BYO sending domain).
//   POST /api/settings/email/domains       — add a domain + default email channel/address
//   POST /api/settings/email/domains/:id/addresses — add another sending/receiving address
//   POST /api/settings/email/domains/:id/verify-dev — flip dns_status='verified' (dev override)
app.post('/api/settings/email/domains', requireWorkspace, handleEmailDomainAdd);
app.post('/api/settings/email/domains/:id/addresses', requireWorkspace, handleEmailAddressAdd);
app.post(
  '/api/settings/email/domains/:id/verify-dev',
  requireWorkspace,
  handleEmailDomainVerifyDev,
);
app.post('/api/settings/channels/email/domains', requireWorkspace, handleEmailDomainAdd);
app.post('/api/settings/channels/email/addresses', requireWorkspace, handleEmailAddressAdd);
app.post(
  '/api/settings/channels/email/routing-rules',
  requireWorkspace,
  handleEmailRoutingRuleUpsert,
);
app.post('/api/settings/email/routing-rules', requireWorkspace, handleEmailRoutingRuleUpsert);
app.post(
  '/api/settings/channels/email/domains/:id/verify-dev',
  requireWorkspace,
  handleEmailDomainVerifyDev,
);
// Production-safe verify trigger: dispatches `domain/verification.requested`
// to Inngest so the verify-domain function checks Mailgun/SES on demand
// instead of waiting for the 30-min cron.
app.post('/api/settings/email/domains/:id/verify', requireWorkspace, handleEmailDomainVerify);
app.post(
  '/api/settings/channels/email/domains/:id/verify',
  requireWorkspace,
  handleEmailDomainVerify,
);

// Phase A — temporary token write endpoints. Reads go via Zero
// (`queries.apiTokensForCurrentUser`, `queries.serviceAccounts`,
// `queries.serviceAccountTokens`). Only writes are REST because plaintext
// is shown once at create time. Re-expressed as actions in Phase D.
app.post('/api/settings/api-tokens', requireWorkspace, handleCreatePat);
app.delete('/api/settings/api-tokens/:id', requireWorkspace, handleRevokePat);
app.post('/api/settings/service-accounts', requireWorkspace, handleCreateServiceAccount);
app.delete('/api/settings/service-accounts/:id', requireWorkspace, handleDeleteServiceAccount);

// Phase A — /v1/_meta/whoami smoke route. Bearer-only; mounts request-ID
// middleware so the response carries X-Request-Id.
app.get('/v1/_meta/whoami', requestIDMiddleware, handleWhoami);
app.get('/v1/_meta/workspaces', requestIDMiddleware, handleWorkspaceList);
app.get('/v1/openapi.json', requestIDMiddleware, handleOpenApi);
app.route('/v1/tickets', ticketsRouter);
app.route('/v1/customers', customersRouter);
app.route('/v1/customer-notes', customerNotesRouter);
app.route('/v1/views', viewsRouter);
app.route('/v1/settings', settingsRouter);

app.post('/api/inbound/email/dev', handleDevInboundEmail);
app.post('/api/inbound/email/ses', handleSesInboundEmail);
// `/mime` suffix is required: it tells Mailgun's Routes forward() action to
// include the full RFC 5322 `body-mime` field. Without it we'd only get the
// pre-parsed parts and lose attachment fidelity.
app.post('/api/inbound/email/mailgun/mime', handleMailgunInboundEmail);
app.post('/api/webhooks/ses', handleSesWebhook);
app.post('/api/webhooks/mailgun', handleMailgunWebhook);

// Inngest serve endpoint. The Inngest dev server (docker-compose) introspects
// `/api/inngest` to discover registered functions; a POST to this URL
// dispatches step calls. We mount with hono adapter from inngest 4.x.
//
// `serveOrigin` overrides the host that Inngest dev sees in the registration
// payload. In our docker-compose the Inngest container needs to reach the
// host process at `host.docker.internal:3001` (the API runs on the host, not
// in a container — apps/api uses tsx watch). Without this override the
// adapter sends back `localhost:3001` from the request host header, which
// resolves to the Inngest container itself.
app.use(
  '/api/inngest',
  inngestServe({
    client: inngest,
    functions: [
      deliverMessage,
      provisionDomain,
      routeInboundMessage,
      verifyDomain,
      processProviderWebhook,
      deliverMessageRecovery,
      bounceRateWatchdog,
      pruneIdempotencyRecords,
    ],
    serveOrigin: process.env.INNGEST_SERVE_ORIGIN ?? 'http://host.docker.internal:3001',
  }) as MiddlewareHandler,
);

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

async function authDataFromRequest(c: { req: { raw: Request } }): Promise<AuthData | undefined> {
  const cookieHeader = c.req.raw.headers.get('cookie');
  const token = readJwtCookie(cookieHeader);
  if (!token) return undefined;
  try {
    const claims = await verifySalveJwt(token);
    return {
      sub: claims.sub,
      email: claims.email,
      workspaceID: claims.workspaceID,
      role: claims.role,
      principalKind: 'user',
    };
  } catch (e) {
    console.warn('[salve-api] zero endpoint: rejecting bad jwt', (e as Error).message);
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

  const postCommitTasks: PostCommitTask[] = [];
  const serverMutators = createServerMutators(postCommitTasks);

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

  for (const task of postCommitTasks) {
    await task();
  }

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
  console.log(`[salve-api] listening on http://localhost:${info.port}`);
});
