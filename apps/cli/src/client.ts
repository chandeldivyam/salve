import { SalveClient, type SalveRequestOptions } from '@opendesk/api-client';
import { getFlag } from './args.js';
import { readAuthConfig, readWorkspaceConfig } from './auth/config.js';

export interface CliClientOptions {
  flags: Record<string, string | boolean>;
}

export async function getClient({ flags }: CliClientOptions): Promise<SalveClient> {
  const auth = await readAuthConfig();
  const workspace = await readWorkspaceConfig();
  const token = process.env.SALVE_TOKEN ?? auth?.token;
  if (!token) {
    throw new Error('No Salve token found. Run `salve login` or set SALVE_TOKEN.');
  }

  return new SalveClient({
    token,
    baseUrl: getFlag(flags, 'apiBaseUrl') ?? process.env.SALVE_API_URL ?? auth?.apiBaseUrl,
    workspaceId:
      getFlag(flags, 'workspace') ??
      process.env.SALVE_WORKSPACE_ID ??
      workspace?.workspaceId ??
      auth?.workspaceId ??
      undefined,
  });
}

export function requestOptions(flags: Record<string, string | boolean>): SalveRequestOptions {
  return {
    idempotencyKey: getFlag(flags, 'idempotencyKey'),
  };
}
