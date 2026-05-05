import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  clearAuthConfig,
  readAuthConfig,
  readWorkspaceConfig,
  writeAuthConfig,
  writeWorkspaceConfig,
} from './auth/config.js';

test('auth and workspace config use SALVE_CONFIG_DIR with restrictive permissions', async () => {
  const previousConfigDir = process.env.SALVE_CONFIG_DIR;
  const configDir = await mkdtemp(join(tmpdir(), 'salve-cli-config-'));
  process.env.SALVE_CONFIG_DIR = configDir;

  try {
    await writeAuthConfig({
      token: 'slv_pat_test',
      workspaceId: 'workspace_1',
      apiBaseUrl: 'http://127.0.0.1:3001',
      principalKind: 'user',
      scopes: ['tickets:read'],
      savedAt: '2026-05-05T00:00:00.000Z',
      email: 'agent@example.com',
      role: 'admin',
    });
    await writeWorkspaceConfig({
      workspaceId: 'workspace_2',
      workspaceSlug: 'acme',
      savedAt: '2026-05-05T00:00:00.000Z',
    });

    assert.equal((await stat(configDir)).mode & 0o777, 0o700);
    assert.equal((await stat(join(configDir, 'auth.json'))).mode & 0o777, 0o600);
    assert.equal((await stat(join(configDir, 'config.json'))).mode & 0o777, 0o600);
    assert.equal((await readAuthConfig())?.token, 'slv_pat_test');
    assert.equal((await readWorkspaceConfig())?.workspaceSlug, 'acme');

    await clearAuthConfig();
    assert.equal(await readAuthConfig(), null);
  } finally {
    if (previousConfigDir === undefined) {
      delete process.env.SALVE_CONFIG_DIR;
    } else {
      process.env.SALVE_CONFIG_DIR = previousConfigDir;
    }
    await rm(configDir, { force: true, recursive: true });
  }
});
