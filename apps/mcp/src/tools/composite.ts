import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { mcpErrorResult } from '../error.js';
import type { SalveMcpContext } from '../types.js';

const ticketIDSchema = z.object({
  ticketId: z.string().min(1),
});

const summarizeThreadSchema = ticketIDSchema.extend({
  limit: z.number().int().min(1).max(200).optional(),
});

const customerContextSchema = z.object({
  customerId: z.string().min(1),
});

export function registerCompositeTools(server: McpServer, context: SalveMcpContext): void {
  server.registerTool(
    'salve.tickets.triage',
    {
      title: 'salve.tickets.triage',
      description:
        'Gather compact triage context for one ticket: ticket detail, customer context, and workspace tag taxonomy.',
      inputSchema: ticketIDSchema,
      annotations: { readOnlyHint: true },
    },
    async ({ ticketId }) => triageTicket(context, ticketId),
  );

  server.registerTool(
    'salve.tickets.summarize_thread',
    {
      title: 'salve.tickets.summarize_thread',
      description:
        'Return compact ticket header and last messages for handoff summarization. limit defaults to 50, max 200.',
      inputSchema: summarizeThreadSchema,
      annotations: { readOnlyHint: true },
    },
    async ({ ticketId, limit }) => summarizeThread(context, ticketId, limit),
  );

  server.registerTool(
    'salve.customers.context',
    {
      title: 'salve.customers.context',
      description:
        'Gather customer profile, tags, custom fields, recent events, and the most recent tickets.',
      inputSchema: customerContextSchema,
      annotations: { readOnlyHint: true },
    },
    async ({ customerId }) => customerContext(context, customerId),
  );
}

async function triageTicket(context: SalveMcpContext, ticketId: string): Promise<CallToolResult> {
  try {
    const { ticket } = await context.client.tickets.get(ticketId);
    const [customer, tagTaxonomy] = await Promise.all([
      ticket.customer?.id
        ? context.client.customers.get(ticket.customer.id).catch(() => null)
        : null,
      context.client.settings.tags.list({}).catch(() => ({ groups: [], tags: [] })),
    ]);

    return markdownResult([
      `# Triage Context: #${ticket.shortId} ${ticket.title}`,
      `Status: ${ticket.status}`,
      `Priority: ${ticket.priority}`,
      `Customer: ${ticket.customer?.email ?? 'unknown'}`,
      `Assignee: ${ticket.assigneeId ?? 'unassigned'}`,
      '',
      '## Latest Messages',
      ...messageLines(ticket.messages ?? [], 10),
      '',
      '## Customer',
      customer
        ? `${customer.customer.email} (${customer.customer.displayName ?? customer.customer.name ?? 'unnamed'})`
        : 'No customer profile available.',
      customer
        ? `Tags: ${customer.customer.tags.map((tag) => tag.label).join(', ') || 'none'}`
        : '',
      '',
      '## Workspace Tags',
      tagTaxonomy.tags
        .map((tag) => `${tag.label}${tag.group ? ` (${tag.group.label})` : ''}`)
        .join(', ') || 'none',
      '',
      '## Editable Custom Fields',
      [
        ...(ticket.customFields ?? []).map((field) => `ticket.${field.key}`),
        ...(customer?.customer.customFields ?? []).map((field) => `customer.${field.key}`),
      ].join(', ') || 'none',
    ]);
  } catch (error) {
    return mcpErrorResult(error, 'salve.tickets.triage');
  }
}

async function summarizeThread(
  context: SalveMcpContext,
  ticketId: string,
  limit = 50,
): Promise<CallToolResult> {
  try {
    const { ticket } = await context.client.tickets.get(ticketId);
    const messages = (ticket.messages ?? []).slice(-limit);
    return markdownResult([
      `# Thread: #${ticket.shortId} ${ticket.title}`,
      `Status: ${ticket.status}`,
      `Priority: ${ticket.priority}`,
      `Customer: ${ticket.customer?.email ?? 'unknown'}`,
      '',
      '## Messages',
      ...messageLines(messages, limit),
    ]);
  } catch (error) {
    return mcpErrorResult(error, 'salve.tickets.summarize_thread');
  }
}

async function customerContext(
  context: SalveMcpContext,
  customerId: string,
): Promise<CallToolResult> {
  try {
    const [{ customer }, tickets] = await Promise.all([
      context.client.customers.get(customerId),
      context.client.tickets.list({ customerId, limit: 10 }).catch(() => ({
        data: [],
        nextCursor: null,
        hasMore: false,
      })),
    ]);

    return markdownResult([
      `# Customer: ${customer.email}`,
      `Name: ${customer.displayName ?? customer.name ?? 'unknown'}`,
      `Phone: ${customer.phone ?? 'unknown'}`,
      `Location: ${customer.location ?? 'unknown'}`,
      `Tags: ${customer.tags.map((tag) => tag.label).join(', ') || 'none'}`,
      '',
      '## Custom Fields',
      ...(customer.customFields.length > 0
        ? customer.customFields.map((field) => `- ${field.key}: ${JSON.stringify(field.value)}`)
        : ['none']),
      '',
      '## Recent Events',
      ...customer.events
        .slice(-20)
        .map(
          (event) => `- ${event.occurredAt} ${event.eventName} ${JSON.stringify(event.properties)}`,
        ),
      '',
      '## Recent Tickets',
      ...tickets.data.map((ticket) => `- #${ticket.shortId} ${ticket.status}: ${ticket.title}`),
    ]);
  } catch (error) {
    return mcpErrorResult(error, 'salve.customers.context');
  }
}

function markdownResult(lines: readonly string[]): CallToolResult {
  const text = lines.filter((line) => line !== '').join('\n');
  return { content: [{ type: 'text', text }], structuredContent: { text } };
}

function messageLines(messages: readonly MessageLike[], limit: number): string[] {
  return messages.slice(-limit).map((message) => {
    const author =
      message.authorType === 'agent' ? (message.authorUserId ?? 'agent') : message.authorType;
    const visibility = message.isInternal ? 'internal' : 'public';
    return `- ${message.createdAt} ${author} (${visibility}): ${message.bodyText}`;
  });
}

type MessageLike = {
  authorType: string;
  authorUserId: string | null;
  isInternal: boolean;
  bodyText: string;
  createdAt: string;
};
