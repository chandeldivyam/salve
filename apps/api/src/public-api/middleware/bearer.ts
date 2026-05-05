import type { MiddlewareHandler } from 'hono';

export const requireBearerAuth: MiddlewareHandler = async (c, next) => {
  const auth = c.get('auth');
  const authzHeader = c.req.header('authorization');

  if (!auth) {
    return c.json(
      {
        error: {
          type: 'unauthorized',
          code: 'auth.required',
          message: 'Authentication is required',
          requestId: c.get('requestID'),
        },
      },
      401,
    );
  }

  if (!authzHeader?.toLowerCase().startsWith('bearer ')) {
    return c.json(
      {
        error: {
          type: 'unauthorized',
          code: 'auth.bearer_required',
          message: 'This endpoint requires a bearer token (cookie auth is not accepted here).',
          requestId: c.get('requestID'),
        },
      },
      401,
    );
  }

  if (!auth.workspaceID) {
    return c.json(
      {
        error: {
          type: 'forbidden',
          code: 'auth.workspace_required',
          message: 'A workspace-scoped token is required',
          requestId: c.get('requestID'),
        },
      },
      403,
    );
  }

  await next();
};
