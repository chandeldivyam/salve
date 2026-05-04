// Phase A — /v1/_meta/whoami smoke route.
//
// Bearer-token-only debug endpoint. Echoes the resolved auth context so
// integration tests (and humans with curl) can verify the whole bearer chain
// works end-to-end:
//
//   curl -H "Authorization: Bearer slv_pat_…" \
//        http://localhost:3001/v1/_meta/whoami
//
// Stays available post-v1 as a debugging surface; the underscore prefix marks
// it as not part of the documented public API. Cookie auth deliberately not
// accepted here — the goal is to validate the bearer path.

import type { Context } from 'hono';

export async function handleWhoami(c: Context): Promise<Response> {
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

  // Reject cookie-only sessions on this route — it exists to validate bearer.
  // Cleanest signal: a bearer header was actually sent.
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
