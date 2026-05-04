import { builder, type CustomField, type CustomFieldType } from '@opendesk/zero-schema';
import { defineMutator, type ReadonlyJSONValue, type Transaction } from '@rocicorp/zero';
import { z } from 'zod';
import {
  assertCanModifyCustomer,
  assertCanModifyTicket,
  assertHasWorkspace,
  auditActorKind,
  type WorkspaceAuthData,
} from './auth.js';
import { MutationError, MutationErrorCode } from './error.js';

const idArg = z.string().min(1);
const keyArg = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z][a-z0-9_]*$/);
const displayNameArg = z.string().trim().min(1).max(120);
const customFieldCategoryArg = z.enum(['ticket', 'customer']);
const customFieldTypeArg = z.enum([
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
const editableByArg = z.enum(['api', 'admin', 'agent', 'sdk']);
const jsonValueArg = z.custom<ReadonlyJSONValue>();

type CustomFieldValueDefinition = {
  id: string;
  type: CustomFieldType;
  required: boolean;
  options: readonly string[];
  dynamicConfig?: ReadonlyJSONValue;
};

export const createCustomFieldArgsSchema = z.object({
  id: idArg,
  key: keyArg,
  displayName: displayNameArg,
  description: z.string().max(1000).optional(),
  category: customFieldCategoryArg,
  type: customFieldTypeArg,
  required: z.boolean().optional(),
  active: z.boolean().optional(),
  options: z.array(z.string().min(1)).optional(),
  dynamicConfig: jsonValueArg.optional(),
  defaultValue: jsonValueArg.optional(),
  rules: jsonValueArg.optional(),
  dependsOn: z.array(keyArg).optional(),
  editableBy: z.array(editableByArg).optional(),
  sortOrder: z.number().int().optional(),
});
export type CreateCustomFieldArgs = z.infer<typeof createCustomFieldArgsSchema>;

export const updateCustomFieldArgsSchema = z.object({
  id: idArg,
  displayName: displayNameArg.optional(),
  description: z.string().max(1000).nullable().optional(),
  required: z.boolean().optional(),
  active: z.boolean().optional(),
  options: z.array(z.string().min(1)).optional(),
  dynamicConfig: jsonValueArg.nullable().optional(),
  defaultValue: jsonValueArg.nullable().optional(),
  rules: jsonValueArg.nullable().optional(),
  dependsOn: z.array(keyArg).optional(),
  editableBy: z.array(editableByArg).optional(),
  sortOrder: z.number().int().optional(),
});
export type UpdateCustomFieldArgs = z.infer<typeof updateCustomFieldArgsSchema>;

export const customFieldIDOnlyArgsSchema = z.object({ id: idArg });

export const setCustomFieldValueOnTicketArgsSchema = z.object({
  id: idArg,
  fieldID: idArg,
  ticketID: idArg,
  value: jsonValueArg,
});
export type SetCustomFieldValueOnTicketArgs = z.infer<typeof setCustomFieldValueOnTicketArgsSchema>;

export const setCustomFieldValueOnCustomerArgsSchema = z.object({
  id: idArg,
  fieldID: idArg,
  customerID: idArg,
  value: jsonValueArg,
});
export type SetCustomFieldValueOnCustomerArgs = z.infer<
  typeof setCustomFieldValueOnCustomerArgsSchema
>;

export const clearCustomFieldValueOnTicketArgsSchema = z.object({
  fieldID: idArg,
  ticketID: idArg,
});
export type ClearCustomFieldValueOnTicketArgs = z.infer<
  typeof clearCustomFieldValueOnTicketArgsSchema
>;

export const clearCustomFieldValueOnCustomerArgsSchema = z.object({
  fieldID: idArg,
  customerID: idArg,
});
export type ClearCustomFieldValueOnCustomerArgs = z.infer<
  typeof clearCustomFieldValueOnCustomerArgsSchema
>;

function now(): number {
  return Date.now();
}

function newID(): string {
  return crypto.randomUUID();
}

function invalid(message: string, id?: string): never {
  throw new MutationError(message, MutationErrorCode.INVALID_INPUT, id);
}

function assertJSONValue(value: unknown, id?: string): asserts value is ReadonlyJSONValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) assertJSONValue(item, id);
    return;
  }
  if (
    typeof value === 'object' &&
    value !== null &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    for (const item of Object.values(value)) assertJSONValue(item, id);
    return;
  }
  invalid('custom field value must be JSON-serializable', id);
}

function asJSONValue(value: unknown, id?: string): ReadonlyJSONValue {
  assertJSONValue(value, id);
  return value;
}

function asOptionalJSONValue(value: unknown, id?: string): ReadonlyJSONValue | undefined {
  if (value === undefined) return undefined;
  return asJSONValue(value, id);
}

function validateOptions(type: CustomFieldType, options: readonly string[], id?: string) {
  if ((type === 'list' || type === 'multi_select') && options.length === 0) {
    invalid('list custom fields require at least one option', id);
  }
  if (new Set(options).size !== options.length) {
    invalid('custom field options must be unique', id);
  }
}

function getNumberBound(config: unknown, key: 'min' | 'max'): number | undefined {
  if (typeof config !== 'object' || config === null) return undefined;
  const value = (config as Record<string, unknown>)[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function validateRequired(
  field: Pick<CustomField, 'required' | 'type'>,
  value: unknown,
  id?: string,
) {
  if (!field.required) return;
  if (value === null || value === undefined || value === '') {
    invalid('required custom field value cannot be empty', id);
  }
  if (Array.isArray(value) && value.length === 0) {
    invalid('required custom field value cannot be empty', id);
  }
}

export function validateCustomFieldValue(
  field: CustomFieldValueDefinition,
  rawValue: unknown,
): ReadonlyJSONValue {
  validateRequired(field, rawValue, field.id);
  assertJSONValue(rawValue, field.id);

  if (rawValue === null) {
    return rawValue;
  }

  switch (field.type) {
    case 'text':
      if (typeof rawValue !== 'string' || rawValue.length > 4096) {
        invalid('text custom field value must be a string up to 4096 characters', field.id);
      }
      break;
    case 'number': {
      if (typeof rawValue !== 'number' || !Number.isInteger(rawValue)) {
        invalid('number custom field value must be an integer', field.id);
      }
      const min = getNumberBound(field.dynamicConfig, 'min');
      const max = getNumberBound(field.dynamicConfig, 'max');
      if (min !== undefined && rawValue < min)
        invalid('number custom field value is below min', field.id);
      if (max !== undefined && rawValue > max)
        invalid('number custom field value is above max', field.id);
      break;
    }
    case 'decimal':
      if (typeof rawValue !== 'number' || !Number.isFinite(rawValue)) {
        invalid('decimal custom field value must be a finite number', field.id);
      }
      break;
    case 'boolean':
      if (typeof rawValue !== 'boolean') {
        invalid('boolean custom field value must be true or false', field.id);
      }
      break;
    case 'date':
      if (
        typeof rawValue !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(rawValue) ||
        Number.isNaN(Date.parse(`${rawValue}T00:00:00.000Z`))
      ) {
        invalid('date custom field value must be an ISO date string', field.id);
      }
      break;
    case 'list':
      if (typeof rawValue !== 'string' || !field.options.includes(rawValue)) {
        invalid('list custom field value must match one configured option', field.id);
      }
      break;
    case 'multi_select':
      if (
        !Array.isArray(rawValue) ||
        rawValue.some((item) => typeof item !== 'string' || !field.options.includes(item))
      ) {
        invalid('multi-select custom field value must be configured options', field.id);
      }
      break;
    case 'agent':
    case 'customer':
    case 'ticket':
    case 'dynamic_list':
      if (typeof rawValue !== 'string' || rawValue.length === 0) {
        invalid(`${field.type} custom field value must be a string id`, field.id);
      }
      break;
    case 'dynamic_multi_select':
      if (!Array.isArray(rawValue) || rawValue.some((item) => typeof item !== 'string')) {
        invalid('dynamic multi-select custom field value must be string ids', field.id);
      }
      break;
    case 'url':
      validateURLValue(rawValue, field.id);
      break;
    case 'address':
      validateAddressValue(rawValue, field.id);
      break;
  }

  return rawValue;
}

function validateURLValue(value: unknown, id?: string) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    invalid('url custom field value must be an object', id);
  }
  const url = (value as Record<string, unknown>).url;
  const title = (value as Record<string, unknown>).title;
  if (typeof url !== 'string') invalid('url custom field value requires a url', id);
  try {
    new URL(url);
  } catch {
    invalid('url custom field value must contain a valid URL', id);
  }
  if (title !== undefined && typeof title !== 'string') {
    invalid('url custom field title must be a string', id);
  }
}

function validateAddressValue(value: unknown, id?: string) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    invalid('address custom field value must be an object', id);
  }
  const record = value as Record<string, unknown>;
  for (const key of ['street1', 'city', 'state', 'zip', 'country']) {
    if (typeof record[key] !== 'string' || record[key].length === 0) {
      invalid(`address custom field value requires ${key}`, id);
    }
  }
  if (record.street2 !== undefined && typeof record.street2 !== 'string') {
    invalid('address custom field street2 must be a string', id);
  }
}

async function emitAudit(
  tx: Transaction,
  authData: WorkspaceAuthData,
  args: {
    ticketID?: string;
    customerID?: string;
    kind: string;
    payload?: ReadonlyJSONValue;
  },
  ts: number,
) {
  await tx.mutate.auditEvent.insert({
    id: newID(),
    workspaceID: authData.workspaceID,
    ticketID: args.ticketID,
    customerID: args.customerID,
    actorID: authData.sub,
    actorKind: auditActorKind(authData),
    kind: args.kind,
    payload: args.payload,
    createdAt: ts,
  });
}

async function assertCustomFieldInWorkspace(
  tx: Transaction,
  authData: WorkspaceAuthData,
  fieldID: string,
  category?: 'ticket' | 'customer',
) {
  const field = await tx.run(builder.customField.where('id', fieldID).one());
  if (!field) {
    throw new MutationError('custom field not found', MutationErrorCode.NOT_FOUND, fieldID);
  }
  if (field.workspaceID !== authData.workspaceID) {
    throw new MutationError('custom field not found', MutationErrorCode.CROSS_WORKSPACE, fieldID);
  }
  if (category && field.category !== category) {
    throw new MutationError(
      `custom field is not a ${category} field`,
      MutationErrorCode.INVALID_INPUT,
      fieldID,
    );
  }
  return field;
}

async function assertCustomFieldValueRefs(
  tx: Transaction,
  authData: WorkspaceAuthData,
  field: Pick<CustomField, 'type' | 'id'>,
  value: ReadonlyJSONValue,
) {
  if (value === null) return;
  if (field.type === 'agent') {
    const member = await tx.run(
      builder.member
        .where('userId', value as string)
        .where('organizationId', authData.workspaceID)
        .one(),
    );
    if (!member) {
      throw new MutationError(
        'referenced agent not found',
        MutationErrorCode.NOT_FOUND,
        value as string,
      );
    }
  }
  if (field.type === 'customer') {
    const customer = await tx.run(builder.customer.where('id', value as string).one());
    if (!customer || customer.workspaceID !== authData.workspaceID) {
      throw new MutationError(
        'referenced customer not found',
        MutationErrorCode.NOT_FOUND,
        value as string,
      );
    }
  }
  if (field.type === 'ticket') {
    const ticket = await tx.run(builder.ticket.where('id', value as string).one());
    if (!ticket || ticket.workspaceID !== authData.workspaceID) {
      throw new MutationError(
        'referenced ticket not found',
        MutationErrorCode.NOT_FOUND,
        value as string,
      );
    }
  }
}

export const customFieldMutators = {
  create: defineMutator(createCustomFieldArgsSchema, async ({ tx, args, ctx: authData }) => {
    assertHasWorkspace(authData);
    validateOptions(args.type, args.options ?? [], args.id);
    const defaultValue = asOptionalJSONValue(args.defaultValue, args.id);
    const dynamicConfig = asOptionalJSONValue(args.dynamicConfig, args.id);
    if (defaultValue !== undefined) {
      validateCustomFieldValue(
        {
          id: args.id,
          type: args.type,
          required: args.required ?? false,
          options: args.options ?? [],
          dynamicConfig,
        },
        defaultValue,
      );
    }
    const ts = now();
    await tx.mutate.customField.insert({
      id: args.id,
      workspaceID: authData.workspaceID,
      key: args.key,
      displayName: args.displayName,
      description: args.description,
      category: args.category,
      type: args.type,
      required: args.required ?? false,
      active: args.active ?? true,
      options: args.options ?? [],
      dynamicConfig,
      defaultValue,
      rules: asOptionalJSONValue(args.rules, args.id),
      dependsOn: args.dependsOn ?? [],
      editableBy: args.editableBy ?? ['agent', 'admin'],
      sortOrder: args.sortOrder ?? 0,
      createdAt: ts,
      updatedAt: ts,
    });
  }),

  update: defineMutator(updateCustomFieldArgsSchema, async ({ tx, args, ctx: authData }) => {
    assertHasWorkspace(authData);
    const field = await assertCustomFieldInWorkspace(tx, authData, args.id);
    const nextOptions = args.options ?? field.options;
    const nextDynamicConfig =
      args.dynamicConfig === undefined
        ? field.dynamicConfig
        : asOptionalJSONValue(args.dynamicConfig, args.id);
    validateOptions(field.type, nextOptions, args.id);
    const nextDefaultValue =
      args.defaultValue === undefined
        ? field.defaultValue
        : asOptionalJSONValue(args.defaultValue, args.id);
    if (nextDefaultValue !== undefined) {
      validateCustomFieldValue(
        {
          id: field.id,
          type: field.type,
          required: args.required ?? field.required,
          options: nextOptions,
          dynamicConfig: nextDynamicConfig,
        },
        nextDefaultValue,
      );
    }

    const change: Record<string, unknown> = { id: args.id, updatedAt: now() };
    if (args.displayName !== undefined) change.displayName = args.displayName;
    if (args.description !== undefined) change.description = args.description;
    if (args.required !== undefined) change.required = args.required;
    if (args.active !== undefined) change.active = args.active;
    if (args.options !== undefined) change.options = nextOptions;
    if (args.dynamicConfig !== undefined) change.dynamicConfig = nextDynamicConfig;
    if (args.defaultValue !== undefined) change.defaultValue = nextDefaultValue;
    if (args.rules !== undefined) change.rules = asOptionalJSONValue(args.rules, args.id);
    if (args.dependsOn !== undefined) change.dependsOn = args.dependsOn;
    if (args.editableBy !== undefined) change.editableBy = args.editableBy;
    if (args.sortOrder !== undefined) change.sortOrder = args.sortOrder;
    await tx.mutate.customField.update(change as { id: string });
  }),

  archive: defineMutator(customFieldIDOnlyArgsSchema, async ({ tx, args, ctx: authData }) => {
    assertHasWorkspace(authData);
    await assertCustomFieldInWorkspace(tx, authData, args.id);
    await tx.mutate.customField.update({ id: args.id, active: false, updatedAt: now() });
  }),

  setValueOnTicket: defineMutator(
    setCustomFieldValueOnTicketArgsSchema,
    async ({ tx, args, ctx: authData }) => {
      await assertCanModifyTicket(tx, authData, args.ticketID);
      const auth = authData as WorkspaceAuthData;
      const field = await assertCustomFieldInWorkspace(tx, auth, args.fieldID, 'ticket');
      if (!field.active) {
        throw new MutationError(
          'custom field is archived',
          MutationErrorCode.INVALID_INPUT,
          args.fieldID,
        );
      }
      const value = validateCustomFieldValue(field, args.value);
      await assertCustomFieldValueRefs(tx, auth, field, value);
      const existing = await tx.run(
        builder.customFieldValue
          .where('fieldID', args.fieldID)
          .where('ticketID', args.ticketID)
          .one(),
      );
      const ts = now();
      if (existing) {
        await tx.mutate.customFieldValue.update({
          id: existing.id,
          value,
          updatedByID: auth.sub,
          updatedAt: ts,
        });
      } else {
        await tx.mutate.customFieldValue.insert({
          id: args.id,
          fieldID: args.fieldID,
          workspaceID: auth.workspaceID,
          ticketID: args.ticketID,
          customerID: undefined,
          value,
          updatedByID: auth.sub,
          createdAt: ts,
          updatedAt: ts,
        });
      }
      await emitAudit(
        tx,
        auth,
        {
          ticketID: args.ticketID,
          kind: 'ticket.custom_field_changed',
          payload: {
            fieldID: field.id,
            fieldKey: field.key,
            fieldDisplayName: field.displayName,
            oldValue: existing?.value ?? null,
            newValue: value,
          },
        },
        ts,
      );
    },
  ),

  setValueOnCustomer: defineMutator(
    setCustomFieldValueOnCustomerArgsSchema,
    async ({ tx, args, ctx: authData }) => {
      await assertCanModifyCustomer(tx, authData, args.customerID);
      const auth = authData as WorkspaceAuthData;
      const field = await assertCustomFieldInWorkspace(tx, auth, args.fieldID, 'customer');
      if (!field.active) {
        throw new MutationError(
          'custom field is archived',
          MutationErrorCode.INVALID_INPUT,
          args.fieldID,
        );
      }
      const value = validateCustomFieldValue(field, args.value);
      await assertCustomFieldValueRefs(tx, auth, field, value);
      const existing = await tx.run(
        builder.customFieldValue
          .where('fieldID', args.fieldID)
          .where('customerID', args.customerID)
          .one(),
      );
      const ts = now();
      if (existing) {
        await tx.mutate.customFieldValue.update({
          id: existing.id,
          value,
          updatedByID: auth.sub,
          updatedAt: ts,
        });
      } else {
        await tx.mutate.customFieldValue.insert({
          id: args.id,
          fieldID: args.fieldID,
          workspaceID: auth.workspaceID,
          ticketID: undefined,
          customerID: args.customerID,
          value,
          updatedByID: auth.sub,
          createdAt: ts,
          updatedAt: ts,
        });
      }
      await emitAudit(
        tx,
        auth,
        {
          customerID: args.customerID,
          kind: 'customer.field_set',
          payload: {
            fieldID: field.id,
            fieldKey: field.key,
            fieldDisplayName: field.displayName,
            oldValue: existing?.value ?? null,
            newValue: value,
          },
        },
        ts,
      );
    },
  ),

  clearValueOnTicket: defineMutator(
    clearCustomFieldValueOnTicketArgsSchema,
    async ({ tx, args, ctx: authData }) => {
      await assertCanModifyTicket(tx, authData, args.ticketID);
      const auth = authData as WorkspaceAuthData;
      const field = await assertCustomFieldInWorkspace(tx, auth, args.fieldID, 'ticket');
      if (field.required) {
        throw new MutationError(
          'required custom field cannot be cleared',
          MutationErrorCode.INVALID_INPUT,
          args.fieldID,
        );
      }
      const existing = await tx.run(
        builder.customFieldValue
          .where('fieldID', args.fieldID)
          .where('ticketID', args.ticketID)
          .one(),
      );
      if (!existing) return;
      const ts = now();
      await tx.mutate.customFieldValue.delete({ id: existing.id });
      await emitAudit(
        tx,
        auth,
        {
          ticketID: args.ticketID,
          kind: 'ticket.custom_field_changed',
          payload: {
            fieldID: field.id,
            fieldKey: field.key,
            fieldDisplayName: field.displayName,
            oldValue: existing.value ?? null,
            newValue: null,
          },
        },
        ts,
      );
    },
  ),

  clearValueOnCustomer: defineMutator(
    clearCustomFieldValueOnCustomerArgsSchema,
    async ({ tx, args, ctx: authData }) => {
      await assertCanModifyCustomer(tx, authData, args.customerID);
      const auth = authData as WorkspaceAuthData;
      const field = await assertCustomFieldInWorkspace(tx, auth, args.fieldID, 'customer');
      if (field.required) {
        throw new MutationError(
          'required custom field cannot be cleared',
          MutationErrorCode.INVALID_INPUT,
          args.fieldID,
        );
      }
      const existing = await tx.run(
        builder.customFieldValue
          .where('fieldID', args.fieldID)
          .where('customerID', args.customerID)
          .one(),
      );
      if (!existing) return;
      const ts = now();
      await tx.mutate.customFieldValue.delete({ id: existing.id });
      await emitAudit(
        tx,
        auth,
        {
          customerID: args.customerID,
          kind: 'customer.field_cleared',
          payload: {
            fieldID: field.id,
            fieldKey: field.key,
            fieldDisplayName: field.displayName,
            oldValue: existing.value ?? null,
            newValue: null,
          },
        },
        ts,
      );
    },
  ),
};
