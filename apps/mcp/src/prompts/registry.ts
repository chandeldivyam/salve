import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { GetPromptResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    'salve.triage-inbox',
    {
      title: 'Triage Inbox',
      description: 'Walk an inbox view and suggest support dispositions.',
      argsSchema: {
        viewId: z.string().min(1).optional(),
      },
    },
    ({ viewId }) =>
      prompt(
        'Triage inbox',
        [
          viewId
            ? `Use salve.views.tickets with viewId ${viewId}.`
            : 'Use salve.tickets.list with status open.',
          'For each ticket, read salve://ticket/{id} or call salve.tickets.triage.',
          'Suggest priority, assignee, one to three tags, and a one-line reply draft.',
          'Do not call write tools until I explicitly confirm the changes.',
        ].join(' '),
      ),
  );

  server.registerPrompt(
    'salve.summarize-thread',
    {
      title: 'Summarize Thread',
      description: 'Compact a ticket conversation for handoff.',
      argsSchema: {
        ticketId: z.string().min(1),
      },
    },
    ({ ticketId }) =>
      prompt(
        'Summarize thread',
        [
          `Use salve.tickets.summarize_thread with ticketId ${ticketId}.`,
          'Produce five bullets covering customer ask, attempts so far, current blocker, next step, and sentiment.',
        ].join(' '),
      ),
  );

  server.registerPrompt(
    'salve.draft-reply',
    {
      title: 'Draft Reply',
      description: 'Draft a customer reply for one ticket.',
      argsSchema: {
        ticketId: z.string().min(1),
        tone: z.enum(['formal', 'friendly', 'apologetic']).optional(),
      },
    },
    ({ ticketId, tone }) =>
      prompt(
        'Draft reply',
        [
          `Read salve://ticket/${ticketId}.`,
          `Draft a ${tone ?? 'friendly'} reply that answers the latest customer-visible issue.`,
          'Output only the reply body. I will decide whether to send it with salve.tickets.reply.',
        ].join(' '),
      ),
  );
}

function prompt(description: string, text: string): GetPromptResult {
  return {
    description,
    messages: [
      {
        role: 'user',
        content: { type: 'text', text },
      },
    ],
  };
}
