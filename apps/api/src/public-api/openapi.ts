import { ALL_ACTIONS, buildOpenApiDocument } from '@salve/action-contracts';
import type { Context } from 'hono';

export function handleOpenApi(c: Context): Response {
  return c.json(
    buildOpenApiDocument(ALL_ACTIONS, {
      title: 'Salve Public API',
      version: 'v1',
      serverUrl: '/v1',
    }),
  );
}
