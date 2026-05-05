// Public API meta routes.
//
// Bearer-token-only endpoints used by the SDK and CLI for login validation and
// workspace selection. They also give integration tests (and humans with curl)
// a direct way to verify the bearer chain works end-to-end:
//
//   curl -H "Authorization: Bearer slv_pat_…" \
//        http://localhost:3001/v1/_meta/whoami
//
// Cookie auth deliberately is not accepted here — the goal is to validate the
// bearer path exactly as external tools use it.

import { authSchema, getDb } from '@salve/db';
import { asc, eq } from 'drizzle-orm';
import type { Context } from 'hono';
import type { AuthContext } from '../middleware.js';

export async function handleWhoami(c: Context): Promise<Response> {
  const guard = requireBearerContext(c);
  if (guard instanceof Response) return guard;
  const { auth, requestId } = guard;

  return c.json({
    userId: auth.userID,
    email: auth.email,
    workspaceId: auth.workspaceID,
    role: auth.role,
    principalKind: auth.principalKind,
    memberId: auth.memberID ?? null,
    apiKeyId: auth.apiKeyID ?? null,
    scopes: auth.scopes ?? [],
    requestId,
  });
}

export async function handleWorkspaceList(c: Context): Promise<Response> {
  const guard = requireBearerContext(c);
  if (guard instanceof Response) return guard;
  const { auth } = guard;

  if (!auth.workspaceID) {
    return c.json({ data: [] });
  }

  const db = getDb();
  if (auth.principalKind === 'service_account') {
    const rows = await db
      .select({
        id: authSchema.organization.id,
        name: authSchema.organization.name,
        slug: authSchema.organization.slug,
        createdAt: authSchema.organization.createdAt,
      })
      .from(authSchema.organization)
      .where(eq(authSchema.organization.id, auth.workspaceID))
      .limit(1);
    const workspace = rows[0];
    return c.json({
      data: workspace
        ? [
            {
              id: workspace.id,
              name: workspace.name,
              slug: workspace.slug,
              role: auth.role,
              kind: 'service_account' as const,
              active: true,
              createdAt: workspace.createdAt ? workspace.createdAt.toISOString() : null,
            },
          ]
        : [],
    });
  }

  const rows = await db
    .select({
      id: authSchema.organization.id,
      name: authSchema.organization.name,
      slug: authSchema.organization.slug,
      role: authSchema.member.role,
      kind: authSchema.member.kind,
      createdAt: authSchema.organization.createdAt,
    })
    .from(authSchema.member)
    .innerJoin(
      authSchema.organization,
      eq(authSchema.organization.id, authSchema.member.organizationId),
    )
    .where(eq(authSchema.member.userId, auth.userID))
    .orderBy(asc(authSchema.organization.name));

  return c.json({
    data: rows.map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      role: workspace.role,
      kind: workspace.kind === 'service_account' ? 'service_account' : 'user',
      active: workspace.id === auth.workspaceID,
      createdAt: workspace.createdAt ? workspace.createdAt.toISOString() : null,
    })),
  });
}

function requireBearerContext(c: Context):
  | Response
  | {
      auth: AuthContext;
      requestId: string;
    } {
  const auth = c.get('auth');
  const requestId = c.get('requestID');
  const authzHeader = c.req.header('authorization');

  if (!auth) {
    return c.json(
      {
        error: {
          type: 'unauthorized',
          code: 'auth.required',
          message: 'Authentication is required',
          requestId,
        },
      },
      401,
    );
  }

  // Reject cookie-only sessions on these routes — they exist to validate bearer.
  if (!authzHeader?.toLowerCase().startsWith('bearer ')) {
    return c.json(
      {
        error: {
          type: 'unauthorized',
          code: 'auth.bearer_required',
          message: 'This endpoint requires a bearer token (cookie auth is not accepted here).',
          requestId,
        },
      },
      401,
    );
  }

  return { auth, requestId };
}
