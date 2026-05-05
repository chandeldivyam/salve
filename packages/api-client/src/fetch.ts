import type { ActionInput, AnyActionContract } from '@opendesk/action-contracts';
import { SalveApiError, type SalveApiErrorType } from './errors.js';

export type SalveFetch = typeof fetch;

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

export interface NormalizedRetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export interface SalveRequestOptions {
  idempotencyKey?: string;
  headers?: HeadersInit;
  signal?: AbortSignal;
  timeoutMs?: number;
  retry?: RetryOptions;
}

export interface BuiltActionRequest {
  method: string;
  url: URL;
  body: string | undefined;
}

export interface ParsedErrorEnvelope {
  error?: {
    type?: string;
    code?: string;
    message?: string;
    field?: string;
    requestId?: string;
  };
}

export function normalizeBaseUrl(baseUrl: string): { baseUrl: string; pathPrefix: string } {
  const url = new URL(baseUrl);
  const normalized = url.toString().replace(/\/$/, '');
  const pathPrefix = url.pathname.replace(/\/$/, '').endsWith('/v1') ? '' : '/v1';
  return { baseUrl: normalized, pathPrefix };
}

export function normalizeRetryOptions(retry: RetryOptions | undefined): NormalizedRetryOptions {
  return {
    maxAttempts: retry?.maxAttempts ?? 3,
    baseDelayMs: retry?.baseDelayMs ?? 250,
    maxDelayMs: retry?.maxDelayMs ?? 5_000,
  };
}

export function buildActionRequest<C extends AnyActionContract>(args: {
  baseUrl: string;
  pathPrefix: string;
  contract: C;
  input: ActionInput<C>;
}): BuiltActionRequest {
  const input = recordFromInput(args.input);
  const pathParams = args.contract.rest.pathParams ?? [];
  let path = args.contract.rest.path;

  for (const param of pathParams) {
    const value = input[param];
    if (value == null) {
      throw new TypeError(`Missing required path parameter: ${param}`);
    }
    path = path.replace(`:${param}`, encodeURIComponent(String(value)));
  }

  const payload = omitKeys(input, pathParams);
  const url = new URL(`${args.baseUrl}${args.pathPrefix}${path}`);

  if (args.contract.rest.method === 'GET') {
    appendQuery(url, payload);
    return { method: args.contract.rest.method, url, body: undefined };
  }

  const body = Object.keys(payload).length > 0 ? JSON.stringify(payload) : undefined;
  return { method: args.contract.rest.method, url, body };
}

export function createIdempotencyKey(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    const value = char === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

export function idempotencyKeyFor(
  policy: AnyActionContract['idempotency'],
  options: SalveRequestOptions | undefined,
): string | undefined {
  if (options?.idempotencyKey) return options.idempotencyKey;
  if (policy === 'none') return undefined;
  return createIdempotencyKey();
}

export function retryDelayMs(attempt: number, retry: NormalizedRetryOptions): number {
  const exponential = retry.baseDelayMs * 2 ** Math.max(0, attempt - 1);
  const capped = Math.min(exponential, retry.maxDelayMs);
  return Math.floor(Math.random() * (capped + 1));
}

export function isRetryableStatus(status: number): boolean {
  return status >= 500 && status <= 599;
}

export async function readJsonResponse(response: Response): Promise<unknown> {
  if (response.status === 204) return {};

  const text = await response.text();
  if (!text.trim()) return {};

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new SalveApiError({
      type: 'internal_error',
      code: 'response.invalid_json',
      message: 'Salve API returned invalid JSON',
      status: response.status,
      requestId: response.headers.get('x-request-id') ?? '',
      cause: error,
    });
  }
}

export function errorFromResponse(response: Response, body: unknown): SalveApiError {
  const envelope = body as ParsedErrorEnvelope;
  const error = envelope.error;
  const type = isErrorType(error?.type) ? error.type : errorTypeForStatus(response.status);
  const requestId = error?.requestId ?? response.headers.get('x-request-id') ?? '';

  return new SalveApiError({
    type,
    code: error?.code ?? defaultCodeForStatus(response.status),
    message: error?.message ?? (response.statusText || 'Salve API request failed'),
    status: response.status,
    field: error?.field,
    requestId,
  });
}

export function mergeAbortSignals(
  userSignal: AbortSignal | undefined,
  timeoutMs: number | undefined,
): { signal: AbortSignal; cleanup: () => void; timedOut: () => boolean } {
  const controller = new AbortController();
  let timeoutID: ReturnType<typeof setTimeout> | undefined;
  let didTimeout = false;

  const abortFromUser = () => controller.abort(userSignal?.reason);
  if (userSignal?.aborted) abortFromUser();
  else userSignal?.addEventListener('abort', abortFromUser, { once: true });

  if (timeoutMs && timeoutMs > 0) {
    timeoutID = setTimeout(() => {
      didTimeout = true;
      controller.abort(new DOMException('Request timed out', 'TimeoutError'));
    }, timeoutMs);
  }

  return {
    signal: controller.signal,
    timedOut: () => didTimeout,
    cleanup: () => {
      if (timeoutID) clearTimeout(timeoutID);
      userSignal?.removeEventListener('abort', abortFromUser);
    },
  };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function recordFromInput(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  return input as Record<string, unknown>;
}

function omitKeys(
  input: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> {
  const omitted = new Set(keys);
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!omitted.has(key) && value !== undefined) output[key] = value;
  }
  return output;
}

function appendQuery(url: URL, query: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(key, String(item));
      continue;
    }
    url.searchParams.set(key, String(value));
  }
}

function isErrorType(value: string | undefined): value is SalveApiErrorType {
  return (
    value === 'validation_error' ||
    value === 'unauthorized' ||
    value === 'forbidden' ||
    value === 'not_found' ||
    value === 'conflict' ||
    value === 'rate_limited' ||
    value === 'internal_error'
  );
}

function errorTypeForStatus(status: number): SalveApiErrorType {
  if (status === 400) return 'validation_error';
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 429) return 'rate_limited';
  return 'internal_error';
}

function defaultCodeForStatus(status: number): string {
  if (status === 401) return 'auth.required';
  if (status === 403) return 'auth.forbidden';
  if (status === 404) return 'resource.not_found';
  if (status === 409) return 'request.conflict';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'internal_error';
  return 'request.failed';
}
