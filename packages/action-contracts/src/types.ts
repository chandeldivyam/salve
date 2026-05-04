import type { z } from 'zod';
import type { Scope } from './scopes.js';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type IdempotencyPolicy = 'required' | 'optional' | 'none';

export interface ActionContract<I extends z.ZodTypeAny, O extends z.ZodTypeAny> {
  id: string;
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

export type AnyActionContract = ActionContract<z.ZodTypeAny, z.ZodTypeAny>;

export type ActionInput<C> = C extends ActionContract<infer I, z.ZodTypeAny> ? z.infer<I> : never;

export type ActionOutput<C> = C extends ActionContract<z.ZodTypeAny, infer O> ? z.infer<O> : never;

export function defineAction<I extends z.ZodTypeAny, O extends z.ZodTypeAny>(
  contract: ActionContract<I, O>,
): ActionContract<I, O> {
  return contract;
}
