import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface AuthConfig {
  token: string;
  workspaceId: string | null;
  apiBaseUrl: string;
  principalKind: 'user' | 'service_account';
  scopes: string[];
  savedAt: string;
  email?: string;
  role?: string;
}

export interface WorkspaceConfig {
  workspaceId: string;
  workspaceSlug: string;
  savedAt: string;
}

export async function readAuthConfig(): Promise<AuthConfig | null> {
  return readJson<AuthConfig>(authPath());
}

export async function writeAuthConfig(config: AuthConfig): Promise<void> {
  await writeJson(authPath(), config, 0o600);
}

export async function clearAuthConfig(): Promise<void> {
  await rm(authPath(), { force: true });
}

export async function readWorkspaceConfig(): Promise<WorkspaceConfig | null> {
  return readJson<WorkspaceConfig>(workspacePath());
}

export async function writeWorkspaceConfig(config: WorkspaceConfig): Promise<void> {
  await writeJson(workspacePath(), config, 0o600);
}

function configRoot(): string {
  return process.env.SALVE_CONFIG_DIR ?? join(homedir(), '.config', 'salve');
}

function authPath(): string {
  return join(configRoot(), 'auth.json');
}

function workspacePath(): string {
  return join(configRoot(), 'config.json');
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function writeJson(path: string, value: unknown, mode: number): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode });
}
