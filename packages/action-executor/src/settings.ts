import { randomBytes } from 'node:crypto';
import { defaultKeyHasher } from '@better-auth/api-key';
import {
  type ActionOutput,
  type SettingsActionID,
  scopesExceeding,
  scopesForRole,
  settingsActions,
} from '@opendesk/action-contracts';
import { authSchema, schema as dbSchema } from '@opendesk/db';
import { and, asc, eq, type SQL, sql } from 'drizzle-orm';
import type { Executor, ExecutorCtx, UntypedExecutor } from './ctx.js';
import { asUntypedExecutor } from './ctx.js';
import { ActionExecutorError, notFound } from './errors.js';
import { actionResourceID } from './ids.js';

const PAT_PREFIX = 'slv_pat_';

type TagResource = ActionOutput<typeof settingsActions.tagsCreate>['tag'];
type TagGroupResource = ActionOutput<typeof settingsActions.tagGroupsCreate>['group'];
type CustomFieldResource = ActionOutput<typeof settingsActions.customFieldsCreate>['customField'];
type EmailDomainResource = ActionOutput<typeof settingsActions.emailDomainsCreate>;
type RoutingRuleResource = ActionOutput<typeof settingsActions.emailRoutingRulesUpsert>;

export const listSettingsTagsExecutor: Executor<typeof settingsActions.tagsList> = async (
  ctx,
  input,
) => {
  const archivedFilter = input.includeArchived
    ? undefined
    : sql`${dbSchema.tag.archivedAt} IS NULL`;
  const groupArchivedFilter = input.includeArchived
    ? undefined
    : sql`${dbSchema.tagGroup.archivedAt} IS NULL`;
  const [groups, tags] = await Promise.all([
    ctx.db
      .select()
      .from(dbSchema.tagGroup)
      .where(and(eq(dbSchema.tagGroup.workspaceId, ctx.auth.workspaceID), groupArchivedFilter))
      .orderBy(asc(dbSchema.tagGroup.sortOrder), asc(dbSchema.tagGroup.label)),
    ctx.db
      .select({
        tag: dbSchema.tag,
        group: dbSchema.tagGroup,
      })
      .from(dbSchema.tag)
      .leftJoin(dbSchema.tagGroup, eq(dbSchema.tag.groupId, dbSchema.tagGroup.id))
      .where(and(eq(dbSchema.tag.workspaceId, ctx.auth.workspaceID), archivedFilter))
      .orderBy(asc(dbSchema.tag.sortOrder), asc(dbSchema.tag.label)),
  ]);
  return {
    groups: groups.map(mapTagGroup),
    tags: tags.map((row) => mapTag(row.tag, row.group ?? null)),
  };
};

export const createTagExecutor: Executor<typeof settingsActions.tagsCreate> = async (
  ctx,
  input,
) => {
  const id = actionResourceID(ctx, settingsActions.tagsCreate.id, 'tag');
  await ctx.runMutation('tag.create', {
    id,
    groupID: input.groupId,
    label: input.label,
    color: input.color,
    sortOrder: input.sortOrder,
  });
  return { tag: await readTagByID(ctx, id) };
};

export const updateTagExecutor: Executor<typeof settingsActions.tagsUpdate> = async (
  ctx,
  input,
) => {
  await ctx.runMutation('tag.update', {
    id: input.tagId,
    groupID: input.groupId,
    label: input.label,
    color: input.color,
    sortOrder: input.sortOrder,
  });
  return { tag: await readTagByID(ctx, input.tagId) };
};

export const archiveTagExecutor: Executor<typeof settingsActions.tagsArchive> = async (
  ctx,
  input,
) => {
  await ctx.runMutation('tag.archive', { id: input.tagId });
  return { tag: await readTagByID(ctx, input.tagId, { includeArchived: true }) };
};

export const createTagGroupExecutor: Executor<typeof settingsActions.tagGroupsCreate> = async (
  ctx,
  input,
) => {
  const id = actionResourceID(ctx, settingsActions.tagGroupsCreate.id, 'tag-group');
  await ctx.runMutation('tagGroup.create', {
    id,
    label: input.label,
    color: input.color,
    sortOrder: input.sortOrder,
  });
  return { group: await readTagGroupByID(ctx, id) };
};

export const updateTagGroupExecutor: Executor<typeof settingsActions.tagGroupsUpdate> = async (
  ctx,
  input,
) => {
  await ctx.runMutation('tagGroup.update', {
    id: input.groupId,
    label: input.label,
    color: input.color,
    sortOrder: input.sortOrder,
  });
  return { group: await readTagGroupByID(ctx, input.groupId) };
};

export const archiveTagGroupExecutor: Executor<typeof settingsActions.tagGroupsArchive> = async (
  ctx,
  input,
) => {
  await ctx.runMutation('tagGroup.archive', { id: input.groupId });
  return { group: await readTagGroupByID(ctx, input.groupId, { includeArchived: true }) };
};

export const restoreTagGroupExecutor: Executor<typeof settingsActions.tagGroupsRestore> = async (
  ctx,
  input,
) => {
  await ctx.runMutation('tagGroup.restore', { id: input.groupId });
  return { group: await readTagGroupByID(ctx, input.groupId) };
};

export const listCustomFieldsExecutor: Executor<typeof settingsActions.customFieldsList> = async (
  ctx,
  input,
) => {
  const filters: SQL[] = [eq(dbSchema.customField.workspaceId, ctx.auth.workspaceID)];
  if (input.category) filters.push(eq(dbSchema.customField.category, input.category));
  if (!input.includeInactive) filters.push(eq(dbSchema.customField.active, true));
  const rows = await ctx.db
    .select()
    .from(dbSchema.customField)
    .where(and(...filters))
    .orderBy(asc(dbSchema.customField.category), asc(dbSchema.customField.sortOrder));
  return { data: rows.map(mapCustomField) };
};

export const createCustomFieldExecutor: Executor<
  typeof settingsActions.customFieldsCreate
> = async (ctx, input) => {
  const id = actionResourceID(ctx, settingsActions.customFieldsCreate.id, 'custom-field');
  await ctx.runMutation('customField.create', { id, ...input });
  return { customField: await readCustomFieldByID(ctx, id) };
};

export const updateCustomFieldExecutor: Executor<
  typeof settingsActions.customFieldsUpdate
> = async (ctx, input) => {
  await ctx.runMutation('customField.update', {
    id: input.customFieldId,
    displayName: input.displayName,
    description: input.description,
    required: input.required,
    active: input.active,
    options: input.options,
    dynamicConfig: input.dynamicConfig,
    defaultValue: input.defaultValue,
    rules: input.rules,
    dependsOn: input.dependsOn,
    editableBy: input.editableBy,
    sortOrder: input.sortOrder,
  });
  return { customField: await readCustomFieldByID(ctx, input.customFieldId) };
};

export const archiveCustomFieldExecutor: Executor<
  typeof settingsActions.customFieldsArchive
> = async (ctx, input) => {
  await ctx.runMutation('customField.archive', { id: input.customFieldId });
  return { customField: await readCustomFieldByID(ctx, input.customFieldId) };
};

export const createEmailDomainExecutor: Executor<
  typeof settingsActions.emailDomainsCreate
> = async (ctx, input) => {
  const id = actionResourceID(ctx, settingsActions.emailDomainsCreate.id, 'sending-domain');
  const channelID = actionResourceID(ctx, settingsActions.emailDomainsCreate.id, 'channel');
  const domain = input.domain.toLowerCase();
  await ctx.runMutation('settings.email.domain.create', {
    id,
    channelID,
    domain,
    fromName: input.fromName,
    signature: input.signature,
    mailFromSubdomain: process.env.MAIL_FROM_SUBDOMAIN ?? 'mail',
    channelConfig: emailChannelConfig(id, ctx.auth.workspaceID),
  });
  // Read back the row the mutator just persisted so any DKIM tokens / status
  // already populated synchronously appear in the response. The previous
  // synthetic shape always reported `dkimTokens: []` and `provisionStatus:
  // 'pending'`, which disagreed with state observable elsewhere via Zero.
  const row = await readSendingDomainRow(ctx, id);
  return mapEmailDomain({
    id: row.id,
    channelID,
    domain: row.domain,
    dkimTokens: Array.isArray(row.dkimTokens)
      ? (row.dkimTokens as Array<{ name: string; value: string }>)
      : [],
    mailFromSubdomain: row.mailFromSubdomain,
    provisionStatus: row.provisionStatus,
    dnsStatus: row.dnsStatus,
  });
};

export const createEmailAddressExecutor: Executor<
  typeof settingsActions.emailAddressesCreate
> = async (ctx, input) => {
  const domain = await readSendingDomainRow(ctx, input.sendingDomainId);
  const channelID =
    input.channelId ??
    (await findDefaultEmailChannel(ctx, input.sendingDomainId)) ??
    actionResourceID(ctx, settingsActions.emailAddressesCreate.id, 'channel');
  const id = actionResourceID(ctx, settingsActions.emailAddressesCreate.id, 'email-address');
  await ctx.runMutation('settings.email.address.create', {
    id,
    sendingDomainID: input.sendingDomainId,
    channelID,
    localPart: input.localPart,
    label: input.label,
    canSend: input.canSend,
    canReceive: input.canReceive,
    isDefault: input.isDefault,
    signature: input.signature,
    channelConfig: emailChannelConfig(input.sendingDomainId, ctx.auth.workspaceID),
  });
  return {
    id,
    channelId: channelID,
    sendingDomainId: input.sendingDomainId,
    fullAddress: `${input.localPart.toLowerCase()}@${domain.domain}`,
  };
};

export const upsertEmailRoutingRuleExecutor: Executor<
  typeof settingsActions.emailRoutingRulesUpsert
> = async (ctx, input) => {
  const id = actionResourceID(ctx, settingsActions.emailRoutingRulesUpsert.id, 'routing-rule');
  await ctx.runMutation('settings.email.routingRule.upsert', {
    id,
    emailAddressID: input.emailAddressId,
    channelID: input.channelId,
    destinationAddress: input.destinationAddress,
    senderPattern: input.senderPattern,
    subjectPattern: input.subjectPattern,
    assignTeamID: input.assignTeamId,
    assignAgentID: input.assignAgentId,
    setPriority: input.setPriority,
    priority: input.priority,
    enabled: input.enabled,
  });
  const rule = await findRoutingRule(ctx, {
    channelID: input.channelId,
    emailAddressID: input.emailAddressId,
    senderPattern: input.senderPattern,
    subjectPattern: input.subjectPattern,
  });
  return mapRoutingRule(
    rule ?? {
      id,
      ...input,
      setPriority: input.setPriority ?? 'normal',
      enabled: input.enabled ?? true,
    },
  );
};

export const listApiTokensExecutor: Executor<typeof settingsActions.apiTokensList> = async (
  ctx,
) => {
  const isAdmin = ctx.auth.role === 'owner' || ctx.auth.role === 'admin';
  // Non-admin callers see only their own tokens to avoid disclosing other
  // principals' token names/prefixes/last-used metadata. Admins see the full
  // workspace set so they can revoke service-account tokens they minted.
  const baseFilter = eq(authSchema.apikey.referenceId, ctx.auth.workspaceID);
  const filter = isAdmin
    ? baseFilter
    : and(
        baseFilter,
        eq(authSchema.apikey.principalKind, 'user'),
        eq(authSchema.apikey.principalId, ctx.auth.sub),
      );
  const rows = await ctx.db
    .select()
    .from(authSchema.apikey)
    .where(filter)
    .orderBy(asc(authSchema.apikey.createdAt));
  return { data: rows.map(mapApiToken) };
};

export const createApiTokenExecutor: Executor<typeof settingsActions.apiTokensCreate> = async (
  ctx,
  input,
) => {
  if (ctx.auth.principalKind !== 'user') {
    throw new ActionExecutorError({
      status: 403,
      type: 'forbidden',
      code: 'api_tokens.user_principal_required',
      message: 'Only user principals can create personal API tokens',
    });
  }
  // Cap requested scopes to the caller's effective envelope. Bearer-auth
  // callers (PAT minting another PAT) are bounded by their own scopes —
  // never lets a `settings:write`-only token mint `tickets:write`. Cookie
  // callers don't carry an explicit scope set; we cap to `scopesForRole`.
  const grantedEnvelope = ctx.auth.scopes ?? scopesForRole(ctx.auth.role);
  const exceeding = scopesExceeding(input.scopes, grantedEnvelope);
  if (exceeding.length > 0) {
    throw new ActionExecutorError({
      status: 403,
      type: 'forbidden',
      code: 'api_tokens.scope_exceeds_caller',
      message: `Requested scopes exceed caller's privilege: ${exceeding.join(', ')}`,
      field: 'scopes',
    });
  }
  const keyId = actionResourceID(ctx, settingsActions.apiTokensCreate.id, 'api-token');
  const plaintext = generatePlaintext(PAT_PREFIX);
  const hashed = await defaultKeyHasher(plaintext);
  const now = new Date();
  const expiresAt = input.expiresInDays
    ? new Date(Date.now() + input.expiresInDays * 86_400_000)
    : null;
  await ctx.db.insert(authSchema.apikey).values({
    id: keyId,
    configId: 'default',
    name: input.name,
    start: plaintext.slice(0, 12),
    prefix: PAT_PREFIX,
    referenceId: ctx.auth.workspaceID,
    key: hashed,
    enabled: true,
    rateLimitEnabled: true,
    rateLimitTimeWindow: 60_000,
    rateLimitMax: 60,
    requestCount: 0,
    expiresAt,
    permissions: JSON.stringify(permissionStatementsFromScopes(input.scopes)),
    metadata: JSON.stringify({
      principalKind: 'user',
      userID: ctx.auth.sub,
      principalID: ctx.auth.sub,
      workspaceID: ctx.auth.workspaceID,
    }),
    principalKind: 'user',
    principalId: ctx.auth.sub,
    createdAt: now,
    updatedAt: now,
  });
  return {
    id: keyId,
    token: plaintext,
    name: input.name,
    prefix: PAT_PREFIX,
    principalKind: 'user',
    scopes: input.scopes,
    expiresAt: expiresAt ? expiresAt.toISOString() : null,
    createdAt: now.toISOString(),
  };
};

export const revokeApiTokenExecutor: Executor<typeof settingsActions.apiTokensRevoke> = async (
  ctx,
  input,
) => {
  const deleted = await ctx.db
    .delete(authSchema.apikey)
    .where(
      and(
        eq(authSchema.apikey.id, input.tokenId),
        eq(authSchema.apikey.referenceId, ctx.auth.workspaceID),
        eq(authSchema.apikey.principalKind, 'user'),
        eq(authSchema.apikey.principalId, ctx.auth.sub),
      ),
    )
    .returning({ id: authSchema.apikey.id });
  if (deleted.length === 0) throw notFound('api_token.not_found', 'API token not found');
  return {};
};

export const settingsExecutors: Record<SettingsActionID, UntypedExecutor> = {
  [settingsActions.tagsList.id]: asUntypedExecutor(listSettingsTagsExecutor),
  [settingsActions.tagsCreate.id]: asUntypedExecutor(createTagExecutor),
  [settingsActions.tagsUpdate.id]: asUntypedExecutor(updateTagExecutor),
  [settingsActions.tagsArchive.id]: asUntypedExecutor(archiveTagExecutor),
  [settingsActions.tagGroupsCreate.id]: asUntypedExecutor(createTagGroupExecutor),
  [settingsActions.tagGroupsUpdate.id]: asUntypedExecutor(updateTagGroupExecutor),
  [settingsActions.tagGroupsArchive.id]: asUntypedExecutor(archiveTagGroupExecutor),
  [settingsActions.tagGroupsRestore.id]: asUntypedExecutor(restoreTagGroupExecutor),
  [settingsActions.customFieldsList.id]: asUntypedExecutor(listCustomFieldsExecutor),
  [settingsActions.customFieldsCreate.id]: asUntypedExecutor(createCustomFieldExecutor),
  [settingsActions.customFieldsUpdate.id]: asUntypedExecutor(updateCustomFieldExecutor),
  [settingsActions.customFieldsArchive.id]: asUntypedExecutor(archiveCustomFieldExecutor),
  [settingsActions.emailDomainsCreate.id]: asUntypedExecutor(createEmailDomainExecutor),
  [settingsActions.emailAddressesCreate.id]: asUntypedExecutor(createEmailAddressExecutor),
  [settingsActions.emailRoutingRulesUpsert.id]: asUntypedExecutor(upsertEmailRoutingRuleExecutor),
  [settingsActions.apiTokensList.id]: asUntypedExecutor(listApiTokensExecutor),
  [settingsActions.apiTokensCreate.id]: asUntypedExecutor(createApiTokenExecutor),
  [settingsActions.apiTokensRevoke.id]: asUntypedExecutor(revokeApiTokenExecutor),
};

async function readTagByID(
  ctx: ExecutorCtx,
  tagID: string,
  opts: { includeArchived?: boolean } = {},
): Promise<TagResource> {
  const filters: SQL[] = [
    eq(dbSchema.tag.id, tagID),
    eq(dbSchema.tag.workspaceId, ctx.auth.workspaceID),
  ];
  if (!opts.includeArchived) filters.push(sql`${dbSchema.tag.archivedAt} IS NULL`);
  const rows = await ctx.db
    .select({ tag: dbSchema.tag, group: dbSchema.tagGroup })
    .from(dbSchema.tag)
    .leftJoin(dbSchema.tagGroup, eq(dbSchema.tag.groupId, dbSchema.tagGroup.id))
    .where(and(...filters))
    .limit(1);
  const row = rows[0];
  if (!row) throw notFound('tag.not_found', 'Tag not found');
  return mapTag(row.tag, row.group ?? null);
}

async function readTagGroupByID(
  ctx: ExecutorCtx,
  groupID: string,
  opts: { includeArchived?: boolean } = {},
): Promise<TagGroupResource> {
  const filters: SQL[] = [
    eq(dbSchema.tagGroup.id, groupID),
    eq(dbSchema.tagGroup.workspaceId, ctx.auth.workspaceID),
  ];
  if (!opts.includeArchived) filters.push(sql`${dbSchema.tagGroup.archivedAt} IS NULL`);
  const rows = await ctx.db
    .select()
    .from(dbSchema.tagGroup)
    .where(and(...filters))
    .limit(1);
  const row = rows[0];
  if (!row) throw notFound('tag_group.not_found', 'Tag group not found');
  return mapTagGroup(row);
}

async function readCustomFieldByID(ctx: ExecutorCtx, id: string): Promise<CustomFieldResource> {
  const rows = await ctx.db
    .select()
    .from(dbSchema.customField)
    .where(
      and(
        eq(dbSchema.customField.id, id),
        eq(dbSchema.customField.workspaceId, ctx.auth.workspaceID),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) throw notFound('custom_field.not_found', 'Custom field not found');
  return mapCustomField(row);
}

function mapTagGroup(row: typeof dbSchema.tagGroup.$inferSelect): TagGroupResource {
  return {
    id: row.id,
    label: row.label,
    color: row.color,
    sortOrder: row.sortOrder,
    archivedAt: toNullableIso(row.archivedAt),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

function mapTag(
  row: typeof dbSchema.tag.$inferSelect,
  group: typeof dbSchema.tagGroup.$inferSelect | null,
): TagResource {
  return {
    id: row.id,
    groupId: row.groupId ?? null,
    label: row.label,
    color: row.color ?? null,
    sortOrder: row.sortOrder,
    archivedAt: toNullableIso(row.archivedAt),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    group: group ? mapTagGroup(group) : null,
  };
}

function mapCustomField(row: typeof dbSchema.customField.$inferSelect): CustomFieldResource {
  return {
    id: row.id,
    key: row.key,
    displayName: row.displayName,
    description: row.description ?? null,
    category: row.category,
    type: row.type,
    required: row.required,
    active: row.active,
    options: row.options ?? [],
    dynamicConfig: row.dynamicConfig ?? null,
    defaultValue: row.defaultValue ?? null,
    rules: row.rules ?? null,
    dependsOn: row.dependsOn ?? [],
    editableBy: row.editableBy ?? [],
    sortOrder: row.sortOrder,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

async function readSendingDomainRow(ctx: ExecutorCtx, sendingDomainID: string) {
  const rows = await ctx.db
    .select()
    .from(dbSchema.sendingDomain)
    .where(
      and(
        eq(dbSchema.sendingDomain.id, sendingDomainID),
        eq(dbSchema.sendingDomain.workspaceId, ctx.auth.workspaceID),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) throw notFound('sending_domain.not_found', 'Sending domain not found');
  return row;
}

async function findDefaultEmailChannel(
  ctx: ExecutorCtx,
  sendingDomainID: string,
): Promise<string | null> {
  const rows = await ctx.db
    .select({ id: dbSchema.channel.id })
    .from(dbSchema.channel)
    .innerJoin(dbSchema.emailChannel, eq(dbSchema.emailChannel.channelId, dbSchema.channel.id))
    .where(
      and(
        eq(dbSchema.channel.workspaceId, ctx.auth.workspaceID),
        eq(dbSchema.channel.kind, 'email'),
        eq(dbSchema.emailChannel.sendingDomainId, sendingDomainID),
        sql`${dbSchema.channel.deletedAt} IS NULL`,
      ),
    )
    .orderBy(sql`${dbSchema.channel.isDefault} DESC`, asc(dbSchema.channel.createdAt))
    .limit(1);
  return rows[0]?.id ?? null;
}

function mapEmailDomain(args: {
  id: string;
  channelID: string;
  domain: string;
  dkimTokens: Array<{ name: string; value: string }>;
  mailFromSubdomain: string;
  provisionStatus: EmailDomainResource['provisionStatus'];
  dnsStatus: string;
}): EmailDomainResource {
  return {
    id: args.id,
    channelId: args.channelID,
    domain: args.domain,
    dkimTokens: args.dkimTokens,
    mailFromDomain: `${args.mailFromSubdomain}.${args.domain}`,
    status: args.dnsStatus,
    provisionStatus: args.provisionStatus,
  };
}

async function findRoutingRule(
  ctx: ExecutorCtx,
  args: {
    channelID: string;
    emailAddressID: string;
    senderPattern?: string;
    subjectPattern?: string;
  },
) {
  const rows = await ctx.db
    .select()
    .from(dbSchema.inboundRoutingRule)
    .where(
      and(
        eq(dbSchema.inboundRoutingRule.workspaceId, ctx.auth.workspaceID),
        eq(dbSchema.inboundRoutingRule.channelId, args.channelID),
        eq(dbSchema.inboundRoutingRule.emailAddressId, args.emailAddressID),
        sql`${dbSchema.inboundRoutingRule.senderPattern} IS NOT DISTINCT FROM ${args.senderPattern ?? null}`,
        sql`${dbSchema.inboundRoutingRule.subjectPattern} IS NOT DISTINCT FROM ${args.subjectPattern ?? null}`,
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

function mapRoutingRule(
  row:
    | typeof dbSchema.inboundRoutingRule.$inferSelect
    | {
        id: string;
        channelId: string;
        emailAddressId: string;
        setPriority: 'low' | 'normal' | 'high' | 'urgent';
        assignTeamId?: string;
        assignAgentId?: string;
        enabled: boolean;
      },
): RoutingRuleResource {
  return {
    id: row.id,
    emailAddressId: row.emailAddressId ?? '',
    channelId: row.channelId,
    setPriority: row.setPriority ?? 'normal',
    assignTeamId: row.assignTeamId ?? null,
    assignAgentId: row.assignAgentId ?? null,
    enabled: row.enabled,
  };
}

function mapApiToken(row: typeof authSchema.apikey.$inferSelect) {
  const principalKind: 'user' | 'service_account' | null =
    row.principalKind === 'user' || row.principalKind === 'service_account'
      ? row.principalKind
      : null;
  return {
    id: row.id,
    name: row.name ?? null,
    prefix: row.prefix ?? null,
    start: row.start ?? null,
    principalKind,
    principalId: row.principalId ?? null,
    enabled: row.enabled,
    expiresAt: toNullableIso(row.expiresAt),
    lastRequest: toNullableIso(row.lastRequest),
    createdAt: toIso(row.createdAt),
  };
}

function generatePlaintext(prefix: string): string {
  const body = randomBytes(48).toString('base64url').slice(0, 64);
  return `${prefix}${body}`;
}

function permissionStatementsFromScopes(scopes: readonly string[]): Record<string, string[]> {
  const permissions: Record<string, string[]> = {};
  for (const scope of scopes) {
    const separator = scope.lastIndexOf(':');
    const resource = scope.slice(0, separator);
    const action = scope.slice(separator + 1);
    permissions[resource] = [...(permissions[resource] ?? []), action];
  }
  return permissions;
}

function emailChannelConfig(sendingDomainID: string, workspaceID: string): Record<string, string> {
  return {
    sendingDomainID,
    inboundForwardingAddress: `inbound+ws_${workspaceID}@${process.env.INBOUND_EMAIL_DOMAIN ?? 'in.usesalve.com'}`,
    replyAddressPattern: `*@${process.env.REPLY_DOMAIN ?? 'reply.usesalve.com'}`,
  };
}

function toIso(value: Date): string {
  return value.toISOString();
}

function toNullableIso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}
