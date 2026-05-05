import { z } from 'zod';
import { ticketSummarySchema } from './tickets.js';
import { defineAction } from './types.js';

const idSchema = z.string().min(1);
const uuidSchema = z.string().uuid();
const isoDateTimeSchema = z.string().datetime();
const nullableDateTimeSchema = isoDateTimeSchema.nullable();
const jsonValueSchema = z.unknown();

export const viewSchema = z.object({
  id: idSchema,
  kind: z.literal('inbox'),
  scope: z.enum(['workspace', 'personal']),
  ownerId: z.string().nullable(),
  label: z.string(),
  description: z.string().nullable(),
  icon: z.string().nullable(),
  color: z.string().nullable(),
  query: jsonValueSchema,
  sort: jsonValueSchema,
  groupBy: z.string().nullable(),
  displayProps: jsonValueSchema.nullable(),
  archivedAt: nullableDateTimeSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const viewsListInputSchema = z.object({
  includeArchived: z.boolean().optional(),
});
export const viewsListOutputSchema = z.object({ data: z.array(viewSchema) });

export const viewIdInputSchema = z.object({ viewId: uuidSchema });
export const viewOutputSchema = z.object({ view: viewSchema });

export const createViewInputSchema = z.object({
  scope: z.enum(['workspace', 'personal']),
  label: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
  icon: z.string().trim().max(80).optional(),
  color: z.string().trim().max(40).optional(),
  query: jsonValueSchema,
  sort: jsonValueSchema.optional(),
  groupBy: z.union([z.string(), z.null()]).optional(),
  displayProps: jsonValueSchema.optional(),
});

export const updateViewInputSchema = viewIdInputSchema.extend({
  label: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).optional(),
  icon: z.string().trim().max(80).optional(),
  color: z.string().trim().max(40).optional(),
  query: jsonValueSchema.optional(),
  sort: jsonValueSchema.optional(),
  groupBy: z.union([z.string(), z.null()]).optional(),
  displayProps: jsonValueSchema.optional(),
});

export const viewTicketsInputSchema = viewIdInputSchema.extend({
  limit: z.number().int().min(1).max(200).optional(),
  cursor: z.string().min(1).optional(),
});
export const viewTicketsOutputSchema = z.object({
  view: viewSchema,
  data: z.array(ticketSummarySchema),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});

export const viewActions = {
  list: defineAction({
    id: 'views.list',
    summary: 'List saved inbox views visible to the authenticated principal.',
    inputSchema: viewsListInputSchema,
    outputSchema: viewsListOutputSchema,
    scopes: ['views:read'],
    idempotency: 'none',
    rest: { method: 'GET', path: '/views' },
    cli: { command: ['views', 'list'] },
    mcp: { toolName: 'salve.views.list' },
  }),
  get: defineAction({
    id: 'views.get',
    summary: 'Fetch a saved inbox view.',
    inputSchema: viewIdInputSchema,
    outputSchema: viewOutputSchema,
    scopes: ['views:read'],
    idempotency: 'none',
    rest: { method: 'GET', path: '/views/:viewId', pathParams: ['viewId'] },
    cli: { command: ['views', 'show'], positionals: ['viewId'] },
  }),
  create: defineAction({
    id: 'views.create',
    summary: 'Create a saved inbox view.',
    inputSchema: createViewInputSchema,
    outputSchema: viewOutputSchema,
    scopes: ['views:write'],
    idempotency: 'required',
    rest: { method: 'POST', path: '/views' },
  }),
  update: defineAction({
    id: 'views.update',
    summary: 'Update a saved inbox view owned by the caller.',
    inputSchema: updateViewInputSchema,
    outputSchema: viewOutputSchema,
    scopes: ['views:write'],
    idempotency: 'optional',
    rest: { method: 'PATCH', path: '/views/:viewId', pathParams: ['viewId'] },
  }),
  delete: defineAction({
    id: 'views.delete',
    summary: 'Archive a saved inbox view owned by the caller.',
    inputSchema: viewIdInputSchema,
    outputSchema: viewOutputSchema,
    scopes: ['views:write'],
    idempotency: 'optional',
    rest: { method: 'DELETE', path: '/views/:viewId', pathParams: ['viewId'] },
    mcp: { toolName: 'salve.views.delete', destructive: true },
  }),
  tickets: defineAction({
    id: 'views.tickets',
    summary: 'List tickets matching a saved inbox view.',
    inputSchema: viewTicketsInputSchema,
    outputSchema: viewTicketsOutputSchema,
    scopes: ['views:read', 'tickets:read'],
    idempotency: 'none',
    rest: { method: 'GET', path: '/views/:viewId/tickets', pathParams: ['viewId'] },
    cli: { command: ['views', 'tickets'], positionals: ['viewId'] },
    mcp: { toolName: 'salve.views.tickets' },
  }),
} as const;

export const VIEW_ACTIONS = Object.values(viewActions);
export type ViewAction = (typeof VIEW_ACTIONS)[number];
export type ViewActionID = ViewAction['id'];
