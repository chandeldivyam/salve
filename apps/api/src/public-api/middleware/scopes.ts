import type { MiddlewareHandler } from 'hono';
import { type ApiScope, hasScopes } from '../scopes.js';

export function requireApiScopes(required: readonly ApiScope[]): MiddlewareHandler {
  return async (c, next) => {
    const auth = c.get('auth');
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

    if (!hasScopes(auth.scopes, required)) {
      return c.json(
        {
          error: {
            type: 'forbidden',
            code: 'auth.scope_missing',
            message: 'Token does not have the required scope',
            requestId: c.get('requestID'),
          },
        },
        403,
      );
    }

    await next();
  };
}
