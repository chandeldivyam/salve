import { z } from 'zod';
import { defineAction } from './types.js';

const idSchema = z.string().min(1);
const isoDateTimeSchema = z.string().datetime();

export const whoamiOutputSchema = z.object({
  userId: idSchema,
  email: z.string().email(),
  workspaceId: idSchema.nullable(),
  role: z.string(),
  principalKind: z.enum(['user', 'service_account']),
  memberId: idSchema.nullable(),
  apiKeyId: idSchema.nullable(),
  scopes: z.array(z.string()),
  requestId: idSchema,
});

export const workspaceSchema = z.object({
  id: idSchema,
  name: z.string(),
  slug: z.string(),
  role: z.string(),
  kind: z.enum(['user', 'service_account']),
  active: z.boolean(),
  createdAt: isoDateTimeSchema.nullable(),
});

export const workspaceListOutputSchema = z.object({
  data: z.array(workspaceSchema),
});

export const metaActions = {
  whoami: defineAction({
    id: 'whoami',
    summary: 'Return the authenticated bearer-token context.',
    inputSchema: z.object({}),
    outputSchema: whoamiOutputSchema,
    scopes: [],
    idempotency: 'none',
    rest: { method: 'GET', path: '/_meta/whoami' },
    mcp: { toolName: 'salve.whoami' },
  }),
  workspacesList: defineAction({
    id: 'workspace.list',
    summary: 'List workspaces visible to the authenticated bearer token.',
    inputSchema: z.object({}),
    outputSchema: workspaceListOutputSchema,
    scopes: [],
    idempotency: 'none',
    rest: { method: 'GET', path: '/_meta/workspaces' },
    mcp: { toolName: 'salve.workspace.list' },
  }),
} as const;

export const META_ACTIONS = Object.values(metaActions);
export type MetaAction = (typeof META_ACTIONS)[number];
export type MetaActionID = MetaAction['id'];
