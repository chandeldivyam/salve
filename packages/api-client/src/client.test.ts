import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ALL_ACTIONS } from '@salve/action-contracts';
import { ACTION_METHOD_PATHS, SalveClient } from './client.js';
import { SalveApiError } from './errors.js';
import type { SalveFetch } from './fetch.js';

const token = 'slv_pat_test';
const baseUrl = 'http://api.test';

test('every action contract has a namespace method', () => {
  const client = new SalveClient({
    token,
    baseUrl,
    fetch: async () => new Response('{}', { status: 200 }),
  });

  for (const action of ALL_ACTIONS) {
    let target: unknown = client;
    for (const segment of ACTION_METHOD_PATHS[action.id]) {
      assert.equal(typeof target, 'object', `${action.id} segment ${segment} parent missing`);
      assert.notEqual(target, null, `${action.id} segment ${segment} parent null`);
      target = (target as Record<string, unknown>)[segment];
    }
    assert.equal(typeof target, 'function', `${action.id} does not resolve to a function`);
  }
});

test('writes generate one idempotency key and reuse it across 5xx retry', async () => {
  const calls: CapturedRequest[] = [];
  const fetch = captureFetch(calls, [
    jsonResponse({ error: { type: 'internal_error', code: 'boom', message: 'boom' } }, 503),
    jsonResponse({}, 200),
  ]);
  const client = new SalveClient({
    token,
    baseUrl,
    fetch,
    retry: { maxAttempts: 2, baseDelayMs: 0 },
  });

  await client.settings.apiTokens.revoke('tok_123');

  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.method, 'DELETE');
  assert.equal(calls[0]?.url, `${baseUrl}/v1/settings/api-tokens/tok_123`);
  assert.equal(calls[0]?.authorization, `Bearer ${token}`);
  assert.match(calls[0]?.idempotencyKey ?? '', /^[0-9a-f-]{36}$/);
  assert.equal(calls[1]?.idempotencyKey, calls[0]?.idempotencyKey);
});

test('idempotency key override works through raw action caller', async () => {
  const calls: CapturedRequest[] = [];
  const client = new SalveClient({
    token,
    baseUrl,
    fetch: captureFetch(calls, [jsonResponse({}, 200)]),
  });

  await client.action(
    'settings.apiTokens.revoke',
    { tokenId: 'tok_override' },
    { idempotencyKey: 'fixed-key' },
  );

  assert.equal(calls[0]?.idempotencyKey, 'fixed-key');
});

test('baseUrl may point at the API origin or the versioned /v1 root', async () => {
  const calls: CapturedRequest[] = [];
  const client = new SalveClient({
    token,
    baseUrl: `${baseUrl}/v1`,
    fetch: captureFetch(calls, [jsonResponse({ data: [], nextCursor: null, hasMore: false }, 200)]),
  });

  await client.tickets.list();

  assert.equal(calls[0]?.url, `${baseUrl}/v1/tickets`);
});

test('listAll walks cursor pages', async () => {
  const calls: CapturedRequest[] = [];
  const client = new SalveClient({
    token,
    baseUrl,
    fetch: async (input, init) => {
      const captured = captureRequest(input, init);
      calls.push(captured);
      const url = new URL(captured.url);
      if (!url.searchParams.get('cursor')) {
        return jsonResponse(
          { data: [ticketSummary('ticket_1')], nextCursor: 'cursor_2', hasMore: true },
          200,
        );
      }
      return jsonResponse(
        { data: [ticketSummary('ticket_2')], nextCursor: null, hasMore: false },
        200,
      );
    },
  });

  const ids: string[] = [];
  for await (const ticket of client.tickets.listAll({ limit: 1 })) ids.push(ticket.id);

  assert.deepEqual(ids, ['ticket_1', 'ticket_2']);
  assert.equal(calls.length, 2);
  assert.equal(new URL(calls[0]?.url ?? '').searchParams.get('limit'), '1');
  assert.equal(new URL(calls[1]?.url ?? '').searchParams.get('cursor'), 'cursor_2');
});

test('error envelope is unwrapped into SalveApiError', async () => {
  const client = new SalveClient({
    token,
    baseUrl,
    fetch: async () =>
      jsonResponse(
        {
          error: {
            type: 'validation_error',
            code: 'request.invalid',
            message: 'Bad request',
            field: 'tokenId',
            requestId: 'req_123',
          },
        },
        400,
      ),
  });

  await assert.rejects(
    () => client.settings.apiTokens.revoke('tok_bad'),
    (error: unknown) => {
      assert.ok(error instanceof SalveApiError);
      assert.equal(error.type, 'validation_error');
      assert.equal(error.code, 'request.invalid');
      assert.equal(error.status, 400);
      assert.equal(error.field, 'tokenId');
      assert.equal(error.requestId, 'req_123');
      return true;
    },
  );
});

interface CapturedRequest {
  url: string;
  method: string | undefined;
  authorization: string | null;
  idempotencyKey: string | null;
  body: BodyInit | null | undefined;
}

function captureFetch(calls: CapturedRequest[], responses: Response[]): SalveFetch {
  return async (input, init) => {
    calls.push(captureRequest(input, init));
    const response = responses.shift();
    if (!response) throw new Error('missing fake response');
    return response;
  };
}

function captureRequest(input: RequestInfo | URL, init: RequestInit | undefined): CapturedRequest {
  const headers = new Headers(init?.headers);
  return {
    url: String(input),
    method: init?.method,
    authorization: headers.get('authorization'),
    idempotencyKey: headers.get('idempotency-key'),
    body: init?.body,
  };
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'X-Request-Id': `req_${status}`,
    },
  });
}

function ticketSummary(id: string) {
  return {
    id,
    shortId: 1,
    title: id,
    description: null,
    status: 'open',
    priority: 'normal',
    customerId: null,
    assigneeId: null,
    createdById: null,
    resolvedById: null,
    closedById: null,
    createdAt: '2026-05-05T00:00:00.000Z',
    updatedAt: '2026-05-05T00:00:00.000Z',
    firstResponseAt: null,
    resolvedAt: null,
    closedAt: null,
    customer: null,
  };
}
