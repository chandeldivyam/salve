// OpenAPI 3.1 document built from the action contracts. Every action's input
// and output schema is rendered to JSON Schema via Zod's built-in
// `z.toJSONSchema` (Zod v4 native, draft 2020-12), then deduplicated into
// `components.schemas` so a single shape isn't inlined four times across
// related operations.
//
// The builder is pure — it takes contracts in and returns a JSON object out.
// No runtime IO. The Hono handler wraps this for `/v1/openapi.json`.

import { z } from 'zod';
import type { AnyActionContract, HttpMethod } from './types.js';

type JsonSchemaObject = Record<string, unknown>;
type JsonObject = Record<string, unknown>;

export interface OpenApiOptions {
  title?: string;
  version?: string;
  description?: string;
  serverUrl?: string;
}

const METHODS_WITH_BODY = new Set<HttpMethod>(['POST', 'PUT', 'PATCH']);

const JSON_SCHEMA_DIALECT = 'https://spec.openapis.org/oas/3.1/dialect/base';

// Shared error envelope — every error response on the API has this shape.
// Documenting it once and `$ref`-ing keeps clients honest.
const ERROR_ENVELOPE_SCHEMA: JsonSchemaObject = {
  type: 'object',
  required: ['error'],
  properties: {
    error: {
      type: 'object',
      required: ['type', 'code', 'message', 'requestId'],
      properties: {
        type: {
          type: 'string',
          enum: [
            'validation_error',
            'unauthorized',
            'forbidden',
            'not_found',
            'conflict',
            'rate_limited',
            'internal_error',
          ],
        },
        code: {
          type: 'string',
          description: 'Stable machine-readable code (e.g. `auth.scope_missing`).',
        },
        message: { type: 'string' },
        field: {
          type: 'string',
          description: 'Optional pointer to the offending input field for `validation_error`.',
        },
        requestId: { type: 'string', description: 'Echo of the `X-Request-Id` header.' },
      },
    },
  },
};

// Per-status response set we attach to every operation. The shape is the
// same envelope; only descriptions and codes differ. Generated lazily so
// the `components.schemas.ErrorEnvelope` ref resolves correctly.
function buildErrorResponses(action: AnyActionContract): JsonObject {
  const errorRef = { $ref: '#/components/schemas/ErrorEnvelope' };
  const json = (description: string) => ({
    description,
    content: { 'application/json': { schema: errorRef } },
  });

  const responses: JsonObject = {
    '400': json('Validation error.'),
    '401': json('Missing or invalid bearer token.'),
    '403': json('Missing required scope or workspace not active.'),
    '404': json('Resource not found.'),
    '500': json('Internal server error.'),
  };
  if (action.idempotency !== 'none') {
    responses['409'] = json('Idempotency-Key conflict (in-flight or different request body).');
  }
  return responses;
}

interface SchemaRegistry {
  components: Record<string, JsonSchemaObject>;
  refFor: (name: string, schema: z.ZodTypeAny) => JsonSchemaObject;
}

function createSchemaRegistry(): SchemaRegistry {
  const components: Record<string, JsonSchemaObject> = { ErrorEnvelope: ERROR_ENVELOPE_SCHEMA };

  const refFor = (name: string, schema: z.ZodTypeAny): JsonSchemaObject => {
    if (!components[name]) {
      // `z.toJSONSchema` returns draft 2020-12; we rewrite refs at insertion
      // time so referenced sub-schemas (e.g. `ticketCustomerSchema`) live
      // alongside ours under `components.schemas/`.
      components[name] = inlineToJsonSchema(schema);
    }
    return { $ref: `#/components/schemas/${name}` };
  };

  return { components, refFor };
}

function inlineToJsonSchema(schema: z.ZodTypeAny): JsonSchemaObject {
  // Zod's `target: 'draft-2020-12'` is the default; `unrepresentable: 'any'`
  // keeps generation total even for shapes JSON Schema can't fully express
  // (e.g. branded types) — they degrade to `{}` rather than throwing.
  return z.toJSONSchema(schema, {
    unrepresentable: 'any',
    cycles: 'ref',
  }) as JsonSchemaObject;
}

export function buildOpenApiDocument(
  actions: readonly AnyActionContract[],
  opts: OpenApiOptions = {},
): JsonObject {
  const registry = createSchemaRegistry();
  const paths: JsonObject = {};

  for (const action of actions) {
    const path = toOpenApiPath(action.rest.path);
    const method = action.rest.method.toLowerCase();
    const pathItem = (paths[path] ?? {}) as JsonObject;
    pathItem[method] = operationForAction(action, registry);
    paths[path] = pathItem;
  }

  return {
    openapi: '3.1.0',
    jsonSchemaDialect: JSON_SCHEMA_DIALECT,
    info: {
      title: opts.title ?? 'Salve Public API',
      version: opts.version ?? 'v1',
      ...(opts.description ? { description: opts.description } : {}),
    },
    servers: [{ url: opts.serverUrl ?? '/v1' }],
    security: [{ bearerAuth: [] }],
    tags: tagsFromActions(actions),
    paths,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'slv_pat_… (personal access token) or slv_svc_… (service account token)',
          description:
            'All `/v1` endpoints require a workspace-scoped Salve API token. Tokens are minted in **Settings → Developer → API tokens**.',
        },
      },
      schemas: registry.components,
      headers: {
        'X-Request-Id': {
          schema: { type: 'string' },
          description: 'Echo of the `X-Request-Id` header (generated when absent).',
        },
        'Idempotency-Replayed': {
          schema: { type: 'string', enum: ['true'] },
          description:
            'Present and `true` when the response is replayed from a previously-processed `Idempotency-Key`.',
        },
      },
    },
  };
}

function operationForAction(action: AnyActionContract, registry: SchemaRegistry): JsonObject {
  const inputName = `${pascalize(action.id)}Input`;
  const outputName = `${pascalize(action.id)}Output`;

  const operation: JsonObject = {
    operationId: action.id.replaceAll('.', '_'),
    summary: action.summary,
    tags: [tagFor(action)],
    security: [{ bearerAuth: [] }],
    'x-salve-action': action.id,
    'x-salve-scopes': action.scopes,
    'x-salve-idempotency': action.idempotency,
    parameters: collectParameters(action, registry, inputName),
    responses: {
      [successStatus(action)]: {
        description: 'Action completed successfully.',
        headers: {
          'X-Request-Id': { $ref: '#/components/headers/X-Request-Id' },
          'Idempotency-Replayed': { $ref: '#/components/headers/Idempotency-Replayed' },
        },
        content: {
          'application/json': {
            schema: registry.refFor(outputName, action.outputSchema),
          },
        },
      },
      ...buildErrorResponses(action),
    },
  };

  if (METHODS_WITH_BODY.has(action.rest.method)) {
    operation.requestBody = {
      required: true,
      content: {
        'application/json': {
          schema: registry.refFor(inputName, bodySchemaForAction(action)),
        },
      },
    };
  }

  return operation;
}

function collectParameters(
  action: AnyActionContract,
  registry: SchemaRegistry,
  inputName: string,
): JsonObject[] {
  const params: JsonObject[] = [];

  for (const name of action.rest.pathParams ?? []) {
    params.push({
      name,
      in: 'path',
      required: true,
      schema: { type: 'string', minLength: 1 },
    });
  }

  if (action.rest.method === 'GET') {
    // GETs render their input as query params. We document each leaf
    // property by inlining its schema fragment from the registered input
    // shape (so `?limit=` carries `type: integer, minimum: 1, maximum: 200`
    // instead of just `type: string`).
    const inputSchema = registry.components[inputName] ?? inlineToJsonSchema(action.inputSchema);
    if (!registry.components[inputName]) registry.components[inputName] = inputSchema;
    const props = (inputSchema.properties ?? {}) as Record<string, JsonSchemaObject>;
    const required = new Set((inputSchema.required ?? []) as string[]);
    for (const [name, schema] of Object.entries(props)) {
      // Path params already captured above — skip the duplicate.
      if ((action.rest.pathParams ?? []).includes(name)) continue;
      params.push({
        name,
        in: 'query',
        required: required.has(name),
        schema,
      });
    }
  }

  if (action.idempotency !== 'none') {
    params.push({
      name: 'Idempotency-Key',
      in: 'header',
      required: action.idempotency === 'required',
      schema: {
        type: 'string',
        format: 'uuid',
        description:
          'Client-generated UUID/ULID; retries with the same key + matching body return the original response (24h dedup window).',
      },
    });
  }

  return params;
}

function bodySchemaForAction(action: AnyActionContract): z.ZodTypeAny {
  // For methods with a body we strip path-param fields out of the input
  // schema so docs don't claim `ticketId` is required in the JSON body
  // when it actually comes from the URL.
  const pathParams = new Set(action.rest.pathParams ?? []);
  if (pathParams.size === 0) return action.inputSchema;
  if (!(action.inputSchema instanceof z.ZodObject)) return action.inputSchema;
  const shape = (action.inputSchema as z.ZodObject<z.ZodRawShape>).shape;
  const omitMask: Record<string, true> = {};
  for (const key of pathParams) {
    if (key in shape) omitMask[key] = true;
  }
  if (Object.keys(omitMask).length === 0) return action.inputSchema;
  return (action.inputSchema as z.ZodObject<z.ZodRawShape>).omit(
    omitMask as Parameters<typeof action.inputSchema.omit>[0],
  );
}

function successStatus(action: AnyActionContract): string {
  if (action.rest.method === 'POST' && !action.rest.path.includes(':')) return '201';
  if (action.rest.method === 'POST' && action.rest.path.endsWith('/replies')) return '201';
  if (action.rest.method === 'POST' && action.rest.path.endsWith('/notes')) return '201';
  if (action.rest.method === 'DELETE' && !action.outputSchema) return '204';
  return '200';
}

function tagFor(action: AnyActionContract): string {
  return action.id.split('.')[0] ?? 'default';
}

function tagsFromActions(actions: readonly AnyActionContract[]): JsonObject[] {
  const tags = new Set<string>();
  for (const a of actions) tags.add(tagFor(a));
  return [...tags].sort().map((name) => ({ name }));
}

function toOpenApiPath(path: string): string {
  return path.replaceAll(/:([A-Za-z0-9_]+)/g, '{$1}');
}

function pascalize(actionID: string): string {
  return actionID
    .split(/[._-]/)
    .map((part) => (part ? part[0]?.toUpperCase() + part.slice(1) : ''))
    .join('');
}
