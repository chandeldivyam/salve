import {
  type ActionInput,
  type AnyActionContract,
  ticketActions,
} from '@opendesk/action-contracts';
import {
  addTicketTagsExecutor,
  assignTicketExecutor,
  closeTicketExecutor,
  createTicketExecutor,
  deleteMessageExecutor,
  type Executor,
  type ExecutorAuth,
  type ExecutorCtx,
  getTicketExecutor,
  listTicketsExecutor,
  markTicketInProgressExecutor,
  noteExecutor,
  parseTicketListQuery,
  removeTicketTagExecutor,
  reopenTicketExecutor,
  replaceTicketTagsExecutor,
  replyExecutor,
  resolveTicketExecutor,
  setTicketCustomFieldExecutor,
  snoozeTicketExecutor,
  updateMessageExecutor,
  updateTicketExecutor,
} from '@opendesk/action-executor';
import { getDb } from '@opendesk/db';
import { type Context, Hono } from 'hono';
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

export const ticketsRouter = new Hono();

ticketsRouter.get(
  '/',
  ...actionMiddlewares(ticketActions.list),
  actionHandler(ticketActions.list, listTicketsExecutor, (c) =>
    parseTicketListQuery({
      limit: c.req.query('limit'),
      cursor: c.req.query('cursor'),
      status: c.req.query('status'),
      assigneeId: c.req.query('assigneeId'),
      customerId: c.req.query('customerId'),
    }),
  ),
);

ticketsRouter.post(
  '/',
  ...actionMiddlewares(ticketActions.create),
  actionHandler(ticketActions.create, createTicketExecutor, (c) => readJsonBody(c), 201),
);

ticketsRouter.get(
  '/:ticketId',
  ...actionMiddlewares(ticketActions.get),
  actionHandler(ticketActions.get, getTicketExecutor, (c) => ({
    ticketId: c.req.param('ticketId'),
  })),
);

ticketsRouter.patch(
  '/:ticketId',
  ...actionMiddlewares(ticketActions.update),
  actionHandler(ticketActions.update, updateTicketExecutor, async (c) => ({
    ...(await readJsonBody(c)),
    ticketId: c.req.param('ticketId'),
  })),
);

ticketsRouter.post(
  '/:ticketId/assign',
  ...actionMiddlewares(ticketActions.assign),
  actionHandler(ticketActions.assign, assignTicketExecutor, async (c) => ({
    ...(await readJsonBody(c)),
    ticketId: c.req.param('ticketId'),
  })),
);

ticketsRouter.post(
  '/:ticketId/snooze',
  ...actionMiddlewares(ticketActions.snooze),
  actionHandler(ticketActions.snooze, snoozeTicketExecutor, async (c) => ({
    ...(await readJsonBody(c)),
    ticketId: c.req.param('ticketId'),
  })),
);

ticketsRouter.post(
  '/:ticketId/in-progress',
  ...actionMiddlewares(ticketActions.markInProgress),
  actionHandler(ticketActions.markInProgress, markTicketInProgressExecutor, (c) => ({
    ticketId: c.req.param('ticketId'),
  })),
);

ticketsRouter.post(
  '/:ticketId/resolve',
  ...actionMiddlewares(ticketActions.resolve),
  actionHandler(ticketActions.resolve, resolveTicketExecutor, (c) => ({
    ticketId: c.req.param('ticketId'),
  })),
);

ticketsRouter.post(
  '/:ticketId/close',
  ...actionMiddlewares(ticketActions.close),
  actionHandler(ticketActions.close, closeTicketExecutor, (c) => ({
    ticketId: c.req.param('ticketId'),
  })),
);

ticketsRouter.post(
  '/:ticketId/reopen',
  ...actionMiddlewares(ticketActions.reopen),
  actionHandler(ticketActions.reopen, reopenTicketExecutor, (c) => ({
    ticketId: c.req.param('ticketId'),
  })),
);

ticketsRouter.post(
  '/:ticketId/replies',
  ...actionMiddlewares(ticketActions.reply),
  actionHandler(
    ticketActions.reply,
    replyExecutor,
    async (c) => ({
      ...(await readJsonBody(c)),
      ticketId: c.req.param('ticketId'),
    }),
    201,
  ),
);

ticketsRouter.post(
  '/:ticketId/notes',
  ...actionMiddlewares(ticketActions.note),
  actionHandler(
    ticketActions.note,
    noteExecutor,
    async (c) => ({
      ...(await readJsonBody(c)),
      ticketId: c.req.param('ticketId'),
    }),
    201,
  ),
);

ticketsRouter.patch(
  '/:ticketId/messages/:messageId',
  ...actionMiddlewares(ticketActions.messageUpdate),
  actionHandler(ticketActions.messageUpdate, updateMessageExecutor, async (c) => ({
    ...(await readJsonBody(c)),
    ticketId: c.req.param('ticketId'),
    messageId: c.req.param('messageId'),
  })),
);

ticketsRouter.delete(
  '/:ticketId/messages/:messageId',
  ...actionMiddlewares(ticketActions.messageDelete),
  actionHandler(ticketActions.messageDelete, deleteMessageExecutor, (c) => ({
    ticketId: c.req.param('ticketId'),
    messageId: c.req.param('messageId'),
  })),
);

ticketsRouter.post(
  '/:ticketId/tags',
  ...actionMiddlewares(ticketActions.tagsAdd),
  actionHandler(ticketActions.tagsAdd, addTicketTagsExecutor, async (c) => ({
    ...(await readJsonBody(c)),
    ticketId: c.req.param('ticketId'),
  })),
);

ticketsRouter.put(
  '/:ticketId/tags',
  ...actionMiddlewares(ticketActions.tagsReplace),
  actionHandler(ticketActions.tagsReplace, replaceTicketTagsExecutor, async (c) => ({
    ...(await readJsonBody(c)),
    ticketId: c.req.param('ticketId'),
  })),
);

ticketsRouter.delete(
  '/:ticketId/tags/:tagId',
  ...actionMiddlewares(ticketActions.tagsRemove),
  actionHandler(ticketActions.tagsRemove, removeTicketTagExecutor, (c) => ({
    ticketId: c.req.param('ticketId'),
    tagId: c.req.param('tagId'),
  })),
);

ticketsRouter.put(
  '/:ticketId/custom-fields/:fieldKey',
  ...actionMiddlewares(ticketActions.customFieldSet),
  actionHandler(ticketActions.customFieldSet, setTicketCustomFieldExecutor, async (c) => ({
    ...(await readJsonBody(c)),
    ticketId: c.req.param('ticketId'),
    fieldKey: c.req.param('fieldKey'),
  })),
);

function actionMiddlewares(contract: AnyActionContract) {
  return [
    requestIDMiddleware,
    idempotencyKeyMiddleware(contract.idempotency),
    requireBearerAuth,
    requireApiScopes(contract.scopes),
  ] as const;
}

function actionHandler<C extends AnyActionContract>(
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

function createExecutorCtx(
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

async function readJsonBody(c: Context): Promise<Record<string, unknown>> {
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

function zodValidationResponse(c: Context, error: z.ZodError): Response {
  const issue = error.issues[0];
  return publicErrorResponse(c, {
    status: 400,
    type: 'validation_error',
    code: 'request.invalid',
    message: issue?.message ?? 'Request is invalid',
    field: issue?.path.join('.'),
  });
}
