import { z } from 'zod';
import { defineAction } from './types.js';

const idSchema = z.string().min(1);
const uuidSchema = z.string().uuid();
const isoDateTimeSchema = z.string().datetime();
const nullableDateTimeSchema = isoDateTimeSchema.nullable();
const jsonValueSchema = z.unknown();

export const customerTagSchema = z.object({
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

export const customerCustomFieldValueSchema = z.object({
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

export const customerNoteSchema = z.object({
  id: idSchema,
  objectType: z.enum(['customer', 'ticket']),
  objectId: idSchema,
  customerId: idSchema,
  bodyHtml: z.string(),
  bodyText: z.string(),
  pinned: z.boolean(),
  createdById: z.string(),
  editedAt: nullableDateTimeSchema,
  deletedAt: nullableDateTimeSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const customerEventSchema = z.object({
  id: idSchema,
  customerId: idSchema,
  eventName: z.string(),
  properties: jsonValueSchema,
  source: z.string(),
  occurredAt: isoDateTimeSchema,
  ingestedAt: isoDateTimeSchema,
  idempotencyKey: z.string().nullable(),
});

export const customerSchema = z.object({
  id: idSchema,
  email: z.string().email(),
  name: z.string().nullable(),
  displayName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  alternateEmails: z.array(z.string()),
  firstSeenAt: nullableDateTimeSchema,
  lastSeenAt: nullableDateTimeSchema,
  phone: z.string().nullable(),
  location: z.string().nullable(),
  metadata: jsonValueSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  tags: z.array(customerTagSchema),
  customFields: z.array(customerCustomFieldValueSchema),
});

export const customerDetailSchema = customerSchema.extend({
  notes: z.array(customerNoteSchema),
  events: z.array(customerEventSchema),
});

export const customersListInputSchema = z.object({
  limit: z.number().int().min(1).max(200).optional(),
  cursor: z.string().min(1).optional(),
  search: z.string().trim().max(500).optional(),
});

export const customersListOutputSchema = z.object({
  data: z.array(customerSchema),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});

export const customerIdInputSchema = z.object({ customerId: uuidSchema });
export const customerOutputSchema = z.object({ customer: customerDetailSchema });

export const updateCustomerInputSchema = customerIdInputSchema.extend({
  name: z.string().trim().min(1).max(120).nullable().optional(),
  displayName: z.string().trim().min(1).max(120).nullable().optional(),
  phone: z.string().trim().min(1).max(160).nullable().optional(),
  location: z.string().trim().min(1).max(160).nullable().optional(),
  metadata: jsonValueSchema.optional(),
});

export const createCustomerNoteInputSchema = customerIdInputSchema.extend({
  objectType: z.enum(['customer', 'ticket']).default('customer'),
  objectId: uuidSchema.optional(),
  bodyHtml: z.string().min(1).max(200_000),
  bodyText: z.string().min(1).max(100_000),
  pinned: z.boolean().optional(),
});
export const updateCustomerNoteInputSchema = z.object({
  noteId: uuidSchema,
  bodyHtml: z.string().min(1).max(200_000),
  bodyText: z.string().min(1).max(100_000),
});
export const customerNoteIdInputSchema = z.object({ noteId: uuidSchema });
export const customerNoteOutputSchema = z.object({ note: customerNoteSchema });

export const customerTagsInputSchema = customerIdInputSchema.extend({
  tagIds: z.array(uuidSchema).min(1).max(100),
});
export const customerTagRemoveInputSchema = customerIdInputSchema.extend({ tagId: uuidSchema });

export const customerCustomFieldSetInputSchema = customerIdInputSchema.extend({
  fieldKey: z.string().trim().min(1).max(80),
  value: jsonValueSchema,
});

export const customerCustomFieldSetOutputSchema = z.object({ customer: customerDetailSchema });

export const customerEventIngestInputSchema = customerIdInputSchema.extend({
  id: uuidSchema.optional(),
  eventName: z.string().trim().min(1).max(200),
  properties: jsonValueSchema.optional(),
  source: z.string().trim().min(1).max(80).optional(),
  occurredAt: z.union([z.string().datetime(), z.number().int().nonnegative()]).optional(),
  idempotencyKey: z.string().trim().min(1).max(500).optional(),
});
export const customerEventIngestOutputSchema = z.object({
  event: customerEventSchema,
  deduplicated: z.boolean(),
});

export const customerActions = {
  list: defineAction({
    id: 'customers.list',
    summary: 'List customers in the authenticated workspace.',
    inputSchema: customersListInputSchema,
    outputSchema: customersListOutputSchema,
    scopes: ['customers:read'],
    idempotency: 'none',
    rest: { method: 'GET', path: '/customers' },
    cli: { command: ['customers', 'list'] },
    mcp: { toolName: 'salve.customers.search' },
  }),
  get: defineAction({
    id: 'customers.get',
    summary: 'Fetch a customer with tags, custom fields, notes, and recent events.',
    inputSchema: customerIdInputSchema,
    outputSchema: customerOutputSchema,
    scopes: ['customers:read'],
    idempotency: 'none',
    rest: { method: 'GET', path: '/customers/:customerId', pathParams: ['customerId'] },
    cli: { command: ['customers', 'show'], positionals: ['customerId'] },
    mcp: { toolName: 'salve.customers.get' },
  }),
  update: defineAction({
    id: 'customers.update',
    summary: 'Update customer profile fields.',
    inputSchema: updateCustomerInputSchema,
    outputSchema: customerOutputSchema,
    scopes: ['customers:write'],
    idempotency: 'optional',
    auditEventKind: 'customer.updated',
    rest: { method: 'PATCH', path: '/customers/:customerId', pathParams: ['customerId'] },
    cli: { command: ['customers', 'update'], positionals: ['customerId'] },
    mcp: { toolName: 'salve.customers.update' },
  }),
  notesCreate: defineAction({
    id: 'customers.notes.create',
    summary: 'Create a customer note.',
    inputSchema: createCustomerNoteInputSchema,
    outputSchema: customerNoteOutputSchema,
    scopes: ['customers:write'],
    idempotency: 'required',
    auditEventKind: 'customer.note_created',
    rest: { method: 'POST', path: '/customers/:customerId/notes', pathParams: ['customerId'] },
  }),
  notesUpdate: defineAction({
    id: 'customers.notes.update',
    summary: 'Update a customer note authored by the caller.',
    inputSchema: updateCustomerNoteInputSchema,
    outputSchema: customerNoteOutputSchema,
    scopes: ['customers:write'],
    idempotency: 'optional',
    auditEventKind: 'customer.note_updated',
    rest: { method: 'PATCH', path: '/customer-notes/:noteId', pathParams: ['noteId'] },
  }),
  notesDelete: defineAction({
    id: 'customers.notes.delete',
    summary: 'Delete a customer note authored by the caller.',
    inputSchema: customerNoteIdInputSchema,
    outputSchema: customerNoteOutputSchema,
    scopes: ['customers:write'],
    idempotency: 'optional',
    auditEventKind: 'customer.note_deleted',
    rest: { method: 'DELETE', path: '/customer-notes/:noteId', pathParams: ['noteId'] },
    mcp: { toolName: 'salve.customers.notes.delete', destructive: true },
  }),
  tagsAdd: defineAction({
    id: 'customers.tags.add',
    summary: 'Add tags to a customer.',
    inputSchema: customerTagsInputSchema,
    outputSchema: customerOutputSchema,
    scopes: ['customers:write'],
    idempotency: 'optional',
    auditEventKind: 'customer.tag_added',
    rest: { method: 'POST', path: '/customers/:customerId/tags', pathParams: ['customerId'] },
  }),
  tagsRemove: defineAction({
    id: 'customers.tags.remove',
    summary: 'Remove a tag from a customer.',
    inputSchema: customerTagRemoveInputSchema,
    outputSchema: customerOutputSchema,
    scopes: ['customers:write'],
    idempotency: 'optional',
    auditEventKind: 'customer.tag_removed',
    rest: {
      method: 'DELETE',
      path: '/customers/:customerId/tags/:tagId',
      pathParams: ['customerId', 'tagId'],
    },
  }),
  eventsIngest: defineAction({
    id: 'customers.events.ingest',
    summary: 'Ingest a customer event with idempotency-key deduplication.',
    inputSchema: customerEventIngestInputSchema,
    outputSchema: customerEventIngestOutputSchema,
    scopes: ['customers:write'],
    idempotency: 'required',
    rest: { method: 'POST', path: '/customers/:customerId/events', pathParams: ['customerId'] },
  }),
  customFieldSet: defineAction({
    id: 'customers.customField.set',
    summary: 'Set a customer custom field value by field key.',
    inputSchema: customerCustomFieldSetInputSchema,
    outputSchema: customerCustomFieldSetOutputSchema,
    scopes: ['customers:write'],
    idempotency: 'optional',
    auditEventKind: 'customer.field_set',
    rest: {
      method: 'PUT',
      path: '/customers/:customerId/custom-fields/:fieldKey',
      pathParams: ['customerId', 'fieldKey'],
    },
    cli: {
      command: ['customers', 'custom-fields', 'set'],
      positionals: ['customerId', 'fieldKey'],
    },
    mcp: { toolName: 'salve.customers.custom_field_set' },
  }),
} as const;

export const CUSTOMER_ACTIONS = Object.values(customerActions);
export type CustomerAction = (typeof CUSTOMER_ACTIONS)[number];
export type CustomerActionID = CustomerAction['id'];
