import {
  ACTION_BY_ID,
  type ActionID,
  type ActionInput,
  type ActionOutput,
  ALL_ACTIONS,
  type AnyActionContract,
  customerActions,
  metaActions,
  settingsActions,
  ticketActions,
  viewActions,
} from '@salve/action-contracts';
import { SalveApiError } from './errors.js';
import {
  buildActionRequest,
  createIdempotencyKey,
  errorFromResponse,
  idempotencyKeyFor,
  isRetryableStatus,
  mergeAbortSignals,
  normalizeBaseUrl,
  normalizeRetryOptions,
  type RetryOptions,
  readJsonResponse,
  retryDelayMs,
  type SalveFetch,
  type SalveRequestOptions,
  sleep,
} from './fetch.js';
import { paginate } from './pagination.js';

export const DEFAULT_BASE_URL = 'https://api.usesalve.com';

type ActionByID<ID extends ActionID> = Extract<(typeof ALL_ACTIONS)[number], { id: ID }>;
type ActionCallerMap = {
  [ID in ActionID]: (
    input: ActionInput<ActionByID<ID>>,
    options?: SalveRequestOptions,
  ) => Promise<ActionOutput<ActionByID<ID>>>;
};
type Input<C extends AnyActionContract> = ActionInput<C>;
type Output<C extends AnyActionContract> = ActionOutput<C>;
type BodyInput<C extends AnyActionContract, K extends keyof Input<C>> = Omit<Input<C>, K>;
type TicketID = Input<typeof ticketActions.get>['ticketId'];
type CustomerID = Input<typeof customerActions.get>['customerId'];
type ViewID = Input<typeof viewActions.get>['viewId'];

export const ACTION_METHOD_PATHS = {
  'tickets.list': ['tickets', 'list'],
  'tickets.get': ['tickets', 'get'],
  'tickets.create': ['tickets', 'create'],
  'tickets.update': ['tickets', 'update'],
  'tickets.assign': ['tickets', 'assign'],
  'tickets.snooze': ['tickets', 'snooze'],
  'tickets.markInProgress': ['tickets', 'markInProgress'],
  'tickets.resolve': ['tickets', 'resolve'],
  'tickets.close': ['tickets', 'close'],
  'tickets.reopen': ['tickets', 'reopen'],
  'tickets.reply': ['tickets', 'reply'],
  'tickets.note': ['tickets', 'note'],
  'tickets.message.update': ['tickets', 'message', 'update'],
  'tickets.message.delete': ['tickets', 'message', 'delete'],
  'tickets.tags.add': ['tickets', 'tags', 'add'],
  'tickets.tags.replace': ['tickets', 'tags', 'replace'],
  'tickets.tags.remove': ['tickets', 'tags', 'remove'],
  'tickets.customField.set': ['tickets', 'customField', 'set'],
  'customers.list': ['customers', 'list'],
  'customers.get': ['customers', 'get'],
  'customers.update': ['customers', 'update'],
  'customers.notes.create': ['customers', 'notes', 'create'],
  'customers.notes.update': ['customers', 'notes', 'update'],
  'customers.notes.delete': ['customers', 'notes', 'delete'],
  'customers.tags.add': ['customers', 'tags', 'add'],
  'customers.tags.remove': ['customers', 'tags', 'remove'],
  'customers.events.ingest': ['customers', 'events', 'ingest'],
  'customers.customField.set': ['customers', 'customField', 'set'],
  'views.list': ['views', 'list'],
  'views.get': ['views', 'get'],
  'views.create': ['views', 'create'],
  'views.update': ['views', 'update'],
  'views.delete': ['views', 'delete'],
  'views.tickets': ['views', 'tickets'],
  'settings.tags.list': ['settings', 'tags', 'list'],
  'settings.tags.create': ['settings', 'tags', 'create'],
  'settings.tags.update': ['settings', 'tags', 'update'],
  'settings.tags.archive': ['settings', 'tags', 'archive'],
  'settings.tagGroups.create': ['settings', 'tagGroups', 'create'],
  'settings.tagGroups.update': ['settings', 'tagGroups', 'update'],
  'settings.tagGroups.archive': ['settings', 'tagGroups', 'archive'],
  'settings.tagGroups.restore': ['settings', 'tagGroups', 'restore'],
  'settings.customFields.list': ['settings', 'customFields', 'list'],
  'settings.customFields.create': ['settings', 'customFields', 'create'],
  'settings.customFields.update': ['settings', 'customFields', 'update'],
  'settings.customFields.archive': ['settings', 'customFields', 'archive'],
  'settings.email.domains.create': ['settings', 'email', 'domains', 'create'],
  'settings.email.addresses.create': ['settings', 'email', 'addresses', 'create'],
  'settings.email.routingRules.upsert': ['settings', 'email', 'routingRules', 'upsert'],
  'settings.apiTokens.list': ['settings', 'apiTokens', 'list'],
  'settings.apiTokens.create': ['settings', 'apiTokens', 'create'],
  'settings.apiTokens.revoke': ['settings', 'apiTokens', 'revoke'],
  whoami: ['whoami'],
  'workspace.list': ['workspace', 'list'],
} as const satisfies Record<ActionID, readonly string[]>;

export interface SalveClientOptions {
  token?: string;
  baseUrl?: string;
  workspaceId?: string;
  fetch?: SalveFetch;
  timeoutMs?: number;
  retry?: RetryOptions;
}

export interface SalveRequestEvent {
  actionId: ActionID | 'raw';
  method: string;
  url: string;
  attempt: number;
  idempotencyKey?: string;
}

export interface SalveResponseEvent extends SalveRequestEvent {
  status: number;
  requestId: string;
}

export interface SalveErrorEvent extends SalveRequestEvent {
  error: unknown;
}

export interface SalveEventMap {
  request: SalveRequestEvent;
  response: SalveResponseEvent;
  error: SalveErrorEvent;
}

export type SalveEventName = keyof SalveEventMap;
export type SalveEventPayload<K extends SalveEventName> = SalveEventMap[K];

export class SalveClient {
  readonly actions: ActionCallerMap;
  readonly tickets;
  readonly customers;
  readonly views;
  readonly settings;
  readonly workspace;

  #baseUrl: string;
  #pathPrefix: string;
  #token: string;
  #workspaceId: string | undefined;
  #fetch: SalveFetch;
  #timeoutMs: number;
  #retry: Required<RetryOptions>;
  #listeners: { [K in SalveEventName]: Set<(event: SalveEventMap[K]) => void> };

  constructor(options: SalveClientOptions = {}) {
    const token = options.token ?? readTokenFromEnv();
    if (!token) {
      throw new Error('SalveClient requires a token or SALVE_TOKEN environment variable');
    }

    const normalized = normalizeBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL);
    this.#baseUrl = normalized.baseUrl;
    this.#pathPrefix = normalized.pathPrefix;
    this.#token = token;
    this.#workspaceId = options.workspaceId;
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#timeoutMs = options.timeoutMs ?? 30_000;
    this.#retry = normalizeRetryOptions(options.retry);
    this.#listeners = {
      request: new Set(),
      response: new Set(),
      error: new Set(),
    };

    this.actions = Object.fromEntries(
      ALL_ACTIONS.map((action) => [
        action.id,
        (input: ActionInput<typeof action>, requestOptions?: SalveRequestOptions) =>
          this.request(action, input, requestOptions),
      ]),
    ) as ActionCallerMap;

    this.tickets = this.#buildTicketsNamespace();
    this.customers = this.#buildCustomersNamespace();
    this.views = this.#buildViewsNamespace();
    this.settings = this.#buildSettingsNamespace();
    this.workspace = this.#buildWorkspaceNamespace();
  }

  on<K extends SalveEventName>(
    eventName: K,
    listener: (event: SalveEventPayload<K>) => void,
  ): () => void {
    this.#listeners[eventName].add(listener as (event: SalveEventMap[K]) => void);
    return () => this.#listeners[eventName].delete(listener as (event: SalveEventMap[K]) => void);
  }

  async action<ID extends ActionID>(
    actionId: ID,
    input: ActionInput<ActionByID<ID>>,
    options?: SalveRequestOptions,
  ): Promise<ActionOutput<ActionByID<ID>>> {
    const action = ACTION_BY_ID[actionId] as ActionByID<ID>;
    return this.request(action, input, options);
  }

  async request<C extends AnyActionContract>(
    contract: C,
    input: ActionInput<C>,
    options?: SalveRequestOptions,
  ): Promise<ActionOutput<C>> {
    const parsedInput = contract.inputSchema.parse(input) as ActionInput<C>;
    const request = buildActionRequest({
      baseUrl: this.#baseUrl,
      pathPrefix: this.#pathPrefix,
      contract,
      input: parsedInput,
    });
    const idempotencyKey = idempotencyKeyFor(contract.idempotency, options);
    const retry = normalizeRetryOptions(options?.retry ?? this.#retry);
    let lastError: unknown;

    for (let attempt = 1; attempt <= retry.maxAttempts; attempt += 1) {
      const eventBase = {
        actionId: contract.id as ActionID,
        method: request.method,
        url: request.url.toString(),
        attempt,
        idempotencyKey,
      };
      this.#emit('request', eventBase);

      const abort = mergeAbortSignals(options?.signal, options?.timeoutMs ?? this.#timeoutMs);
      try {
        const response = await this.#fetch(request.url, {
          method: request.method,
          headers: this.#headers(request.body, idempotencyKey, options?.headers),
          body: request.body,
          signal: abort.signal,
        });
        const responseEvent = {
          ...eventBase,
          status: response.status,
          requestId: response.headers.get('x-request-id') ?? '',
        };
        this.#emit('response', responseEvent);

        if (isRetryableStatus(response.status) && attempt < retry.maxAttempts) {
          // Drain the response body before retrying. Without this, undici
          // keeps the connection open until GC and large 5xx pages
          // (e.g. an HTML gateway error) sit in memory until the next
          // attempt completes.
          await response.body?.cancel().catch(() => undefined);
          await sleep(retryDelayMs(attempt, retry));
          continue;
        }

        const json = await readJsonResponse(response);
        if (!response.ok) throw errorFromResponse(response, json);

        try {
          return contract.outputSchema.parse(json) as ActionOutput<C>;
        } catch (error) {
          throw new SalveApiError({
            type: 'internal_error',
            code: 'response.schema_invalid',
            message: `Salve API response did not match ${contract.id} output schema`,
            status: response.status,
            requestId: response.headers.get('x-request-id') ?? '',
            cause: error,
          });
        }
      } catch (error) {
        lastError = timeoutOrAbortError(error, abort.timedOut());
        if (lastError instanceof SalveApiError) {
          this.#emit('error', { ...eventBase, error: lastError });
          throw lastError;
        }
        if (attempt < retry.maxAttempts) {
          await sleep(retryDelayMs(attempt, retry));
          continue;
        }
        const apiError = new SalveApiError({
          type: 'internal_error',
          code: 'request.failed',
          message: 'Salve API request failed',
          status: 0,
          cause: lastError,
        });
        this.#emit('error', { ...eventBase, error: apiError });
        throw apiError;
      } finally {
        abort.cleanup();
      }
    }

    throw lastError;
  }

  async raw(
    method: string,
    path: string,
    body?: unknown,
    options?: SalveRequestOptions,
  ): Promise<unknown> {
    const normalizedMethod = method.toUpperCase();
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const url = new URL(`${this.#baseUrl}${this.#pathPrefix}${normalizedPath}`);
    const requestBody =
      body === undefined || normalizedMethod === 'GET' ? undefined : JSON.stringify(body);
    const retry = normalizeRetryOptions(options?.retry ?? this.#retry);
    const idempotencyKey =
      options?.idempotencyKey ?? (normalizedMethod === 'GET' ? undefined : createIdempotencyKey());
    let lastError: unknown;

    for (let attempt = 1; attempt <= retry.maxAttempts; attempt += 1) {
      const eventBase = {
        actionId: 'raw' as const,
        method: normalizedMethod,
        url: url.toString(),
        attempt,
        idempotencyKey,
      };
      this.#emit('request', eventBase);
      const abort = mergeAbortSignals(options?.signal, options?.timeoutMs ?? this.#timeoutMs);
      try {
        const response = await this.#fetch(url, {
          method: normalizedMethod,
          headers: this.#headers(requestBody, idempotencyKey, options?.headers),
          body: requestBody,
          signal: abort.signal,
        });
        this.#emit('response', {
          ...eventBase,
          status: response.status,
          requestId: response.headers.get('x-request-id') ?? '',
        });
        if (isRetryableStatus(response.status) && attempt < retry.maxAttempts) {
          await sleep(retryDelayMs(attempt, retry));
          continue;
        }
        const json = await readJsonResponse(response);
        if (!response.ok) throw errorFromResponse(response, json);
        return json;
      } catch (error) {
        lastError = timeoutOrAbortError(error, abort.timedOut());
        if (lastError instanceof SalveApiError) {
          this.#emit('error', { ...eventBase, error: lastError });
          throw lastError;
        }
        if (attempt < retry.maxAttempts) {
          await sleep(retryDelayMs(attempt, retry));
          continue;
        }
        const apiError = new SalveApiError({
          type: 'internal_error',
          code: 'request.failed',
          message: 'Salve API request failed',
          status: 0,
          cause: lastError,
        });
        this.#emit('error', { ...eventBase, error: apiError });
        throw apiError;
      } finally {
        abort.cleanup();
      }
    }

    throw lastError;
  }

  #headers(
    body: string | undefined,
    idempotencyKey: string | undefined,
    extraHeaders: HeadersInit | undefined,
  ): Headers {
    const headers = new Headers(extraHeaders);
    headers.set('Accept', 'application/json');
    headers.set('Authorization', `Bearer ${this.#token}`);
    // Note: workspace switching via header is intentionally not supported.
    // The token's referenceId is the source of truth for workspace; sending
    // a header would be silently ignored by `/v1` (server doesn't read it),
    // which is misleading. `salve workspace use` is informational only.
    if (idempotencyKey) headers.set('Idempotency-Key', idempotencyKey);
    if (body !== undefined && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    return headers;
  }

  #emit<K extends SalveEventName>(eventName: K, event: SalveEventMap[K]): void {
    for (const listener of this.#listeners[eventName]) {
      listener(event);
    }
  }

  #buildTicketsNamespace() {
    return {
      list: (
        input: Input<typeof ticketActions.list> = {},
        options?: SalveRequestOptions,
      ): Promise<Output<typeof ticketActions.list>> =>
        this.request(ticketActions.list, input, options),
      listAll: (input: Input<typeof ticketActions.list> = {}, options?: SalveRequestOptions) =>
        paginate(input, (next) => this.request(ticketActions.list, next, options)),
      get: (
        ticketId: TicketID,
        options?: SalveRequestOptions,
      ): Promise<Output<typeof ticketActions.get>> =>
        this.request(ticketActions.get, { ticketId }, options),
      create: (
        input: Input<typeof ticketActions.create>,
        options?: SalveRequestOptions,
      ): Promise<Output<typeof ticketActions.create>> =>
        this.request(ticketActions.create, input, options),
      update: (
        ticketId: TicketID,
        input: BodyInput<typeof ticketActions.update, 'ticketId'>,
        options?: SalveRequestOptions,
      ): Promise<Output<typeof ticketActions.update>> =>
        this.request(ticketActions.update, { ...input, ticketId }, options),
      assign: (
        ticketId: TicketID,
        input: BodyInput<typeof ticketActions.assign, 'ticketId'>,
        options?: SalveRequestOptions,
      ): Promise<Output<typeof ticketActions.assign>> =>
        this.request(ticketActions.assign, { ...input, ticketId }, options),
      snooze: (
        ticketId: TicketID,
        input: BodyInput<typeof ticketActions.snooze, 'ticketId'>,
        options?: SalveRequestOptions,
      ): Promise<Output<typeof ticketActions.snooze>> =>
        this.request(ticketActions.snooze, { ...input, ticketId }, options),
      markInProgress: (
        ticketId: TicketID,
        options?: SalveRequestOptions,
      ): Promise<Output<typeof ticketActions.markInProgress>> =>
        this.request(ticketActions.markInProgress, { ticketId }, options),
      resolve: (
        ticketId: TicketID,
        options?: SalveRequestOptions,
      ): Promise<Output<typeof ticketActions.resolve>> =>
        this.request(ticketActions.resolve, { ticketId }, options),
      close: (
        ticketId: TicketID,
        options?: SalveRequestOptions,
      ): Promise<Output<typeof ticketActions.close>> =>
        this.request(ticketActions.close, { ticketId }, options),
      reopen: (
        ticketId: TicketID,
        options?: SalveRequestOptions,
      ): Promise<Output<typeof ticketActions.reopen>> =>
        this.request(ticketActions.reopen, { ticketId }, options),
      reply: (
        ticketId: TicketID,
        input: BodyInput<typeof ticketActions.reply, 'ticketId'>,
        options?: SalveRequestOptions,
      ): Promise<Output<typeof ticketActions.reply>> =>
        this.request(ticketActions.reply, { ...input, ticketId }, options),
      note: (
        ticketId: TicketID,
        input: BodyInput<typeof ticketActions.note, 'ticketId'>,
        options?: SalveRequestOptions,
      ): Promise<Output<typeof ticketActions.note>> =>
        this.request(ticketActions.note, { ...input, ticketId }, options),
      message: {
        update: (
          ticketId: TicketID,
          messageId: Input<typeof ticketActions.messageUpdate>['messageId'],
          input: BodyInput<typeof ticketActions.messageUpdate, 'ticketId' | 'messageId'>,
          options?: SalveRequestOptions,
        ): Promise<Output<typeof ticketActions.messageUpdate>> =>
          this.request(ticketActions.messageUpdate, { ...input, ticketId, messageId }, options),
        delete: (
          ticketId: TicketID,
          messageId: Input<typeof ticketActions.messageDelete>['messageId'],
          options?: SalveRequestOptions,
        ): Promise<Output<typeof ticketActions.messageDelete>> =>
          this.request(ticketActions.messageDelete, { ticketId, messageId }, options),
      },
      tags: {
        add: (
          ticketId: TicketID,
          input: BodyInput<typeof ticketActions.tagsAdd, 'ticketId'>,
          options?: SalveRequestOptions,
        ): Promise<Output<typeof ticketActions.tagsAdd>> =>
          this.request(ticketActions.tagsAdd, { ...input, ticketId }, options),
        replace: (
          ticketId: TicketID,
          input: BodyInput<typeof ticketActions.tagsReplace, 'ticketId'>,
          options?: SalveRequestOptions,
        ): Promise<Output<typeof ticketActions.tagsReplace>> =>
          this.request(ticketActions.tagsReplace, { ...input, ticketId }, options),
        remove: (
          ticketId: TicketID,
          tagId: Input<typeof ticketActions.tagsRemove>['tagId'],
          options?: SalveRequestOptions,
        ): Promise<Output<typeof ticketActions.tagsRemove>> =>
          this.request(ticketActions.tagsRemove, { ticketId, tagId }, options),
      },
      customField: {
        set: (
          ticketId: TicketID,
          fieldKey: Input<typeof ticketActions.customFieldSet>['fieldKey'],
          value: Input<typeof ticketActions.customFieldSet>['value'],
          options?: SalveRequestOptions,
        ): Promise<Output<typeof ticketActions.customFieldSet>> =>
          this.request(ticketActions.customFieldSet, { ticketId, fieldKey, value }, options),
      },
    };
  }

  #buildCustomersNamespace() {
    return {
      list: (
        input: Input<typeof customerActions.list> = {},
        options?: SalveRequestOptions,
      ): Promise<Output<typeof customerActions.list>> =>
        this.request(customerActions.list, input, options),
      listAll: (input: Input<typeof customerActions.list> = {}, options?: SalveRequestOptions) =>
        paginate(input, (next) => this.request(customerActions.list, next, options)),
      get: (
        customerId: CustomerID,
        options?: SalveRequestOptions,
      ): Promise<Output<typeof customerActions.get>> =>
        this.request(customerActions.get, { customerId }, options),
      update: (
        customerId: CustomerID,
        input: BodyInput<typeof customerActions.update, 'customerId'>,
        options?: SalveRequestOptions,
      ): Promise<Output<typeof customerActions.update>> =>
        this.request(customerActions.update, { ...input, customerId }, options),
      notes: {
        create: (
          customerId: CustomerID,
          input: BodyInput<typeof customerActions.notesCreate, 'customerId'>,
          options?: SalveRequestOptions,
        ): Promise<Output<typeof customerActions.notesCreate>> =>
          this.request(customerActions.notesCreate, { ...input, customerId }, options),
        update: (
          noteId: Input<typeof customerActions.notesUpdate>['noteId'],
          input: BodyInput<typeof customerActions.notesUpdate, 'noteId'>,
          options?: SalveRequestOptions,
        ): Promise<Output<typeof customerActions.notesUpdate>> =>
          this.request(customerActions.notesUpdate, { ...input, noteId }, options),
        delete: (
          noteId: Input<typeof customerActions.notesDelete>['noteId'],
          options?: SalveRequestOptions,
        ): Promise<Output<typeof customerActions.notesDelete>> =>
          this.request(customerActions.notesDelete, { noteId }, options),
      },
      tags: {
        add: (
          customerId: CustomerID,
          input: BodyInput<typeof customerActions.tagsAdd, 'customerId'>,
          options?: SalveRequestOptions,
        ): Promise<Output<typeof customerActions.tagsAdd>> =>
          this.request(customerActions.tagsAdd, { ...input, customerId }, options),
        remove: (
          customerId: CustomerID,
          tagId: Input<typeof customerActions.tagsRemove>['tagId'],
          options?: SalveRequestOptions,
        ): Promise<Output<typeof customerActions.tagsRemove>> =>
          this.request(customerActions.tagsRemove, { customerId, tagId }, options),
      },
      events: {
        ingest: (
          customerId: CustomerID,
          input: BodyInput<typeof customerActions.eventsIngest, 'customerId'>,
          options?: SalveRequestOptions,
        ): Promise<Output<typeof customerActions.eventsIngest>> =>
          this.request(customerActions.eventsIngest, { ...input, customerId }, options),
      },
      customField: {
        set: (
          customerId: CustomerID,
          fieldKey: Input<typeof customerActions.customFieldSet>['fieldKey'],
          value: Input<typeof customerActions.customFieldSet>['value'],
          options?: SalveRequestOptions,
        ): Promise<Output<typeof customerActions.customFieldSet>> =>
          this.request(customerActions.customFieldSet, { customerId, fieldKey, value }, options),
      },
    };
  }

  #buildViewsNamespace() {
    return {
      list: (
        input: Input<typeof viewActions.list> = {},
        options?: SalveRequestOptions,
      ): Promise<Output<typeof viewActions.list>> => this.request(viewActions.list, input, options),
      get: (
        viewId: ViewID,
        options?: SalveRequestOptions,
      ): Promise<Output<typeof viewActions.get>> =>
        this.request(viewActions.get, { viewId }, options),
      create: (
        input: Input<typeof viewActions.create>,
        options?: SalveRequestOptions,
      ): Promise<Output<typeof viewActions.create>> =>
        this.request(viewActions.create, input, options),
      update: (
        viewId: ViewID,
        input: BodyInput<typeof viewActions.update, 'viewId'>,
        options?: SalveRequestOptions,
      ): Promise<Output<typeof viewActions.update>> =>
        this.request(viewActions.update, { ...input, viewId }, options),
      delete: (
        viewId: ViewID,
        options?: SalveRequestOptions,
      ): Promise<Output<typeof viewActions.delete>> =>
        this.request(viewActions.delete, { viewId }, options),
      tickets: (
        viewId: ViewID,
        input: BodyInput<typeof viewActions.tickets, 'viewId'> = {},
        options?: SalveRequestOptions,
      ): Promise<Output<typeof viewActions.tickets>> =>
        this.request(viewActions.tickets, { ...input, viewId }, options),
      ticketsAll: (
        viewId: ViewID,
        input: BodyInput<typeof viewActions.tickets, 'viewId'> = {},
        options?: SalveRequestOptions,
      ) =>
        paginate({ ...input, viewId }, (next) => this.request(viewActions.tickets, next, options)),
    };
  }

  #buildSettingsNamespace() {
    return {
      tags: {
        list: (
          input: Input<typeof settingsActions.tagsList> = {},
          options?: SalveRequestOptions,
        ): Promise<Output<typeof settingsActions.tagsList>> =>
          this.request(settingsActions.tagsList, input, options),
        create: (
          input: Input<typeof settingsActions.tagsCreate>,
          options?: SalveRequestOptions,
        ): Promise<Output<typeof settingsActions.tagsCreate>> =>
          this.request(settingsActions.tagsCreate, input, options),
        update: (
          tagId: Input<typeof settingsActions.tagsUpdate>['tagId'],
          input: BodyInput<typeof settingsActions.tagsUpdate, 'tagId'>,
          options?: SalveRequestOptions,
        ): Promise<Output<typeof settingsActions.tagsUpdate>> =>
          this.request(settingsActions.tagsUpdate, { ...input, tagId }, options),
        archive: (
          tagId: Input<typeof settingsActions.tagsArchive>['tagId'],
          options?: SalveRequestOptions,
        ): Promise<Output<typeof settingsActions.tagsArchive>> =>
          this.request(settingsActions.tagsArchive, { tagId }, options),
      },
      tagGroups: {
        create: (
          input: Input<typeof settingsActions.tagGroupsCreate>,
          options?: SalveRequestOptions,
        ): Promise<Output<typeof settingsActions.tagGroupsCreate>> =>
          this.request(settingsActions.tagGroupsCreate, input, options),
        update: (
          groupId: Input<typeof settingsActions.tagGroupsUpdate>['groupId'],
          input: BodyInput<typeof settingsActions.tagGroupsUpdate, 'groupId'>,
          options?: SalveRequestOptions,
        ): Promise<Output<typeof settingsActions.tagGroupsUpdate>> =>
          this.request(settingsActions.tagGroupsUpdate, { ...input, groupId }, options),
        archive: (
          groupId: Input<typeof settingsActions.tagGroupsArchive>['groupId'],
          options?: SalveRequestOptions,
        ): Promise<Output<typeof settingsActions.tagGroupsArchive>> =>
          this.request(settingsActions.tagGroupsArchive, { groupId }, options),
        restore: (
          groupId: Input<typeof settingsActions.tagGroupsRestore>['groupId'],
          options?: SalveRequestOptions,
        ): Promise<Output<typeof settingsActions.tagGroupsRestore>> =>
          this.request(settingsActions.tagGroupsRestore, { groupId }, options),
      },
      customFields: {
        list: (
          input: Input<typeof settingsActions.customFieldsList> = {},
          options?: SalveRequestOptions,
        ): Promise<Output<typeof settingsActions.customFieldsList>> =>
          this.request(settingsActions.customFieldsList, input, options),
        create: (
          input: Input<typeof settingsActions.customFieldsCreate>,
          options?: SalveRequestOptions,
        ): Promise<Output<typeof settingsActions.customFieldsCreate>> =>
          this.request(settingsActions.customFieldsCreate, input, options),
        update: (
          customFieldId: Input<typeof settingsActions.customFieldsUpdate>['customFieldId'],
          input: BodyInput<typeof settingsActions.customFieldsUpdate, 'customFieldId'>,
          options?: SalveRequestOptions,
        ): Promise<Output<typeof settingsActions.customFieldsUpdate>> =>
          this.request(settingsActions.customFieldsUpdate, { ...input, customFieldId }, options),
        archive: (
          customFieldId: Input<typeof settingsActions.customFieldsArchive>['customFieldId'],
          options?: SalveRequestOptions,
        ): Promise<Output<typeof settingsActions.customFieldsArchive>> =>
          this.request(settingsActions.customFieldsArchive, { customFieldId }, options),
      },
      email: {
        domains: {
          create: (
            input: Input<typeof settingsActions.emailDomainsCreate>,
            options?: SalveRequestOptions,
          ): Promise<Output<typeof settingsActions.emailDomainsCreate>> =>
            this.request(settingsActions.emailDomainsCreate, input, options),
        },
        addresses: {
          create: (
            sendingDomainId: Input<typeof settingsActions.emailAddressesCreate>['sendingDomainId'],
            input: BodyInput<typeof settingsActions.emailAddressesCreate, 'sendingDomainId'>,
            options?: SalveRequestOptions,
          ): Promise<Output<typeof settingsActions.emailAddressesCreate>> =>
            this.request(
              settingsActions.emailAddressesCreate,
              { ...input, sendingDomainId },
              options,
            ),
        },
        routingRules: {
          upsert: (
            channelId: Input<typeof settingsActions.emailRoutingRulesUpsert>['channelId'],
            input: BodyInput<typeof settingsActions.emailRoutingRulesUpsert, 'channelId'>,
            options?: SalveRequestOptions,
          ): Promise<Output<typeof settingsActions.emailRoutingRulesUpsert>> =>
            this.request(settingsActions.emailRoutingRulesUpsert, { ...input, channelId }, options),
        },
      },
      apiTokens: {
        list: (
          options?: SalveRequestOptions,
        ): Promise<Output<typeof settingsActions.apiTokensList>> =>
          this.request(settingsActions.apiTokensList, {}, options),
        create: (
          input: Input<typeof settingsActions.apiTokensCreate>,
          options?: SalveRequestOptions,
        ): Promise<Output<typeof settingsActions.apiTokensCreate>> =>
          this.request(settingsActions.apiTokensCreate, input, options),
        revoke: (
          tokenId: Input<typeof settingsActions.apiTokensRevoke>['tokenId'],
          options?: SalveRequestOptions,
        ): Promise<Output<typeof settingsActions.apiTokensRevoke>> =>
          this.request(settingsActions.apiTokensRevoke, { tokenId }, options),
      },
    };
  }

  #buildWorkspaceNamespace() {
    return {
      list: (options?: SalveRequestOptions): Promise<Output<typeof metaActions.workspacesList>> =>
        this.request(metaActions.workspacesList, {}, options),
    };
  }

  whoami(options?: SalveRequestOptions): Promise<Output<typeof metaActions.whoami>> {
    return this.request(metaActions.whoami, {}, options);
  }
}

function readTokenFromEnv(): string | undefined {
  return process.env.SALVE_TOKEN;
}

function timeoutOrAbortError(error: unknown, timedOut: boolean): unknown {
  if (!timedOut) return error;
  return new SalveApiError({
    type: 'internal_error',
    code: 'request.timeout',
    message: 'Salve API request timed out',
    status: 0,
    cause: error,
  });
}
