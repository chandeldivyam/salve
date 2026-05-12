import { z } from 'zod';

export const DELIVERY_EVENT = {
  MESSAGE_REQUESTED: 'delivery/message.requested',
  MESSAGE_SENT: 'delivery/message.sent',
  MESSAGE_DELIVERED: 'delivery/message.delivered',
  MESSAGE_BOUNCED: 'delivery/message.bounced',
  MESSAGE_COMPLAINED: 'delivery/message.complained',
  MESSAGE_FAILED: 'delivery/message.failed',
} as const;

export const DOMAIN_EVENT = {
  PROVISION_REQUESTED: 'domain/provision.requested',
  VERIFICATION_REQUESTED: 'domain/verification.requested',
  VERIFICATION_COMPLETED: 'domain/verification.completed',
} as const;

export const INBOUND_EVENT = {
  MESSAGE_RECEIVED: 'inbound/message.received',
} as const;

export const PROVIDER_EVENT = {
  WEBHOOK_RECEIVED: 'provider/webhook.received',
} as const;

export const MIGRATION_EVENT = {
  ATLAS_START: 'migration/atlas.start',
  ATLAS_CONVERSATION: 'migration/atlas.conversation',
  ATLAS_WEBHOOK_RECEIVED: 'migration/atlas.webhook.received',
} as const;

// IMPORTANT: Atlas credentials (apiKey, baseUrl) are NOT in these event
// payloads. Inngest persists event history with full payloads; secrets in
// payloads = secrets in their dashboard forever. Functions re-read them from
// migration_run inside step.run instead. See atlas-start.ts and
// atlas-conversation.ts.
export const migrationAtlasStartDataSchema = z.object({
  runId: z.string().min(1),
  workspaceID: z.string().min(1),
});

export const migrationAtlasConversationDataSchema = z.object({
  runId: z.string().min(1),
  workspaceID: z.string().min(1),
  conversationId: z.string().min(1),
});

export const migrationAtlasWebhookReceivedDataSchema = z.object({
  inboxId: z.string().min(1),
  workspaceID: z.string().min(1),
});

export const deliveryMessageRequestedDataSchema = z.object({
  workspaceID: z.string().min(1),
  channelID: z.string().min(1),
  ticketID: z.string().min(1),
  messageID: z.string().min(1),
  customerID: z.string().min(1).optional(),
  outboundMessageID: z.string().min(1).optional(),
  attempt: z.number().int().nonnegative().default(0),
});

export const deliveryMessageSentDataSchema = z.object({
  workspaceID: z.string().min(1),
  channelID: z.string().min(1),
  messageID: z.string().min(1),
  providerMessageID: z.string().min(1),
  outboundMessageID: z.string().min(1).optional(),
});

export const deliveryMessageDeliveredDataSchema = z.object({
  workspaceID: z.string().min(1),
  channelID: z.string().min(1),
  providerMessageID: z.string().min(1),
  deliveredAt: z.string().datetime().optional(),
});

export const deliveryMessageBouncedDataSchema = z.object({
  workspaceID: z.string().min(1),
  channelID: z.string().min(1),
  providerMessageID: z.string().min(1),
  hard: z.boolean(),
  recipient: z.string().email().optional(),
  code: z.string().optional(),
});

export const deliveryMessageComplainedDataSchema = z.object({
  workspaceID: z.string().min(1),
  channelID: z.string().min(1),
  providerMessageID: z.string().min(1),
  recipient: z.string().email().optional(),
});

export const deliveryMessageFailedDataSchema = z.object({
  workspaceID: z.string().min(1).optional(),
  channelID: z.string().min(1).optional(),
  messageID: z.string().min(1),
  outboundMessageID: z.string().min(1).optional(),
  error: z.string().min(1),
  errorCode: z.string().min(1).optional(),
});

export const domainVerificationRequestedDataSchema = z.object({
  workspaceID: z.string().min(1),
  sendingDomainID: z.string().min(1),
});

export const domainProvisionRequestedDataSchema = z.object({
  workspaceID: z.string().min(1),
  sendingDomainID: z.string().min(1),
});

export const domainVerificationCompletedDataSchema = z.object({
  workspaceID: z.string().min(1),
  sendingDomainID: z.string().min(1),
  status: z.enum(['pending', 'verified', 'failed']),
});

export const inboundMessageReceivedDataSchema = z.object({
  workspaceID: z.string().min(1),
  channelID: z.string().min(1),
  rawID: z.string().min(1),
  providerMessageID: z.string().min(1),
});

export const providerWebhookReceivedDataSchema = z.object({
  webhookEventID: z.string().min(1),
  source: z.string().min(1),
});

export const inngestEventSchemas = {
  [DELIVERY_EVENT.MESSAGE_REQUESTED]: z.object({ data: deliveryMessageRequestedDataSchema }),
  [DELIVERY_EVENT.MESSAGE_SENT]: z.object({ data: deliveryMessageSentDataSchema }),
  [DELIVERY_EVENT.MESSAGE_DELIVERED]: z.object({ data: deliveryMessageDeliveredDataSchema }),
  [DELIVERY_EVENT.MESSAGE_BOUNCED]: z.object({ data: deliveryMessageBouncedDataSchema }),
  [DELIVERY_EVENT.MESSAGE_COMPLAINED]: z.object({ data: deliveryMessageComplainedDataSchema }),
  [DELIVERY_EVENT.MESSAGE_FAILED]: z.object({ data: deliveryMessageFailedDataSchema }),
  [DOMAIN_EVENT.PROVISION_REQUESTED]: z.object({
    data: domainProvisionRequestedDataSchema,
  }),
  [DOMAIN_EVENT.VERIFICATION_REQUESTED]: z.object({
    data: domainVerificationRequestedDataSchema,
  }),
  [DOMAIN_EVENT.VERIFICATION_COMPLETED]: z.object({
    data: domainVerificationCompletedDataSchema,
  }),
  [INBOUND_EVENT.MESSAGE_RECEIVED]: z.object({ data: inboundMessageReceivedDataSchema }),
  [PROVIDER_EVENT.WEBHOOK_RECEIVED]: z.object({ data: providerWebhookReceivedDataSchema }),
  [MIGRATION_EVENT.ATLAS_START]: z.object({ data: migrationAtlasStartDataSchema }),
  [MIGRATION_EVENT.ATLAS_CONVERSATION]: z.object({ data: migrationAtlasConversationDataSchema }),
  [MIGRATION_EVENT.ATLAS_WEBHOOK_RECEIVED]: z.object({
    data: migrationAtlasWebhookReceivedDataSchema,
  }),
} as const;
