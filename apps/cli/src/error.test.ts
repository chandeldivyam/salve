import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SalveApiError } from '@opendesk/api-client';
import { z } from 'zod';
import { formatError } from './error.js';

test('formatError renders Salve API context and 4xx exit code', () => {
  const formatted = formatError(
    new SalveApiError({
      type: 'forbidden',
      code: 'auth.scope_missing',
      message: 'Token does not have tickets:write',
      status: 403,
      requestId: 'req_test',
    }),
  );

  assert.equal(formatted.exitCode, 1);
  assert.match(formatted.message, /auth\.scope_missing \(403 forbidden\)/);
  assert.match(formatted.message, /Request: req_test/);
  assert.match(formatted.message, /required scope/);
});

test('formatError renders client-side ZodError with field paths', () => {
  const schema = z.object({ color: z.string().regex(/^#[0-9a-fA-F]{6}$/) });
  const result = schema.safeParse({ color: '#fed' });
  assert.equal(result.success, false);
  if (result.success) return;

  const formatted = formatError(result.error);
  assert.equal(formatted.exitCode, 1);
  assert.match(formatted.message, /validation_error \(client-side\)/);
  assert.match(formatted.message, /color: /);
  assert.match(formatted.message, /CLI rejected the request before sending/);
});

test('formatError maps network failures to exit code 2', () => {
  const formatted = formatError(
    new SalveApiError({
      type: 'internal_error',
      code: 'request.failed',
      message: 'Salve API request failed',
      status: 0,
    }),
  );

  assert.equal(formatted.exitCode, 2);
});
