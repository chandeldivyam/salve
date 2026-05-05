import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { type ActionID, ALL_ACTIONS, type AnyActionContract } from '@opendesk/action-contracts';
import type { SalveMcpContext } from '../types.js';
import { descriptionForAction } from './describe.js';
import { runActionTool } from './execute.js';
import { compactInputSchema } from './schema.js';

export const MCP_ACTIONS = ALL_ACTIONS.filter((action) => Boolean(action.mcp));

export function registerActionTools(server: McpServer, context: SalveMcpContext): void {
  for (const action of MCP_ACTIONS) {
    registerActionTool(server, context, action);
  }
}

function registerActionTool(
  server: McpServer,
  context: SalveMcpContext,
  action: AnyActionContract,
): void {
  server.registerTool(
    action.mcp?.toolName ?? action.id,
    {
      description: descriptionForAction(action.id as ActionID, action.summary),
      inputSchema: compactInputSchema(action.inputSchema),
      annotations: toolAnnotations(action),
    },
    async (input) => runActionTool(context, action, input),
  );
}

function toolAnnotations(action: AnyActionContract) {
  return {
    ...(action.scopes.some((scope) => scope.endsWith(':read')) ? { readOnlyHint: true } : {}),
    ...(action.mcp?.destructive ? { destructiveHint: true } : {}),
    ...(action.idempotency !== 'none' ? { idempotentHint: true } : {}),
  };
}
