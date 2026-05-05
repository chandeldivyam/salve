import { randomUUID } from 'node:crypto';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type {
  ActionID,
  ActionInput,
  ActionOutput,
  AnyActionContract,
} from '@opendesk/action-contracts';
import { mcpErrorResult } from '../error.js';
import type { SalveMcpContext } from '../types.js';

export async function runActionTool<C extends AnyActionContract>(
  context: SalveMcpContext,
  action: C,
  input: ActionInput<C>,
): Promise<CallToolResult> {
  try {
    const output = await context.client.action(action.id as ActionID, input as never, {
      idempotencyKey: action.idempotency === 'required' ? randomUUID() : undefined,
    });
    return successResult(output as ActionOutput<C>);
  } catch (error) {
    return mcpErrorResult(error, action.id);
  }
}

export function successResult(value: unknown): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    structuredContent: toStructuredContent(value),
  };
}

function toStructuredContent(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return { value };
}
