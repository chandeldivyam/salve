// Atlas (atlas.so) HTTP client. Bearer-token auth, cursor=offset pagination,
// list endpoints return { data, total, cursor, limit }. Default base host is
// `https://api.atlas.so`. Endpoints under /v1/.
//
// We deliberately model only the responses we need for the v0 migration:
// list/get conversations, list messages, get customer. Mappers in canonical.ts
// translate to the canonical DTOs the importer consumes.

import { z } from 'zod';

export class AtlasApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = 'AtlasApiError';
  }
}

// ---- Wire schemas ----

// All Atlas timestamps are epoch seconds (integers). Some fields can be null.
const epochSeconds = z.number().int().nullable().optional();

const atlasAttachmentSchema = z
  .object({
    name: z.string().nullable().optional(),
    url: z.string(),
    handle: z.string().nullable().optional(),
    size: z.number().nullable().optional(),
    contentId: z.string().nullable().optional(),
  })
  .passthrough();

const atlasAgentSchema = z
  .object({
    id: z.string().nullable().optional(),
    firstName: z.string().nullable().optional(),
    lastName: z.string().nullable().optional(),
    email: z.string().nullable().optional(),
    profileUrl: z.string().nullable().optional(),
  })
  .passthrough();

const atlasCustomerEmbeddedSchema = z
  .object({
    id: z.string(),
    externalUserId: z.string().nullable().optional(),
    accountId: z.string().nullable().optional(),
    firstName: z.string().nullable().optional(),
    lastName: z.string().nullable().optional(),
    email: z.string().nullable().optional(),
    phoneNumber: z.string().nullable().optional(),
    customFields: z.record(z.string(), z.unknown()).nullable().optional(),
    createdAt: epochSeconds,
  })
  .passthrough();

export type AtlasCustomer = z.infer<typeof atlasCustomerEmbeddedSchema>;

const atlasMessageSchema = z
  .object({
    // Atlas message IDs are integers — keep as number, stringify at the EIM boundary.
    id: z.number().int(),
    side: z.enum(['customer', 'agent', 'bot']),
    type: z.string(),
    createdAt: epochSeconds,
    sentAt: epochSeconds,
    agent: atlasAgentSchema.nullable().optional(),
    customer: atlasCustomerEmbeddedSchema.nullable().optional(),
    text: z.string().nullable().optional(),
    channel: z.string().nullable().optional(),
    attachments: z.array(atlasAttachmentSchema).default([]),
  })
  .passthrough();

export type AtlasMessage = z.infer<typeof atlasMessageSchema>;

const atlasConversationSchema = z
  .object({
    id: z.string(),
    number: z.number().int().nullable().optional(),
    customerId: z.string().nullable().optional(),
    customer: atlasCustomerEmbeddedSchema.nullable().optional(),
    subject: z.string().nullable().optional(),
    status: z.string(),
    priority: z.string().nullable().optional(),
    assignedAgent: atlasAgentSchema.nullable().optional(),
    assignedAgentId: z.string().nullable().optional(),
    tags: z
      .array(z.string())
      .nullish()
      .transform((v) => v ?? []),
    customFields: z.record(z.string(), z.unknown()).nullable().optional(),
    startedAt: epochSeconds,
    createdAt: epochSeconds,
    closedAt: epochSeconds,
    snoozedUntil: epochSeconds,
    startedChannel: z.string().nullable().optional(),
    lastMessage: atlasMessageSchema.nullable().optional(),
  })
  .passthrough();

export type AtlasConversation = z.infer<typeof atlasConversationSchema>;

// Atlas custom-field definition. Note the endpoint is /v1/custom-fields (with
// a hyphen) — /v1/custom_fields returns 404 in production.
const atlasCustomFieldSchema = z
  .object({
    id: z.string(),
    key: z.string(),
    displayName: z.string(),
    description: z.string().nullable().optional(),
    category: z.string(), // 'ticket' | 'customer' | 'account'
    type: z.string(), // 'Boolean' | 'Text' | 'Number' | 'Decimal' | 'Date' | 'List' | 'MultiSelect'
    fieldMetadata: z
      .array(z.string())
      .nullish()
      .transform((v) => v ?? []),
    required: z.boolean().default(false),
    active: z.boolean().default(true),
    editableBy: z
      .array(z.string())
      .nullish()
      .transform((v) => v ?? []),
    defaultValue: z.unknown().nullable().optional(),
  })
  .passthrough();

export type AtlasCustomField = z.infer<typeof atlasCustomFieldSchema>;

const atlasTagGroupSchema = z
  .object({
    id: z.string(),
    label: z.string(),
    color: z.string().nullable().optional(),
    archived: z.boolean().default(false),
  })
  .passthrough();

export type AtlasTagGroup = z.infer<typeof atlasTagGroupSchema>;

const atlasTagSchema = z
  .object({
    id: z.string(),
    label: z.string(),
    groupId: z.string().nullable().optional(),
    archived: z.boolean().default(false),
    used: z.number().int().nullable().optional(),
  })
  .passthrough();

export type AtlasTag = z.infer<typeof atlasTagSchema>;

const atlasWebhookSubscriptionSchema = z
  .object({
    id: z.string(),
    event: z.string(),
    endpoint: z.string(),
    signing_secret: z.string().optional(),
    signingSecret: z.string().optional(),
    status: z.string().optional(),
  })
  .passthrough()
  .transform((v) => ({
    id: v.id,
    event: v.event,
    endpoint: v.endpoint,
    signingSecret: v.signing_secret ?? v.signingSecret ?? '',
    status: v.status ?? 'ACTIVE',
  }));

export type AtlasWebhookSubscription = z.infer<typeof atlasWebhookSubscriptionSchema>;

const listResponseSchema = <T extends z.ZodTypeAny>(item: T) =>
  z
    .object({
      data: z.array(item),
      total: z.number().int(),
      cursor: z.number().int(),
      limit: z.number().int(),
    })
    .passthrough();

export type AtlasListResponse<T> = {
  data: T[];
  total: number;
  cursor: number;
  limit: number;
};

// ---- Client ----

export interface AtlasClientOptions {
  apiKey: string;
  baseUrl?: string;
  /** Caller-supplied fetch (so callers can wrap with rate limiting / retry). */
  fetchImpl?: typeof fetch;
  /** Request timeout per call, ms. */
  timeoutMs?: number;
}

export class AtlasClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(opts: AtlasClientOptions) {
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? 'https://api.atlas.so').replace(/\/+$/, '');
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
  }

  async listConversations(
    params: {
      cursor?: number;
      limit?: number;
      status?: string;
      startDate?: Date;
      endDate?: Date;
    } = {},
  ): Promise<AtlasListResponse<AtlasConversation>> {
    const qs = new URLSearchParams();
    qs.set('cursor', String(params.cursor ?? 0));
    qs.set('limit', String(params.limit ?? 20));
    if (params.status) qs.set('status', params.status);
    if (params.startDate) qs.set('start_date', params.startDate.toISOString());
    if (params.endDate) qs.set('end_date', params.endDate.toISOString());
    const json = await this.get(`/v1/conversations?${qs.toString()}`);
    return listResponseSchema(atlasConversationSchema).parse(json);
  }

  async getConversation(id: string): Promise<AtlasConversation> {
    const json = await this.get(`/v1/conversations/${encodeURIComponent(id)}`);
    return atlasConversationSchema.parse(json);
  }

  async listMessages(
    conversationId: string,
    params: { cursor?: number; limit?: number } = {},
  ): Promise<AtlasListResponse<AtlasMessage>> {
    const qs = new URLSearchParams();
    qs.set('cursor', String(params.cursor ?? 0));
    qs.set('limit', String(params.limit ?? 100));
    const json = await this.get(
      `/v1/conversations/${encodeURIComponent(conversationId)}/messages?${qs.toString()}`,
    );
    return listResponseSchema(atlasMessageSchema).parse(json);
  }

  async listCustomFields(
    params: { cursor?: number; limit?: number; category?: string } = {},
  ): Promise<AtlasListResponse<AtlasCustomField>> {
    const qs = new URLSearchParams();
    qs.set('cursor', String(params.cursor ?? 0));
    qs.set('limit', String(params.limit ?? 100));
    if (params.category) qs.set('category', params.category);
    const json = await this.get(`/v1/custom-fields?${qs.toString()}`);
    return listResponseSchema(atlasCustomFieldSchema).parse(json);
  }

  /** Pull every custom-field definition. ~50–100 fields total in practice. */
  async listAllCustomFields(): Promise<AtlasCustomField[]> {
    const all: AtlasCustomField[] = [];
    let cursor = 0;
    const limit = 100;
    for (let i = 0; i < 20; i++) {
      const page = await this.listCustomFields({ cursor, limit });
      all.push(...page.data);
      if (page.data.length < limit) break;
      cursor += page.data.length;
      if (cursor >= page.total) break;
    }
    return all;
  }

  async listTagGroups(
    params: { cursor?: number; limit?: number } = {},
  ): Promise<AtlasListResponse<AtlasTagGroup>> {
    const qs = new URLSearchParams();
    qs.set('cursor', String(params.cursor ?? 0));
    qs.set('limit', String(params.limit ?? 100));
    const json = await this.get(`/v1/tag-groups?${qs.toString()}`);
    return listResponseSchema(atlasTagGroupSchema).parse(json);
  }

  async listAllTagGroups(): Promise<AtlasTagGroup[]> {
    const all: AtlasTagGroup[] = [];
    let cursor = 0;
    const limit = 100;
    for (let i = 0; i < 50; i++) {
      const page = await this.listTagGroups({ cursor, limit });
      all.push(...page.data);
      if (page.data.length < limit) break;
      cursor += page.data.length;
      if (cursor >= page.total) break;
    }
    return all;
  }

  async listTags(
    params: { cursor?: number; limit?: number } = {},
  ): Promise<AtlasListResponse<AtlasTag>> {
    const qs = new URLSearchParams();
    qs.set('cursor', String(params.cursor ?? 0));
    qs.set('limit', String(params.limit ?? 100));
    const json = await this.get(`/v1/tags?${qs.toString()}`);
    return listResponseSchema(atlasTagSchema).parse(json);
  }

  async listAllTags(): Promise<AtlasTag[]> {
    const all: AtlasTag[] = [];
    let cursor = 0;
    const limit = 100;
    // 438 tags observed; 100 iterations × 100 = 10k cap is plenty.
    for (let i = 0; i < 100; i++) {
      const page = await this.listTags({ cursor, limit });
      all.push(...page.data);
      if (page.data.length < limit) break;
      cursor += page.data.length;
      if (cursor >= page.total) break;
    }
    return all;
  }

  // ---- Webhooks (subscription management) ----

  /**
   * Subscribe to one Atlas event. Atlas's model is one-event-per-subscription
   * (`webhooks/external/routes/webhooks.py:54-79`). On 409 (duplicate) we
   * surface the standard AtlasApiError so the caller can show a sane error.
   *
   * `signing_secret` is returned ONCE here and never retrievable later — the
   * caller MUST persist it before returning.
   */
  async createWebhookSubscription(params: {
    event: string;
    endpoint: string;
  }): Promise<AtlasWebhookSubscription> {
    const json = await this.json('POST', '/v1/webhooks', {
      event: params.event,
      endpoint: params.endpoint,
    });
    return atlasWebhookSubscriptionSchema.parse(json);
  }

  async updateWebhookSubscription(
    id: string,
    body: { endpoint?: string; status?: 'ACTIVE' | 'INACTIVE' },
  ): Promise<AtlasWebhookSubscription> {
    const json = await this.json('POST', `/v1/webhooks/${encodeURIComponent(id)}`, body);
    return atlasWebhookSubscriptionSchema.parse(json);
  }

  /** Pull all messages for a conversation, paging until exhausted. */
  async listAllMessages(conversationId: string): Promise<AtlasMessage[]> {
    const all: AtlasMessage[] = [];
    let cursor = 0;
    const limit = 100;
    // Defensive cap: 50 pages × 100 messages = 5000 messages per ticket.
    for (let i = 0; i < 50; i++) {
      const page = await this.listMessages(conversationId, { cursor, limit });
      all.push(...page.data);
      if (page.data.length < limit) break;
      cursor += page.data.length;
      if (cursor >= page.total) break;
    }
    return all;
  }

  // ---- HTTP plumbing ----

  private async get(path: string): Promise<unknown> {
    const url = `${this.baseUrl}${path}`;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(url, {
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          accept: 'application/json',
        },
        signal: ac.signal,
      });
      const text = await res.text();
      if (!res.ok) {
        let body: unknown = text;
        try {
          body = JSON.parse(text);
        } catch {
          // keep raw text
        }
        throw new AtlasApiError(
          `Atlas ${res.status} ${res.statusText} on GET ${path}`,
          res.status,
          body,
        );
      }
      return text ? JSON.parse(text) : null;
    } finally {
      clearTimeout(timer);
    }
  }

  /** POST/DELETE/etc with optional JSON body. Returns the parsed JSON response. */
  private async json(
    method: 'POST' | 'DELETE' | 'PATCH' | 'PUT',
    path: string,
    body?: unknown,
  ): Promise<unknown> {
    return this.send(method, path, body);
  }

  private async send(
    method: 'POST' | 'DELETE' | 'PATCH' | 'PUT',
    path: string,
    body?: unknown,
  ): Promise<unknown> {
    const url = `${this.baseUrl}${path}`;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.timeoutMs);
    try {
      const headers: Record<string, string> = {
        authorization: `Bearer ${this.apiKey}`,
        accept: 'application/json',
      };
      let serialized: string | undefined;
      if (body !== undefined) {
        headers['content-type'] = 'application/json';
        serialized = JSON.stringify(body);
      }
      const res = await this.fetchImpl(url, {
        method,
        headers,
        body: serialized,
        signal: ac.signal,
      });
      const text = await res.text();
      if (!res.ok) {
        let parsed: unknown = text;
        try {
          parsed = JSON.parse(text);
        } catch {
          // keep raw text
        }
        throw new AtlasApiError(
          `Atlas ${res.status} ${res.statusText} on ${method} ${path}`,
          res.status,
          parsed,
        );
      }
      return text ? JSON.parse(text) : null;
    } finally {
      clearTimeout(timer);
    }
  }
}
