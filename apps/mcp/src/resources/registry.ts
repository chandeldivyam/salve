import { type McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import type { SalveMcpContext } from '../types.js';

export function registerResources(server: McpServer, context: SalveMcpContext): void {
  server.registerResource(
    'ticket',
    new ResourceTemplate('salve://ticket/{id}', { list: undefined }),
    {
      title: 'Ticket',
      description: 'Ticket detail with the last 50 messages.',
      mimeType: 'application/json',
    },
    async (uri, variables) => {
      const id = variable(variables.id);
      const { ticket } = await context.client.tickets.get(id);
      const messages = ticket.messages ?? [];
      return jsonResource(uri, {
        ticket: { ...ticket, messages: undefined },
        messages: messages.slice(-50),
      });
    },
  );

  server.registerResource(
    'customer',
    new ResourceTemplate('salve://customer/{id}', { list: undefined }),
    {
      title: 'Customer',
      description: 'Customer detail with the most recent 10 tickets.',
      mimeType: 'application/json',
    },
    async (uri, variables) => {
      const id = variable(variables.id);
      const [{ customer }, tickets] = await Promise.all([
        context.client.customers.get(id),
        context.client.tickets.list({ customerId: id, limit: 10 }),
      ]);
      return jsonResource(uri, { customer, recentTickets: tickets.data });
    },
  );

  server.registerResource(
    'view',
    new ResourceTemplate('salve://view/{id}', { list: undefined }),
    {
      title: 'Inbox View',
      description: 'Saved inbox view with a sample of matching tickets.',
      mimeType: 'application/json',
    },
    async (uri, variables) => {
      const id = variable(variables.id);
      const result = await context.client.views.tickets(id, { limit: 25 });
      return jsonResource(uri, {
        view: result.view,
        sampleTickets: result.data,
        nextCursor: result.nextCursor,
        hasMore: result.hasMore,
      });
    },
  );
}

function jsonResource(uri: URL, value: unknown): ReadResourceResult {
  return {
    contents: [
      {
        uri: uri.toString(),
        mimeType: 'application/json',
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

function variable(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}
