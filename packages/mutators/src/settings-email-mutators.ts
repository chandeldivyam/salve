import { builder } from '@opendesk/zero-schema';
import { defineMutator, type ReadonlyJSONValue, type Transaction } from '@rocicorp/zero';
import { z } from 'zod';
import { assertHasWorkspace, type WorkspaceAuthData } from './auth.js';
import { MutationError, MutationErrorCode } from './error.js';

const idArg = z.string().min(1);
const domainArg = z
  .string()
  .trim()
  .min(3)
  .max(253)
  .regex(/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/, 'invalid domain')
  .transform((value) => value.toLowerCase());
const localPartArg = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-zA-Z0-9._%+-]+$/)
  .transform((value) => value.toLowerCase());
const priorityArg = z.enum(['low', 'normal', 'high', 'urgent']);

function isReadonlyJSONValue(value: unknown): value is ReadonlyJSONValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return true;
  }
  if (Array.isArray(value)) return value.every(isReadonlyJSONValue);
  if (
    typeof value === 'object' &&
    value !== null &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    return Object.values(value).every(isReadonlyJSONValue);
  }
  return false;
}

const channelConfigArg = z.custom<ReadonlyJSONValue>(isReadonlyJSONValue).optional();

export const createEmailDomainArgsSchema = z.object({
  id: idArg,
  channelID: idArg,
  domain: domainArg,
  fromName: z.string().trim().min(1).max(120).optional(),
  signature: z.string().max(4000).optional(),
  mailFromSubdomain: z.string().trim().min(1).max(63).default('mail'),
  channelConfig: channelConfigArg,
});
export type CreateEmailDomainArgs = z.infer<typeof createEmailDomainArgsSchema>;

export const createEmailAddressArgsSchema = z.object({
  id: idArg,
  sendingDomainID: idArg,
  channelID: idArg,
  localPart: localPartArg,
  label: z.string().trim().min(1).max(120).optional(),
  canSend: z.boolean().default(true),
  canReceive: z.boolean().default(true),
  isDefault: z.boolean().default(false),
  defaultTeamID: z.string().trim().min(1).max(120).optional(),
  signature: z.string().max(4000).optional(),
  channelConfig: channelConfigArg,
});
export type CreateEmailAddressArgs = z.infer<typeof createEmailAddressArgsSchema>;

export const upsertEmailRoutingRuleArgsSchema = z.object({
  id: idArg,
  emailAddressID: idArg,
  channelID: idArg.optional(),
  destinationAddress: z.string().email().optional(),
  senderPattern: z.string().trim().max(500).optional(),
  subjectPattern: z.string().trim().max(500).optional(),
  assignTeamID: z.string().trim().min(1).max(120).optional(),
  assignAgentID: z.string().min(1).optional(),
  setPriority: priorityArg.default('normal'),
  priority: z.number().int().min(0).max(10_000).default(100),
  enabled: z.boolean().default(true),
});
export type UpsertEmailRoutingRuleArgs = z.infer<typeof upsertEmailRoutingRuleArgsSchema>;

function now(): number {
  return Date.now();
}

function invalid(message: string, id?: string): never {
  throw new MutationError(message, MutationErrorCode.INVALID_INPUT, id);
}

async function assertSendingDomain(tx: Transaction, auth: WorkspaceAuthData, id: string) {
  const domain = await tx.run(builder.sendingDomain.where('id', id).one());
  if (!domain) {
    throw new MutationError('sending domain not found', MutationErrorCode.NOT_FOUND, id);
  }
  if (domain.workspaceID !== auth.workspaceID) {
    throw new MutationError('sending domain not found', MutationErrorCode.CROSS_WORKSPACE, id);
  }
  return domain;
}

async function assertEmailChannel(
  tx: Transaction,
  auth: WorkspaceAuthData,
  args: { channelID: string; sendingDomainID: string },
) {
  const channel = await tx.run(builder.channel.where('id', args.channelID).one());
  if (!channel) return null;
  if (channel.workspaceID !== auth.workspaceID || channel.kind !== 'email' || channel.deletedAt) {
    throw new MutationError('email channel not found', MutationErrorCode.NOT_FOUND, args.channelID);
  }
  const emailChannel = await tx.run(builder.emailChannel.where('channelID', args.channelID).one());
  if (!emailChannel || emailChannel.sendingDomainID !== args.sendingDomainID) {
    invalid('channel is not linked to the sending domain', args.channelID);
  }
  return channel;
}

async function ensureEmailChannel(
  tx: Transaction,
  auth: WorkspaceAuthData,
  args: {
    channelID: string;
    sendingDomainID: string;
    domain: string;
    channelConfig?: ReadonlyJSONValue;
  },
) {
  const existing = await assertEmailChannel(tx, auth, args);
  if (existing) return;
  const ts = now();
  await tx.mutate.channel.insert({
    id: args.channelID,
    workspaceID: auth.workspaceID,
    kind: 'email',
    name: `${args.domain} email`,
    isDefault: false,
    config: args.channelConfig ?? {},
    deletedAt: undefined,
    createdAt: ts,
    updatedAt: ts,
  });
  await tx.mutate.emailChannel.insert({
    channelID: args.channelID,
    sendingDomainID: args.sendingDomainID,
    fromName: undefined,
    signature: undefined,
    defaultPriority: 'normal',
    threadingPrefs: {},
    newTicketAfterClosedDays: 14,
    createdAt: ts,
    updatedAt: ts,
  });
}

async function assertEmailAddress(tx: Transaction, auth: WorkspaceAuthData, id: string) {
  const address = await tx.run(builder.emailAddress.where('id', id).one());
  if (!address || address.deletedAt) {
    throw new MutationError('email address not found', MutationErrorCode.NOT_FOUND, id);
  }
  if (address.workspaceID !== auth.workspaceID) {
    throw new MutationError('email address not found', MutationErrorCode.CROSS_WORKSPACE, id);
  }
  return address;
}

async function assertCanAssignAgent(
  tx: Transaction,
  auth: WorkspaceAuthData,
  agentID: string | undefined,
) {
  if (!agentID) return;
  const membership = await tx.run(
    builder.member.where('userId', agentID).where('organizationId', auth.workspaceID).one(),
  );
  if (!membership) invalid('assigned agent is not a member of this workspace', agentID);
}

export const emailSettingsMutators = {
  domain: {
    create: defineMutator(createEmailDomainArgsSchema, async ({ tx, args, ctx: authData }) => {
      assertHasWorkspace(authData);
      const existing = await tx.run(
        builder.sendingDomain
          .where('workspaceID', authData.workspaceID)
          .where('domain', args.domain)
          .one(),
      );
      if (existing) invalid('sending domain is already added', existing.id);

      const ts = now();
      await tx.mutate.sendingDomain.insert({
        id: args.id,
        workspaceID: authData.workspaceID,
        domain: args.domain,
        sesIdentityArn: undefined,
        dkimTokens: [],
        mailFromSubdomain: args.mailFromSubdomain,
        dnsStatus: 'pending',
        dmarcStatus: 'pending',
        provisionStatus: 'pending',
        lastVerifiedAt: undefined,
        suspendedAt: undefined,
        suspendedReason: undefined,
        providerMeta: {},
        createdAt: ts,
        updatedAt: ts,
      });
      await tx.mutate.channel.insert({
        id: args.channelID,
        workspaceID: authData.workspaceID,
        kind: 'email',
        name: `${args.domain} email`,
        isDefault: true,
        config: args.channelConfig ?? {},
        deletedAt: undefined,
        createdAt: ts,
        updatedAt: ts,
      });
      await tx.mutate.emailChannel.insert({
        channelID: args.channelID,
        sendingDomainID: args.id,
        fromName: args.fromName ?? undefined,
        signature: args.signature ?? undefined,
        defaultPriority: 'normal',
        threadingPrefs: {},
        newTicketAfterClosedDays: 14,
        createdAt: ts,
        updatedAt: ts,
      });
    }),
  },

  address: {
    create: defineMutator(createEmailAddressArgsSchema, async ({ tx, args, ctx: authData }) => {
      assertHasWorkspace(authData);
      const domain = await assertSendingDomain(tx, authData, args.sendingDomainID);
      await ensureEmailChannel(tx, authData, {
        channelID: args.channelID,
        sendingDomainID: args.sendingDomainID,
        domain: domain.domain,
        channelConfig: args.channelConfig,
      });

      const fullAddress = `${args.localPart}@${domain.domain}`;
      const duplicate = await tx.run(builder.emailAddress.where('fullAddress', fullAddress).one());
      if (duplicate) invalid('email address is already configured', duplicate.id);

      if (args.isDefault) {
        const existingAddresses = await tx.run(
          builder.emailAddress.where('channelID', args.channelID),
        );
        const ts = now();
        for (const address of existingAddresses) {
          if (!address.deletedAt && address.isDefault) {
            await tx.mutate.emailAddress.update({
              id: address.id,
              isDefault: false,
              updatedAt: ts,
            });
          }
        }
      }

      const ts = now();
      await tx.mutate.emailAddress.insert({
        id: args.id,
        workspaceID: authData.workspaceID,
        channelID: args.channelID,
        sendingDomainID: args.sendingDomainID,
        localPart: args.localPart,
        fullAddress,
        canSend: args.canSend,
        canReceive: args.canReceive,
        isDefault: args.isDefault,
        defaultTeamID: args.defaultTeamID ?? undefined,
        signature: args.signature ?? undefined,
        label: args.label ?? undefined,
        deletedAt: undefined,
        createdAt: ts,
        updatedAt: ts,
      });
    }),
  },

  routingRule: {
    upsert: defineMutator(upsertEmailRoutingRuleArgsSchema, async ({ tx, args, ctx: authData }) => {
      assertHasWorkspace(authData);
      const address = await assertEmailAddress(tx, authData, args.emailAddressID);
      if (!address.canReceive) invalid('email address cannot receive inbound mail', address.id);
      if (args.channelID && args.channelID !== address.channelID) {
        invalid('routing rule channel must match email address channel', args.channelID);
      }
      if (
        args.destinationAddress &&
        args.destinationAddress.toLowerCase() !== address.fullAddress.toLowerCase()
      ) {
        invalid('routing rule destination must match email address', address.id);
      }
      await assertCanAssignAgent(tx, authData, args.assignAgentID);

      const channelID = address.channelID;
      const candidates = await tx.run(
        builder.inboundRoutingRule
          .where('workspaceID', authData.workspaceID)
          .where('channelID', channelID)
          .where('emailAddressID', address.id),
      );
      const existing = candidates.find(
        (rule) =>
          (rule.senderPattern ?? undefined) === (args.senderPattern ?? undefined) &&
          (rule.subjectPattern ?? undefined) === (args.subjectPattern ?? undefined),
      );

      const ts = now();
      if (existing) {
        await tx.mutate.inboundRoutingRule.update({
          id: existing.id,
          assignTeamID: args.assignTeamID ?? undefined,
          assignAgentID: args.assignAgentID ?? undefined,
          setPriority: args.setPriority,
          priority: args.priority,
          enabled: args.enabled,
          updatedAt: ts,
        });
        return;
      }

      await tx.mutate.inboundRoutingRule.insert({
        id: args.id,
        workspaceID: authData.workspaceID,
        channelID,
        emailAddressID: address.id,
        senderPattern: args.senderPattern ?? undefined,
        subjectPattern: args.subjectPattern ?? undefined,
        assignTeamID: args.assignTeamID ?? undefined,
        assignAgentID: args.assignAgentID ?? undefined,
        setPriority: args.setPriority,
        priority: args.priority,
        enabled: args.enabled,
        createdAt: ts,
        updatedAt: ts,
      });
    }),
  },
};
