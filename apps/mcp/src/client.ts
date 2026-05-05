import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_BASE_URL, SalveClient } from '@salve/api-client';
import type { SalveMcpContext } from './types.js';

interface AuthConfig {
  token: string;
  workspaceId: string | null;
  apiBaseUrl: string;
}

interface WorkspaceConfig {
  workspaceId: string;
}

export async function createClientContext(): Promise<SalveMcpContext> {
  const configRoot = salveConfigRoot();
  const [authConfig, workspaceConfig] = await Promise.all([
    readAuthConfig(configRoot),
    readWorkspaceConfig(configRoot),
  ]);
  const token = process.env.SALVE_TOKEN ?? authConfig?.token;

  if (!token) {
    throw new Error(
      'No Salve token found. Set SALVE_TOKEN in your MCP host config or run `salve login`.',
    );
  }

  const client = new SalveClient({
    token,
    baseUrl: process.env.SALVE_API_URL ?? authConfig?.apiBaseUrl ?? DEFAULT_BASE_URL,
    workspaceId:
      process.env.SALVE_WORKSPACE_ID ??
      workspaceConfig?.workspaceId ??
      authConfig?.workspaceId ??
      undefined,
  });

  const auth = await client.whoami();
  return { client, auth };
}

function salveConfigRoot(): string {
  return process.env.SALVE_CONFIG_DIR ?? join(homedir(), '.config', 'salve');
}

async function readAuthConfig(configRoot: string): Promise<AuthConfig | null> {
  return readJson<AuthConfig>(join(configRoot, 'auth.json'));
}

async function readWorkspaceConfig(configRoot: string): Promise<WorkspaceConfig | null> {
  return readJson<WorkspaceConfig>(join(configRoot, 'config.json'));
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}
