import { serve } from '@hono/node-server';
import { SERVICE_NAME } from '@opendesk/core';
import { authSchema, getDb } from '@opendesk/db';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { auth } from './auth.js';
import { buildJwtCookieHeader, issueOpendeskJwt } from './jwt.js';
import { authMiddleware, authOf, requireUser } from './middleware.js';

const app = new Hono();

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

const port = Number.parseInt(process.env.PORT ?? '3001', 10);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[opendesk-api] listening on http://localhost:${info.port}`);
});
