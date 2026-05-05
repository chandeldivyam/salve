import type { z } from 'zod';
import type { Scope } from './scopes.js';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type IdempotencyPolicy = 'required' | 'optional' | 'none';

export interface ActionContract<
  I extends z.ZodTypeAny,
  O extends z.ZodTypeAny,
  ID extends string = string,
> {
  id: ID;
  summary: string;
  inputSchema: I;
  outputSchema: O;
  scopes: readonly Scope[];
  idempotency: IdempotencyPolicy;
  auditEventKind?: string;
  rest: {
    method: HttpMethod;
    path: string;
    pathParams?: readonly string[];
    // HTTP success status. Defaults to 200; set to 201 for creates that return
    // a fresh resource, 204 for ops with empty bodies. Drives both the route
    // handler's response code and the OpenAPI doc — keep them in lock-step.
    successStatus?: 200 | 201 | 204;
    // Whether the request carries a JSON body. Defaults to true for non-GET.
    // Status routes (POST /tickets/:id/close) carry only path params and set
    // this to false so OpenAPI does not declare a required body schema.
    hasBody?: boolean;
  };
  cli?: {
    command: readonly string[];
    positionals?: readonly string[];
    examples?: readonly string[];
  };
  mcp?: {
    toolName: string;
    destructive?: boolean;
    composite?: boolean;
  };
}

export type AnyActionContract = ActionContract<z.ZodTypeAny, z.ZodTypeAny, string>;

export type ActionInput<C> =
  C extends ActionContract<infer I, z.ZodTypeAny, string> ? z.infer<I> : never;

export type ActionOutput<C> =
  C extends ActionContract<z.ZodTypeAny, infer O, string> ? z.infer<O> : never;

export function defineAction<
  const ID extends string,
  I extends z.ZodTypeAny,
  O extends z.ZodTypeAny,
>(contract: ActionContract<I, O, ID>): ActionContract<I, O, ID> {
  return contract;
}
