import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createClientContext } from './client.js';
import { registerPrompts } from './prompts/registry.js';
import { registerResources } from './resources/registry.js';
import { registerCompositeTools } from './tools/composite.js';
import { registerActionTools } from './tools/registry.js';
import type { SalveMcpContext } from './types.js';

export const VERSION = '0.0.0';

export interface BuildServerOptions {
  context?: SalveMcpContext;
}

export async function buildServer(options: BuildServerOptions = {}): Promise<McpServer> {
  const context = options.context ?? (await createClientContext());
  const server = new McpServer(
    { name: 'salve-mcp', version: VERSION },
    {
      instructions:
        'Use Salve tools for help-desk work. Read context with resources and read-only composite tools first. Only call write or destructive tools after the user asks for that specific change.',
    },
  );

  registerActionTools(server, context);
  registerCompositeTools(server, context);
  registerResources(server, context);
  registerPrompts(server);

  return server;
}
