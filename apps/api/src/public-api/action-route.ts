import type { ActionInput, AnyActionContract } from '@opendesk/action-contracts';
import type { Executor, ExecutorAuth, ExecutorCtx } from '@opendesk/action-executor';
import { getDb } from '@opendesk/db';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { z } from 'zod';
import { authOf } from '../middleware.js';
import { handlePublicApiError, PublicApiError, publicErrorResponse } from './errors.js';
import { requireBearerAuth } from './middleware/bearer.js';
import {
  hashIdempotencyRequest,
  idempotencyKeyMiddleware,
  requestIDMiddleware,
} from './middleware/idempotency.js';
import { withIdempotency } from './middleware/idempotency-store.js';
import { requireApiScopes } from './middleware/scopes.js';
import { runServerMutation } from './mutator-runner.js';

export function actionMiddlewares(contract: AnyActionContract) {
  return [
    requestIDMiddleware,
    requireBearerAuth,
    requireApiScopes(contract.scopes),
    idempotencyKeyMiddleware(contract.idempotency),
  ] as const;
}

export function actionHandler<C extends AnyActionContract>(
  contract: C,
  executor: Executor<C>,
  extractInput: (c: Context) => unknown | Promise<unknown>,
  successStatus: ContentfulStatusCode = 200,
) {
  return async (c: Context) => {
    try {
      const rawInput = await extractInput(c);
      const parsed = contract.inputSchema.safeParse(rawInput);
      if (!parsed.success) return zodValidationResponse(c, parsed.error);

      const db = getDb();
      const auth = authOf(c);
      if (!auth.workspaceID) {
        throw new PublicApiError({
          status: 403,
          type: 'forbidden',
          code: 'auth.workspace_required',
          message: 'A workspace-scoped token is required',
        });
      }

      const idempotencyKey = c.get('idempotencyKey');
      const ctx = createExecutorCtx(c, {
        auth: {
          sub: auth.userID,
          workspaceID: auth.workspaceID,
          role: auth.role,
          principalKind: auth.principalKind,
          scopes: auth.scopes,
        },
        idempotencyKey,
      });

      const execute = async () => ({
        status: successStatus,
        body: await executor(ctx, parsed.data as ActionInput<C>),
      });

      if (contract.idempotency !== 'none' && idempotencyKey) {
        const outcome = await withIdempotency(
          {
            db,
            workspaceID: auth.workspaceID,
            actionID: contract.id,
            key: idempotencyKey,
            requestHash: hashIdempotencyRequest(contract.id, parsed.data),
          },
          execute,
        );

        if (outcome.kind === 'in_progress') {
          return publicErrorResponse(c, {
            status: 409,
            type: 'conflict',
            code: 'idempotency_key.in_progress',
            message: 'Another request with this Idempotency-Key is still in progress',
          });
        }
        if (outcome.kind === 'mismatch') {
          return publicErrorResponse(c, {
            status: 409,
            type: 'conflict',
            code: 'idempotency_key.reused_with_different_request',
            message: 'Idempotency-Key was reused with a different request',
          });
        }

        if (outcome.kind === 'replayed') c.header('Idempotency-Replayed', 'true');
        return c.json(outcome.result.body, outcome.result.status as ContentfulStatusCode);
      }

      const result = await execute();
      return c.json(result.body, result.status);
    } catch (error) {
      return handlePublicApiError(c, error);
    }
  };
}

export function createExecutorCtx(
  c: Context,
  args: { auth: ExecutorAuth; idempotencyKey: string | null },
): ExecutorCtx {
  return {
    db: getDb(),
    auth: args.auth,
    requestId: c.get('requestID'),
    idempotencyKey: args.idempotencyKey,
    runMutation: (name, mutationArgs) => runServerMutation(name, mutationArgs, args.auth),
  };
}

export async function readJsonBody(c: Context): Promise<Record<string, unknown>> {
  const text = await c.req.text();
  if (!text.trim()) return {};
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new PublicApiError({
        status: 400,
        type: 'validation_error',
        code: 'request.body_invalid',
        message: 'Request body must be a JSON object',
      });
    }
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof PublicApiError) throw error;
    throw new PublicApiError({
      status: 400,
      type: 'validation_error',
      code: 'request.json_invalid',
      message: 'Request body must be valid JSON',
    });
  }
}

export function zodValidationResponse(c: Context, error: z.ZodError): Response {
  const issue = error.issues[0];
  return publicErrorResponse(c, {
    status: 400,
    type: 'validation_error',
    code: 'request.invalid',
    message: issue?.message ?? 'Request is invalid',
    field: issue?.path.join('.'),
  });
}
