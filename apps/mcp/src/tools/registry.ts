import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { type ActionID, ALL_ACTIONS, type AnyActionContract } from '@salve/action-contracts';
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
  // readOnlyHint must be true only when EVERY scope is :read. A mixed
  // scope set (e.g. tickets:read + tickets:write) means the action can
  // mutate; the host's permission UI shouldn't claim read-only.
  // idempotentHint only when the api-client / host actually mints a key —
  // the CLI/MCP both auto-mint for `'required'` only, so `'optional'` is
  // not a contract guarantee.
  const allReads =
    action.scopes.length > 0 && action.scopes.every((scope) => scope.endsWith(':read'));
  return {
    ...(allReads ? { readOnlyHint: true } : {}),
    ...(action.mcp?.destructive ? { destructiveHint: true } : {}),
    ...(action.idempotency === 'required' ? { idempotentHint: true } : {}),
  };
}
