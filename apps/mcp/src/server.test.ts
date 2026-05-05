import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { SalveApiError, type SalveClient, type SalveRequestOptions } from '@opendesk/api-client';
import { formatError } from './error.js';
import { buildServer } from './server.js';
import { MCP_ACTIONS } from './tools/registry.js';
import type { SalveMcpContext } from './types.js';

test('lists action tools, composites, prompts, and keeps manifest under budget', async () => {
  const harness = await createHarness();
  try {
    const tools = await harness.client.listTools();
    const names = new Set(tools.tools.map((tool) => tool.name));

    for (const action of MCP_ACTIONS) {
      assert.ok(action.mcp, `${action.id} must declare mcp metadata`);
      assert.ok(names.has(action.mcp.toolName), `${action.id} missing from tools/list`);
    }

    assert.ok(names.has('salve.tickets.triage'));
    assert.ok(names.has('salve.tickets.summarize_thread'));
    assert.ok(names.has('salve.customers.context'));
    const manifestBytes = JSON.stringify(tools).length;
    assert.ok(manifestBytes < 16_000, `tools/list payload is ${manifestBytes} bytes`);
    assert.equal(
      tools.tools.find((tool) => tool.name === 'salve.tickets.close')?.annotations?.destructiveHint,
      true,
    );
    assert.equal(
      tools.tools.find((tool) => tool.name === 'salve.tickets.list')?.annotations?.readOnlyHint,
      true,
    );

    const prompts = await harness.client.listPrompts();
    assert.deepEqual(prompts.prompts.map((prompt) => prompt.name).sort(), [
      'salve.draft-reply',
      'salve.summarize-thread',
      'salve.triage-inbox',
    ]);

    const resources = await harness.client.listResources();
    assert.deepEqual(resources.resources, []);
  } finally {
    await harness.close();
  }
});

test('runs default action tools through client.action with required idempotency', async () => {
  const harness = await createHarness();
  try {
    const whoami = await harness.client.callTool({
      name: 'salve.whoami',
      arguments: {},
    });
    assert.match(textContent(whoami), /agent@example.com/);

    await harness.client.callTool({
      name: 'salve.tickets.create',
      arguments: { title: 'Need help' },
    });
    const createCall = harness.calls.find((call) => call.id === 'tickets.create');
    assert.equal(createCall?.input.title, 'Need help');
    assert.match(createCall?.options.idempotencyKey ?? '', /^[0-9a-f-]{36}$/);
  } finally {
    await harness.close();
  }
});

test('serves composite tools, resources, and prompt templates', async () => {
  const harness = await createHarness();
  try {
    const summary = await harness.client.callTool({
      name: 'salve.tickets.summarize_thread',
      arguments: { ticketId: 'ticket_1', limit: 1 },
    });
    assert.match(textContent(summary), /Thread: #42 Login issue/);

    const ticketResource = await harness.client.readResource({ uri: 'salve://ticket/ticket_1' });
    assert.equal(ticketResource.contents[0]?.mimeType, 'application/json');
    const resourceContent = ticketResource.contents[0];
    assert.match(
      resourceContent && 'text' in resourceContent ? resourceContent.text : '',
      /Login issue/,
    );

    const customerResource = await harness.client.readResource({
      uri: 'salve://customer/customer_1',
    });
    assert.match(textResource(customerResource), /customer@example.com/);

    const viewResource = await harness.client.readResource({ uri: 'salve://view/view_1' });
    assert.match(textResource(viewResource), /Open/);

    const prompt = await harness.client.getPrompt({
      name: 'salve.draft-reply',
      arguments: { ticketId: 'ticket_1', tone: 'friendly' },
    });
    assert.match(
      prompt.messages[0]?.content.type === 'text' ? prompt.messages[0].content.text : '',
      /ticket_1/,
    );
  } finally {
    await harness.close();
  }
});

test('formats Salve API and validation errors with shared hints', () => {
  const scopeMissing = formatError(
    new SalveApiError({
      type: 'forbidden',
      code: 'auth.scope_missing',
      message: 'Token does not have the required scope',
      status: 403,
      requestId: 'req_test',
    }),
    'tickets.resolve',
  );
  assert.match(scopeMissing, /tickets.resolve failed/);
  assert.match(scopeMissing, /Mint a token with the required scope/);

  const authRequired = formatError(
    new SalveApiError({
      type: 'unauthorized',
      code: 'auth.required',
      message: 'Authentication is required',
      status: 401,
    }),
  );
  assert.match(authRequired, /Set SALVE_TOKEN/);

  const validation = formatError(
    new SalveApiError({
      type: 'validation_error',
      code: 'validation_error',
      message: 'Invalid input',
      status: 400,
      field: 'title',
    }),
  );
  assert.match(validation, /validation_error/);
  assert.match(validation, /Field: title/);

  const reusedKey = formatError(
    new SalveApiError({
      type: 'conflict',
      code: 'idempotency_key.reused_with_different_request',
      message: 'Idempotency key was reused with a different request',
      status: 409,
    }),
  );
  assert.match(reusedKey, /Use a fresh idempotency key/);

  const network = formatError(
    new SalveApiError({
      type: 'internal_error',
      code: 'request.failed',
      message: 'fetch failed',
      status: 0,
    }),
  );
  assert.match(network, /Check SALVE_API_URL/);
});

interface ActionCall {
  id: string;
  input: Record<string, unknown>;
  options: SalveRequestOptions;
}

async function createHarness(): Promise<{
  client: Client;
  calls: ActionCall[];
  close: () => Promise<void>;
}> {
  const calls: ActionCall[] = [];
  const context: SalveMcpContext = {
    client: fakeSalveClient(calls),
    auth: {
      userId: 'user_1',
      email: 'agent@example.com',
      workspaceId: 'workspace_1',
      role: 'owner',
      principalKind: 'user',
      memberId: 'member_1',
      apiKeyId: 'key_1',
      scopes: ['tickets:read', 'tickets:write'],
      requestId: 'req_test',
    },
  };

  const server = await buildServer({ context });
  const client = new Client({ name: 'mcp-test', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return {
    client,
    calls,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

function fakeSalveClient(calls: ActionCall[]): SalveClient {
  const client = {
    action: async (
      id: string,
      input: Record<string, unknown>,
      options: SalveRequestOptions = {},
    ) => {
      calls.push({ id, input, options });
      if (id === 'whoami') return whoami();
      if (id === 'tickets.create') return { ticket: ticket() };
      return { ok: true, id, input };
    },
    tickets: {
      get: async () => ({ ticket: ticket() }),
      list: async () => ({ data: [ticketSummary()], nextCursor: null, hasMore: false }),
    },
    customers: {
      get: async () => ({ customer: customer() }),
    },
    views: {
      tickets: async () => ({
        view: view(),
        data: [ticketSummary()],
        nextCursor: null,
        hasMore: false,
      }),
    },
    settings: {
      tags: {
        list: async () => ({
          groups: [{ id: 'group_1', label: 'Type', color: '#3366ff' }],
          tags: [
            {
              id: 'tag_1',
              label: 'Bug',
              color: '#3366ff',
              groupId: 'group_1',
              sortOrder: 1,
              archivedAt: null,
              createdAt: ISO,
              updatedAt: ISO,
              group: {
                id: 'group_1',
                label: 'Type',
                color: '#3366ff',
                sortOrder: 1,
                archivedAt: null,
                createdAt: ISO,
                updatedAt: ISO,
              },
            },
          ],
        }),
      },
    },
  };
  return client as unknown as SalveClient;
}

const ISO = '2026-05-05T00:00:00.000Z';

function whoami() {
  return {
    userId: 'user_1',
    email: 'agent@example.com',
    workspaceId: 'workspace_1',
    role: 'owner',
    principalKind: 'user',
    memberId: 'member_1',
    apiKeyId: 'key_1',
    scopes: ['tickets:read', 'tickets:write'],
    requestId: 'req_test',
  };
}

function ticket() {
  return {
    ...ticketSummary(),
    tags: [],
    customFields: [
      {
        id: 'value_1',
        fieldId: 'field_1',
        key: 'tier',
        displayName: 'Tier',
        type: 'text',
        value: 'enterprise',
        updatedById: 'user_1',
        createdAt: ISO,
        updatedAt: ISO,
      },
    ],
    messages: [
      {
        id: 'message_1',
        ticketId: 'ticket_1',
        authorType: 'customer',
        authorUserId: null,
        authorCustomerId: 'customer_1',
        bodyHtml: '<p>I cannot log in.</p>',
        bodyText: 'I cannot log in.',
        isInternal: false,
        editedAt: null,
        deletedAt: null,
        createdAt: ISO,
        updatedAt: ISO,
        attachments: [],
      },
    ],
  };
}

function ticketSummary() {
  return {
    id: 'ticket_1',
    shortId: 42,
    title: 'Login issue',
    description: 'Cannot log in',
    status: 'open',
    priority: 'normal',
    customerId: 'customer_1',
    assigneeId: null,
    createdById: 'user_1',
    resolvedById: null,
    closedById: null,
    createdAt: ISO,
    updatedAt: ISO,
    firstResponseAt: null,
    resolvedAt: null,
    closedAt: null,
    customer: {
      id: 'customer_1',
      email: 'customer@example.com',
      name: 'Customer',
      displayName: 'Customer',
      avatarUrl: null,
    },
  };
}

function customer() {
  return {
    id: 'customer_1',
    email: 'customer@example.com',
    name: 'Customer',
    displayName: 'Customer',
    avatarUrl: null,
    alternateEmails: [],
    firstSeenAt: ISO,
    lastSeenAt: ISO,
    phone: null,
    location: null,
    metadata: {},
    createdAt: ISO,
    updatedAt: ISO,
    tags: [],
    customFields: [],
    notes: [],
    events: [],
  };
}

function view() {
  return {
    id: 'view_1',
    kind: 'inbox',
    scope: 'workspace',
    ownerId: null,
    label: 'Open',
    description: null,
    icon: null,
    color: null,
    query: {},
    sort: {},
    groupBy: null,
    displayProps: null,
    archivedAt: null,
    createdAt: ISO,
    updatedAt: ISO,
  };
}

function textContent(result: unknown): string {
  const content =
    result && typeof result === 'object' && Array.isArray((result as { content?: unknown }).content)
      ? (result as { content: unknown[] }).content
      : [];
  const first = content[0] as { type?: string; text?: string } | undefined;
  return first?.type === 'text' ? (first.text ?? '') : '';
}

function textResource(result: unknown): string {
  const contents =
    result &&
    typeof result === 'object' &&
    Array.isArray((result as { contents?: unknown }).contents)
      ? (result as { contents: unknown[] }).contents
      : [];
  const first = contents[0] as { text?: string } | undefined;
  return first?.text ?? '';
}
