import { createHash, randomUUID } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';

export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key';
export const REQUEST_ID_HEADER = 'X-Request-Id';

export type IdempotencyPolicy = 'required' | 'optional' | 'none';

declare module 'hono' {
  interface ContextVariableMap {
    idempotencyKey: string | null;
    requestID: string;
  }
}

export const requestIDMiddleware: MiddlewareHandler = async (c, next) => {
  const requestID = c.req.header(REQUEST_ID_HEADER) || `req_${randomUUID()}`;
  c.set('requestID', requestID);
  c.header(REQUEST_ID_HEADER, requestID);
  await next();
};

export function idempotencyKeyMiddleware(policy: IdempotencyPolicy): MiddlewareHandler {
  return async (c, next) => {
    const key = c.req.header(IDEMPOTENCY_KEY_HEADER)?.trim() || null;
    if (policy === 'required' && !key) {
      return c.json(
        {
          error: {
            type: 'validation_error',
            code: 'idempotency_key.required',
            message: 'Idempotency-Key header is required for this request',
            field: IDEMPOTENCY_KEY_HEADER,
            requestId: c.get('requestID'),
          },
        },
        400,
      );
    }

    c.set('idempotencyKey', policy === 'none' ? null : key);
    await next();
  };
}

export function hashIdempotencyRequest(actionID: string, input: unknown): string {
  return createHash('sha256')
    .update(actionID)
    .update('\0')
    .update(stableStringify(input))
    .digest('base64url');
}

function stableStringify(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;

  const record = value as Record<string, unknown>;
  const entries = Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`);
  return `{${entries.join(',')}}`;
}
