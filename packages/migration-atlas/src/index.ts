export type {
  CanonicalAttachmentRef,
  CanonicalCustomer,
  CanonicalCustomFieldDef,
  CanonicalMessage,
  CanonicalTag,
  CanonicalTagGroup,
  CanonicalTicket,
  SalveCustomFieldCategory,
  SalveCustomFieldType,
} from './canonical.js';
export {
  coerceCustomFieldValue,
  mapPriority,
  mapStatus,
  syntheticEmail,
  toCanonicalCustomer,
  toCanonicalCustomFieldDef,
  toCanonicalMessage,
  toCanonicalTag,
  toCanonicalTagGroup,
  toCanonicalTicket,
} from './canonical.js';
export type {
  AtlasConversation,
  AtlasCustomer,
  AtlasCustomField,
  AtlasListResponse,
  AtlasMessage,
  AtlasTag,
  AtlasTagGroup,
  AtlasWebhookSubscription,
} from './client.js';
export { AtlasApiError, AtlasClient } from './client.js';
export type {
  AtlasWebhookConversation,
  AtlasWebhookCustomer,
  AtlasWebhookEvent,
  AtlasWebhookMessage,
  ParsedAtlasWebhookEvent,
} from './webhook.js';
export {
  ATLAS_WEBHOOK_EVENTS,
  AtlasWebhookParseError,
  PHASE_4A_EVENTS,
  parseAtlasWebhookEvent,
  parseAtlasWebhookPayload,
  verifyAtlasSignature,
} from './webhook.js';
