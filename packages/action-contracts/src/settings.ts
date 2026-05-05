import { z } from 'zod';
import { SCOPES } from './scopes.js';
import { defineAction } from './types.js';

const idSchema = z.string().min(1);
const uuidSchema = z.string().uuid();
const isoDateTimeSchema = z.string().datetime();
const nullableDateTimeSchema = isoDateTimeSchema.nullable();
const jsonValueSchema = z.unknown();
const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const apiScopeSchema = z.enum(SCOPES as unknown as [string, ...string[]]);

export const tagGroupSchema = z.object({
  id: idSchema,
  label: z.string(),
  color: z.string(),
  sortOrder: z.number().int(),
  archivedAt: nullableDateTimeSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const tagSchema = z.object({
  id: idSchema,
  groupId: z.string().nullable(),
  label: z.string(),
  color: z.string().nullable(),
  sortOrder: z.number().int(),
  archivedAt: nullableDateTimeSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  group: tagGroupSchema.nullable(),
});

export const customFieldSchema = z.object({
  id: idSchema,
  key: z.string(),
  displayName: z.string(),
  description: z.string().nullable(),
  category: z.enum(['ticket', 'customer']),
  type: z.string(),
  required: z.boolean(),
  active: z.boolean(),
  options: z.array(z.string()),
  dynamicConfig: jsonValueSchema.nullable(),
  defaultValue: jsonValueSchema.nullable(),
  rules: jsonValueSchema.nullable(),
  dependsOn: z.array(z.string()),
  editableBy: z.array(z.string()),
  sortOrder: z.number().int(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const emailDomainSchema = z.object({
  id: idSchema,
  channelId: idSchema,
  domain: z.string(),
  dkimTokens: z.array(z.object({ name: z.string(), value: z.string() })),
  mailFromDomain: z.string(),
  status: z.string(),
  provisionStatus: z.enum(['pending', 'provisioning', 'provisioned', 'failed']),
});

export const emailAddressSchema = z.object({
  id: idSchema,
  channelId: idSchema,
  sendingDomainId: idSchema,
  fullAddress: z.string().email(),
});

export const emailRoutingRuleSchema = z.object({
  id: idSchema,
  emailAddressId: idSchema,
  channelId: idSchema,
  setPriority: z.enum(['low', 'normal', 'high', 'urgent']),
  assignTeamId: z.string().nullable(),
  assignAgentId: z.string().nullable(),
  enabled: z.boolean(),
});

export const apiTokenSchema = z.object({
  id: idSchema,
  name: z.string().nullable(),
  prefix: z.string().nullable(),
  start: z.string().nullable(),
  principalKind: z.enum(['user', 'service_account']).nullable(),
  principalId: z.string().nullable(),
  enabled: z.boolean(),
  expiresAt: nullableDateTimeSchema,
  lastRequest: nullableDateTimeSchema,
  createdAt: isoDateTimeSchema,
});

export const apiTokenCreateOutputSchema = z.object({
  id: idSchema,
  token: z.string(),
  name: z.string(),
  prefix: z.string(),
  principalKind: z.enum(['user', 'service_account']),
  scopes: z.array(z.string()),
  expiresAt: nullableDateTimeSchema,
  createdAt: isoDateTimeSchema,
});

export const settingsTagsListInputSchema = z.object({
  includeArchived: z.boolean().optional(),
});
export const settingsTagsListOutputSchema = z.object({
  tags: z.array(tagSchema),
  groups: z.array(tagGroupSchema),
});
export const tagOutputSchema = z.object({ tag: tagSchema });
export const tagGroupOutputSchema = z.object({ group: tagGroupSchema });

export const createTagInputSchema = z.object({
  label: z.string().trim().min(1).max(80),
  groupId: uuidSchema.nullable().optional(),
  color: hexColorSchema.nullable().optional(),
  sortOrder: z.number().int().optional(),
});
export const updateTagInputSchema = createTagInputSchema.partial().extend({ tagId: uuidSchema });
export const tagIdInputSchema = z.object({ tagId: uuidSchema });

export const createTagGroupInputSchema = z.object({
  label: z.string().trim().min(1).max(80),
  color: hexColorSchema,
  sortOrder: z.number().int().optional(),
});
export const updateTagGroupInputSchema = createTagGroupInputSchema
  .partial()
  .extend({ groupId: uuidSchema });
export const tagGroupIdInputSchema = z.object({ groupId: uuidSchema });

export const customFieldsListInputSchema = z.object({
  category: z.enum(['ticket', 'customer']).optional(),
  includeInactive: z.boolean().optional(),
});
export const customFieldsListOutputSchema = z.object({ data: z.array(customFieldSchema) });
export const customFieldOutputSchema = z.object({ customField: customFieldSchema });

export const customFieldTypeSchema = z.enum([
  'text',
  'number',
  'decimal',
  'boolean',
  'date',
  'list',
  'multi_select',
  'agent',
  'customer',
  'ticket',
  'url',
  'address',
  'dynamic_list',
  'dynamic_multi_select',
]);
export const createCustomFieldInputSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[a-z][a-z0-9_]*$/),
  displayName: z.string().trim().min(1).max(120),
  description: z.string().max(1000).optional(),
  category: z.enum(['ticket', 'customer']),
  type: customFieldTypeSchema,
  required: z.boolean().optional(),
  active: z.boolean().optional(),
  options: z.array(z.string().min(1)).optional(),
  dynamicConfig: jsonValueSchema.optional(),
  defaultValue: jsonValueSchema.optional(),
  rules: jsonValueSchema.optional(),
  dependsOn: z.array(z.string()).optional(),
  editableBy: z.array(z.enum(['api', 'admin', 'agent', 'sdk'])).optional(),
  sortOrder: z.number().int().optional(),
});
export const updateCustomFieldInputSchema = createCustomFieldInputSchema
  .omit({ key: true, category: true, type: true })
  .partial()
  .extend({ customFieldId: uuidSchema });
export const customFieldIdInputSchema = z.object({ customFieldId: uuidSchema });

export const createEmailDomainInputSchema = z.object({
  domain: z
    .string()
    .trim()
    .min(3)
    .max(253)
    .regex(/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/, 'invalid domain'),
  fromName: z.string().trim().min(1).max(120).optional(),
  signature: z.string().max(4000).optional(),
});
export const createEmailAddressInputSchema = z.object({
  sendingDomainId: uuidSchema,
  channelId: uuidSchema.optional(),
  localPart: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z0-9._%+-]+$/),
  label: z.string().trim().min(1).max(120).optional(),
  canSend: z.boolean().optional(),
  canReceive: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  signature: z.string().max(4000).optional(),
});
export const upsertEmailRoutingRuleInputSchema = z.object({
  channelId: uuidSchema,
  emailAddressId: uuidSchema,
  destinationAddress: z.string().email().optional(),
  senderPattern: z.string().trim().max(500).optional(),
  subjectPattern: z.string().trim().max(500).optional(),
  assignTeamId: z.string().trim().min(1).max(120).optional(),
  assignAgentId: z.string().min(1).optional(),
  setPriority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  priority: z.number().int().min(0).max(10_000).optional(),
  enabled: z.boolean().optional(),
});

export const apiTokensListOutputSchema = z.object({ data: z.array(apiTokenSchema) });
export const createApiTokenInputSchema = z.object({
  name: z.string().min(1).max(80),
  scopes: z.array(apiScopeSchema).min(1).max(SCOPES.length),
  expiresInDays: z.number().int().min(1).max(365).optional(),
});
export const apiTokenIdInputSchema = z.object({ tokenId: idSchema });
export const emptyOutputSchema = z.object({});

export const settingsActions = {
  tagsList: defineAction({
    id: 'settings.tags.list',
    summary: 'List tag groups and tags.',
    inputSchema: settingsTagsListInputSchema,
    outputSchema: settingsTagsListOutputSchema,
    scopes: ['settings:read'],
    idempotency: 'none',
    rest: { method: 'GET', path: '/settings/tags' },
    mcp: { toolName: 'salve.settings.tags.list' },
  }),
  tagsCreate: defineAction({
    id: 'settings.tags.create',
    summary: 'Create a tag.',
    inputSchema: createTagInputSchema,
    outputSchema: tagOutputSchema,
    scopes: ['settings:write'],
    idempotency: 'required',
    rest: { method: 'POST', path: '/settings/tags' },
  }),
  tagsUpdate: defineAction({
    id: 'settings.tags.update',
    summary: 'Update a tag.',
    inputSchema: updateTagInputSchema,
    outputSchema: tagOutputSchema,
    scopes: ['settings:write'],
    idempotency: 'optional',
    rest: { method: 'PATCH', path: '/settings/tags/:tagId', pathParams: ['tagId'] },
  }),
  tagsArchive: defineAction({
    id: 'settings.tags.archive',
    summary: 'Archive a tag.',
    inputSchema: tagIdInputSchema,
    outputSchema: tagOutputSchema,
    scopes: ['settings:write'],
    idempotency: 'optional',
    rest: { method: 'DELETE', path: '/settings/tags/:tagId', pathParams: ['tagId'] },
  }),
  tagGroupsCreate: defineAction({
    id: 'settings.tagGroups.create',
    summary: 'Create a tag group.',
    inputSchema: createTagGroupInputSchema,
    outputSchema: tagGroupOutputSchema,
    scopes: ['settings:write'],
    idempotency: 'required',
    rest: { method: 'POST', path: '/settings/tag-groups' },
  }),
  tagGroupsUpdate: defineAction({
    id: 'settings.tagGroups.update',
    summary: 'Update a tag group.',
    inputSchema: updateTagGroupInputSchema,
    outputSchema: tagGroupOutputSchema,
    scopes: ['settings:write'],
    idempotency: 'optional',
    rest: { method: 'PATCH', path: '/settings/tag-groups/:groupId', pathParams: ['groupId'] },
  }),
  tagGroupsArchive: defineAction({
    id: 'settings.tagGroups.archive',
    summary: 'Archive a tag group.',
    inputSchema: tagGroupIdInputSchema,
    outputSchema: tagGroupOutputSchema,
    scopes: ['settings:write'],
    idempotency: 'optional',
    rest: { method: 'DELETE', path: '/settings/tag-groups/:groupId', pathParams: ['groupId'] },
  }),
  tagGroupsRestore: defineAction({
    id: 'settings.tagGroups.restore',
    summary: 'Restore an archived tag group.',
    inputSchema: tagGroupIdInputSchema,
    outputSchema: tagGroupOutputSchema,
    scopes: ['settings:write'],
    idempotency: 'optional',
    rest: {
      method: 'POST',
      path: '/settings/tag-groups/:groupId/restore',
      pathParams: ['groupId'],
    },
  }),
  customFieldsList: defineAction({
    id: 'settings.customFields.list',
    summary: 'List custom field definitions.',
    inputSchema: customFieldsListInputSchema,
    outputSchema: customFieldsListOutputSchema,
    scopes: ['settings:read'],
    idempotency: 'none',
    rest: { method: 'GET', path: '/settings/custom-fields' },
    mcp: { toolName: 'salve.settings.custom_fields.list' },
  }),
  customFieldsCreate: defineAction({
    id: 'settings.customFields.create',
    summary: 'Create a custom field definition.',
    inputSchema: createCustomFieldInputSchema,
    outputSchema: customFieldOutputSchema,
    scopes: ['settings:write'],
    idempotency: 'required',
    rest: { method: 'POST', path: '/settings/custom-fields' },
  }),
  customFieldsUpdate: defineAction({
    id: 'settings.customFields.update',
    summary: 'Update a custom field definition.',
    inputSchema: updateCustomFieldInputSchema,
    outputSchema: customFieldOutputSchema,
    scopes: ['settings:write'],
    idempotency: 'optional',
    rest: {
      method: 'PATCH',
      path: '/settings/custom-fields/:customFieldId',
      pathParams: ['customFieldId'],
    },
  }),
  customFieldsArchive: defineAction({
    id: 'settings.customFields.archive',
    summary: 'Archive a custom field definition.',
    inputSchema: customFieldIdInputSchema,
    outputSchema: customFieldOutputSchema,
    scopes: ['settings:write'],
    idempotency: 'optional',
    rest: {
      method: 'DELETE',
      path: '/settings/custom-fields/:customFieldId',
      pathParams: ['customFieldId'],
    },
  }),
  emailDomainsCreate: defineAction({
    id: 'settings.email.domains.create',
    summary: 'Create a sending domain and start asynchronous provisioning.',
    inputSchema: createEmailDomainInputSchema,
    outputSchema: emailDomainSchema,
    scopes: ['settings:email:write'],
    idempotency: 'required',
    rest: { method: 'POST', path: '/settings/email/domains' },
    mcp: { toolName: 'salve.settings.email_domain.create' },
  }),
  emailAddressesCreate: defineAction({
    id: 'settings.email.addresses.create',
    summary: 'Create a sending or receiving email address for a domain.',
    inputSchema: createEmailAddressInputSchema,
    outputSchema: emailAddressSchema,
    scopes: ['settings:email:write'],
    idempotency: 'required',
    rest: {
      method: 'POST',
      path: '/settings/email/domains/:sendingDomainId/addresses',
      pathParams: ['sendingDomainId'],
    },
  }),
  emailRoutingRulesUpsert: defineAction({
    id: 'settings.email.routingRules.upsert',
    summary: 'Create or update an inbound email routing rule.',
    inputSchema: upsertEmailRoutingRuleInputSchema,
    outputSchema: emailRoutingRuleSchema,
    scopes: ['settings:email:write'],
    idempotency: 'required',
    rest: {
      method: 'POST',
      path: '/settings/email/channels/:channelId/routing-rules',
      pathParams: ['channelId'],
    },
  }),
  apiTokensList: defineAction({
    id: 'settings.apiTokens.list',
    summary: 'List API tokens in this workspace.',
    inputSchema: z.object({}),
    outputSchema: apiTokensListOutputSchema,
    scopes: ['settings:read'],
    idempotency: 'none',
    rest: { method: 'GET', path: '/settings/api-tokens' },
  }),
  apiTokensCreate: defineAction({
    id: 'settings.apiTokens.create',
    summary: 'Create a personal API token for the caller.',
    inputSchema: createApiTokenInputSchema,
    outputSchema: apiTokenCreateOutputSchema,
    scopes: ['settings:write'],
    idempotency: 'required',
    rest: { method: 'POST', path: '/settings/api-tokens' },
  }),
  apiTokensRevoke: defineAction({
    id: 'settings.apiTokens.revoke',
    summary: 'Revoke a personal API token for the caller.',
    inputSchema: apiTokenIdInputSchema,
    outputSchema: emptyOutputSchema,
    scopes: ['settings:write'],
    idempotency: 'optional',
    rest: { method: 'DELETE', path: '/settings/api-tokens/:tokenId', pathParams: ['tokenId'] },
  }),
} as const;

export const SETTINGS_ACTIONS = Object.values(settingsActions);
export type SettingsAction = (typeof SETTINGS_ACTIONS)[number];
export type SettingsActionID = SettingsAction['id'];
