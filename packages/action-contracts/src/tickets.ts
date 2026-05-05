import { z } from 'zod';
import { defineAction } from './types.js';

export const ticketStatusSchema = z.enum(['open', 'in_progress', 'snoozed', 'resolved', 'closed']);
export const ticketPrioritySchema = z.enum(['low', 'normal', 'high', 'urgent']);

const idSchema = z.string().min(1);
const uuidSchema = z.string().uuid();
const isoDateTimeSchema = z.string().datetime();
const nullableDateTimeSchema = isoDateTimeSchema.nullable();
const jsonValueSchema = z.unknown();

export const attachmentInputSchema = z.object({
  id: idSchema.optional(),
  s3Key: z.string().min(1),
  filename: z.string().min(1),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
});

export const attachmentSchema = z.object({
  id: idSchema,
  s3Key: z.string(),
  filename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  createdAt: isoDateTimeSchema,
});

export const ticketCustomerSchema = z.object({
  id: idSchema,
  email: z.string().email(),
  name: z.string().nullable(),
  displayName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
});

export const ticketTagSchema = z.object({
  id: idSchema,
  label: z.string(),
  color: z.string().nullable(),
  group: z
    .object({
      id: idSchema,
      label: z.string(),
      color: z.string(),
    })
    .nullable(),
  addedAt: isoDateTimeSchema,
  addedById: z.string().nullable(),
});

export const ticketCustomFieldValueSchema = z.object({
  id: idSchema,
  fieldId: idSchema,
  key: z.string(),
  displayName: z.string(),
  type: z.string(),
  value: jsonValueSchema.nullable(),
  updatedById: z.string().nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const ticketMessageSchema = z.object({
  id: idSchema,
  ticketId: idSchema,
  authorType: z.enum(['customer', 'agent', 'system']),
  authorUserId: z.string().nullable(),
  authorCustomerId: z.string().nullable(),
  bodyHtml: z.string(),
  bodyText: z.string(),
  isInternal: z.boolean(),
  editedAt: nullableDateTimeSchema,
  deletedAt: nullableDateTimeSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  attachments: z.array(attachmentSchema),
});

export const ticketBaseSchema = z.object({
  id: idSchema,
  shortId: z.number().int().nonnegative(),
  title: z.string(),
  description: z.string().nullable(),
  status: ticketStatusSchema,
  priority: ticketPrioritySchema,
  customerId: z.string().nullable(),
  assigneeId: z.string().nullable(),
  createdById: z.string().nullable(),
  resolvedById: z.string().nullable(),
  closedById: z.string().nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  firstResponseAt: nullableDateTimeSchema,
  resolvedAt: nullableDateTimeSchema,
  closedAt: nullableDateTimeSchema,
});

export const ticketSummarySchema = ticketBaseSchema.extend({
  customer: ticketCustomerSchema.nullable(),
});

export const ticketSchema = ticketSummarySchema.extend({
  tags: z.array(ticketTagSchema),
  customFields: z.array(ticketCustomFieldValueSchema),
});

export const ticketDetailSchema = ticketSchema.extend({
  messages: z.array(ticketMessageSchema),
});

export const ticketsListInputSchema = z.object({
  limit: z.number().int().min(1).max(200).optional(),
  cursor: z.string().min(1).optional(),
  status: ticketStatusSchema.optional(),
  assigneeId: uuidSchema.optional(),
  customerId: uuidSchema.optional(),
});

export const ticketsListOutputSchema = z.object({
  data: z.array(ticketSummarySchema),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});

export const ticketIdInputSchema = z.object({
  ticketId: uuidSchema,
});

export const ticketOutputSchema = z.object({
  ticket: ticketDetailSchema,
});

export const createTicketInputSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().optional(),
  customerEmail: z.string().email().optional(),
  customerName: z.string().optional(),
  priority: ticketPrioritySchema.optional(),
});

export const updateTicketInputSchema = ticketIdInputSchema.extend({
  title: z.string().min(1).max(500).optional(),
  description: z.string().optional(),
  priority: ticketPrioritySchema.optional(),
});

export const assignTicketInputSchema = ticketIdInputSchema.extend({
  assigneeId: uuidSchema.nullable(),
});

export const snoozeTicketInputSchema = ticketIdInputSchema.extend({
  until: z.string().datetime(),
});

export const messageCreateInputSchema = ticketIdInputSchema.extend({
  bodyHtml: z.string().min(1).max(200_000),
  bodyText: z.string().min(1).max(100_000),
  emailAddressId: uuidSchema.nullable().optional(),
  attachments: z.array(attachmentInputSchema).optional(),
});

export const messageUpdateInputSchema = ticketIdInputSchema.extend({
  messageId: uuidSchema,
  bodyHtml: z.string().min(1).max(200_000),
  bodyText: z.string().min(1).max(100_000),
});

export const messageIdInputSchema = ticketIdInputSchema.extend({
  messageId: uuidSchema,
});

export const messageOutputSchema = z.object({
  message: ticketMessageSchema,
});

export const ticketTagsInputSchema = ticketIdInputSchema.extend({
  tagIds: z.array(uuidSchema).min(1).max(100),
});

export const ticketTagRemoveInputSchema = ticketIdInputSchema.extend({
  tagId: uuidSchema,
});

export const ticketTagsOutputSchema = z.object({
  ticket: ticketDetailSchema,
});

export const ticketCustomFieldSetInputSchema = ticketIdInputSchema.extend({
  fieldKey: z.string().trim().min(1).max(80),
  value: jsonValueSchema,
});

export const ticketCustomFieldSetOutputSchema = z.object({
  ticket: ticketDetailSchema,
});

export const ticketActions = {
  list: defineAction({
    id: 'tickets.list',
    summary: 'List tickets in the authenticated workspace.',
    inputSchema: ticketsListInputSchema,
    outputSchema: ticketsListOutputSchema,
    scopes: ['tickets:read'],
    idempotency: 'none',
    rest: { method: 'GET', path: '/tickets' },
    cli: { command: ['tickets', 'list'] },
    mcp: { toolName: 'salve.tickets.list' },
  }),
  get: defineAction({
    id: 'tickets.get',
    summary: 'Fetch a ticket with customer, tags, custom fields, and messages.',
    inputSchema: ticketIdInputSchema,
    outputSchema: ticketOutputSchema,
    scopes: ['tickets:read'],
    idempotency: 'none',
    rest: { method: 'GET', path: '/tickets/:ticketId', pathParams: ['ticketId'] },
    cli: { command: ['tickets', 'show'], positionals: ['ticketId'] },
    mcp: { toolName: 'salve.tickets.get' },
  }),
  create: defineAction({
    id: 'tickets.create',
    summary: 'Create a ticket.',
    inputSchema: createTicketInputSchema,
    outputSchema: ticketOutputSchema,
    scopes: ['tickets:write'],
    idempotency: 'required',
    auditEventKind: 'ticket.created',
    rest: { method: 'POST', path: '/tickets', successStatus: 201 },
    cli: { command: ['tickets', 'create'] },
    mcp: { toolName: 'salve.tickets.create' },
  }),
  update: defineAction({
    id: 'tickets.update',
    summary: 'Update ticket title, description, or priority.',
    inputSchema: updateTicketInputSchema,
    outputSchema: ticketOutputSchema,
    scopes: ['tickets:write'],
    idempotency: 'optional',
    auditEventKind: 'ticket.updated',
    rest: { method: 'PATCH', path: '/tickets/:ticketId', pathParams: ['ticketId'] },
    cli: { command: ['tickets', 'update'], positionals: ['ticketId'] },
    mcp: { toolName: 'salve.tickets.update' },
  }),
  assign: defineAction({
    id: 'tickets.assign',
    summary: 'Assign or unassign a ticket.',
    inputSchema: assignTicketInputSchema,
    outputSchema: ticketOutputSchema,
    scopes: ['tickets:write'],
    idempotency: 'optional',
    auditEventKind: 'ticket.assigned',
    rest: { method: 'POST', path: '/tickets/:ticketId/assign', pathParams: ['ticketId'] },
    cli: { command: ['tickets', 'assign'], positionals: ['ticketId'] },
    mcp: { toolName: 'salve.tickets.assign' },
  }),
  snooze: defineAction({
    id: 'tickets.snooze',
    summary: 'Snooze a ticket until a future timestamp.',
    inputSchema: snoozeTicketInputSchema,
    outputSchema: ticketOutputSchema,
    scopes: ['tickets:write'],
    idempotency: 'optional',
    auditEventKind: 'ticket.snoozed',
    rest: { method: 'POST', path: '/tickets/:ticketId/snooze', pathParams: ['ticketId'] },
    cli: { command: ['tickets', 'snooze'], positionals: ['ticketId'] },
    mcp: { toolName: 'salve.tickets.snooze' },
  }),
  markInProgress: defineAction({
    id: 'tickets.markInProgress',
    summary: 'Move a ticket to in progress.',
    inputSchema: ticketIdInputSchema,
    outputSchema: ticketOutputSchema,
    scopes: ['tickets:write'],
    idempotency: 'optional',
    auditEventKind: 'ticket.status_changed',
    rest: { method: 'POST', path: '/tickets/:ticketId/in-progress', pathParams: ['ticketId'] },
    cli: { command: ['tickets', 'in-progress'], positionals: ['ticketId'] },
    mcp: { toolName: 'salve.tickets.mark_in_progress' },
  }),
  resolve: defineAction({
    id: 'tickets.resolve',
    summary: 'Resolve a ticket.',
    inputSchema: ticketIdInputSchema,
    outputSchema: ticketOutputSchema,
    scopes: ['tickets:write'],
    idempotency: 'optional',
    auditEventKind: 'ticket.status_changed',
    rest: { method: 'POST', path: '/tickets/:ticketId/resolve', pathParams: ['ticketId'] },
    cli: { command: ['tickets', 'resolve'], positionals: ['ticketId'] },
    mcp: { toolName: 'salve.tickets.resolve' },
  }),
  close: defineAction({
    id: 'tickets.close',
    summary: 'Close a ticket.',
    inputSchema: ticketIdInputSchema,
    outputSchema: ticketOutputSchema,
    scopes: ['tickets:write'],
    idempotency: 'optional',
    auditEventKind: 'ticket.status_changed',
    rest: { method: 'POST', path: '/tickets/:ticketId/close', pathParams: ['ticketId'] },
    cli: { command: ['tickets', 'close'], positionals: ['ticketId'] },
    mcp: { toolName: 'salve.tickets.close', destructive: true },
  }),
  reopen: defineAction({
    id: 'tickets.reopen',
    summary: 'Reopen a ticket.',
    inputSchema: ticketIdInputSchema,
    outputSchema: ticketOutputSchema,
    scopes: ['tickets:write'],
    idempotency: 'optional',
    auditEventKind: 'ticket.status_changed',
    rest: { method: 'POST', path: '/tickets/:ticketId/reopen', pathParams: ['ticketId'] },
    cli: { command: ['tickets', 'reopen'], positionals: ['ticketId'] },
    mcp: { toolName: 'salve.tickets.reopen' },
  }),
  reply: defineAction({
    id: 'tickets.reply',
    summary: 'Send a public reply on a ticket.',
    inputSchema: messageCreateInputSchema,
    outputSchema: messageOutputSchema,
    scopes: ['tickets:write'],
    idempotency: 'required',
    auditEventKind: 'message.sent',
    rest: {
      method: 'POST',
      path: '/tickets/:ticketId/replies',
      pathParams: ['ticketId'],
      successStatus: 201,
    },
    cli: { command: ['tickets', 'reply'], positionals: ['ticketId'] },
    mcp: { toolName: 'salve.tickets.reply' },
  }),
  note: defineAction({
    id: 'tickets.note',
    summary: 'Add an internal note on a ticket.',
    inputSchema: messageCreateInputSchema,
    outputSchema: messageOutputSchema,
    scopes: ['tickets:write'],
    idempotency: 'required',
    auditEventKind: 'message.note_added',
    rest: {
      method: 'POST',
      path: '/tickets/:ticketId/notes',
      pathParams: ['ticketId'],
      successStatus: 201,
    },
    cli: { command: ['tickets', 'note'], positionals: ['ticketId'] },
    mcp: { toolName: 'salve.tickets.add_note' },
  }),
  messageUpdate: defineAction({
    id: 'tickets.message.update',
    summary: 'Edit an internal note authored by the current principal.',
    inputSchema: messageUpdateInputSchema,
    outputSchema: messageOutputSchema,
    scopes: ['tickets:write'],
    idempotency: 'optional',
    auditEventKind: 'message.edited',
    rest: {
      method: 'PATCH',
      path: '/tickets/:ticketId/messages/:messageId',
      pathParams: ['ticketId', 'messageId'],
    },
    mcp: { toolName: 'salve.tickets.message_update' },
  }),
  messageDelete: defineAction({
    id: 'tickets.message.delete',
    summary: 'Delete an internal note authored by the current principal.',
    inputSchema: messageIdInputSchema,
    outputSchema: messageOutputSchema,
    scopes: ['tickets:write'],
    idempotency: 'optional',
    auditEventKind: 'message.deleted',
    rest: {
      method: 'DELETE',
      path: '/tickets/:ticketId/messages/:messageId',
      pathParams: ['ticketId', 'messageId'],
    },
    mcp: { toolName: 'salve.tickets.message_delete', destructive: true },
  }),
  tagsAdd: defineAction({
    id: 'tickets.tags.add',
    summary: 'Add tags to a ticket.',
    inputSchema: ticketTagsInputSchema,
    outputSchema: ticketTagsOutputSchema,
    scopes: ['tickets:write'],
    idempotency: 'optional',
    auditEventKind: 'ticket.tag_added',
    rest: { method: 'POST', path: '/tickets/:ticketId/tags', pathParams: ['ticketId'] },
    cli: { command: ['tickets', 'tags', 'add'], positionals: ['ticketId'] },
    mcp: { toolName: 'salve.tickets.tags_add' },
  }),
  tagsReplace: defineAction({
    id: 'tickets.tags.replace',
    summary: 'Replace all tags on a ticket.',
    inputSchema: ticketTagsInputSchema,
    outputSchema: ticketTagsOutputSchema,
    scopes: ['tickets:write'],
    idempotency: 'optional',
    auditEventKind: 'ticket.tag_added',
    rest: { method: 'PUT', path: '/tickets/:ticketId/tags', pathParams: ['ticketId'] },
    cli: { command: ['tickets', 'tags', 'replace'], positionals: ['ticketId'] },
    mcp: { toolName: 'salve.tickets.tags_replace' },
  }),
  tagsRemove: defineAction({
    id: 'tickets.tags.remove',
    summary: 'Remove a tag from a ticket.',
    inputSchema: ticketTagRemoveInputSchema,
    outputSchema: ticketTagsOutputSchema,
    scopes: ['tickets:write'],
    idempotency: 'optional',
    auditEventKind: 'ticket.tag_removed',
    rest: {
      method: 'DELETE',
      path: '/tickets/:ticketId/tags/:tagId',
      pathParams: ['ticketId', 'tagId'],
    },
    cli: { command: ['tickets', 'tags', 'remove'], positionals: ['ticketId', 'tagId'] },
    mcp: { toolName: 'salve.tickets.tags_remove', destructive: true },
  }),
  customFieldSet: defineAction({
    id: 'tickets.customField.set',
    summary: 'Set a ticket custom field value by field key.',
    inputSchema: ticketCustomFieldSetInputSchema,
    outputSchema: ticketCustomFieldSetOutputSchema,
    scopes: ['tickets:write'],
    idempotency: 'optional',
    auditEventKind: 'ticket.custom_field_changed',
    rest: {
      method: 'PUT',
      path: '/tickets/:ticketId/custom-fields/:fieldKey',
      pathParams: ['ticketId', 'fieldKey'],
    },
    cli: {
      command: ['tickets', 'custom-fields', 'set'],
      positionals: ['ticketId', 'fieldKey'],
    },
    mcp: { toolName: 'salve.tickets.custom_field_set' },
  }),
} as const;

export const TICKET_ACTIONS = Object.values(ticketActions);
export type TicketAction = (typeof TICKET_ACTIONS)[number];
export type TicketActionID = TicketAction['id'];
