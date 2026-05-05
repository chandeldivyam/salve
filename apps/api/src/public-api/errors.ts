import { ActionExecutorError } from '@salve/action-executor';
import { MutationError, MutationErrorCode } from '@salve/mutators';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { ZodError } from 'zod';

export type PublicApiErrorType =
  | 'validation_error'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'internal_error';

export class PublicApiError extends Error {
  readonly status: ContentfulStatusCode;
  readonly type: PublicApiErrorType;
  readonly code: string;
  readonly field: string | undefined;

  constructor(args: {
    status: ContentfulStatusCode;
    type: PublicApiErrorType;
    code: string;
    message: string;
    field?: string;
  }) {
    super(args.message);
    this.name = 'PublicApiError';
    this.status = args.status;
    this.type = args.type;
    this.code = args.code;
    this.field = args.field;
  }
}

export function publicErrorResponse(
  c: Context,
  args: {
    status: ContentfulStatusCode;
    type: PublicApiErrorType;
    code: string;
    message: string;
    field?: string;
  },
): Response {
  return c.json(
    {
      error: {
        type: args.type,
        code: args.code,
        message: args.message,
        ...(args.field ? { field: args.field } : {}),
        requestId: c.get('requestID'),
      },
    },
    args.status,
  );
}

export function handlePublicApiError(c: Context, error: unknown): Response {
  if (error instanceof PublicApiError) {
    return publicErrorResponse(c, {
      status: error.status,
      type: error.type,
      code: error.code,
      message: error.message,
      field: error.field,
    });
  }

  if (error instanceof ActionExecutorError) {
    return publicErrorResponse(c, {
      status: error.status as ContentfulStatusCode,
      type: error.type,
      code: error.code,
      message: error.message,
      field: error.field,
    });
  }

  if (error instanceof MutationError) {
    return mutationErrorResponse(c, error);
  }

  if (error instanceof ZodError) {
    const issue = error.issues[0];
    return publicErrorResponse(c, {
      status: 400,
      type: 'validation_error',
      code: 'request.invalid',
      message: issue?.message ?? 'Request is invalid',
      field: issue?.path.join('.'),
    });
  }

  console.error('[salve-api] public api error', error);
  return publicErrorResponse(c, {
    status: 500,
    type: 'internal_error',
    code: 'internal_error',
    message: 'Internal server error',
  });
}

function mutationErrorResponse(c: Context, error: MutationError): Response {
  const code = error.details.code;
  if (code === MutationErrorCode.NOT_LOGGED_IN) {
    return publicErrorResponse(c, {
      status: 401,
      type: 'unauthorized',
      code: 'auth.required',
      message: error.message,
    });
  }
  if (code === MutationErrorCode.NO_WORKSPACE || code === MutationErrorCode.NOT_AUTHORIZED) {
    return publicErrorResponse(c, {
      status: 403,
      type: 'forbidden',
      code: `mutation.${code.toLowerCase()}`,
      message: error.message,
    });
  }
  if (code === MutationErrorCode.NOT_FOUND || code === MutationErrorCode.CROSS_WORKSPACE) {
    return publicErrorResponse(c, {
      status: 404,
      type: 'not_found',
      code: 'resource.not_found',
      message: error.message,
    });
  }
  if (code === MutationErrorCode.INVALID_INPUT) {
    return publicErrorResponse(c, {
      status: 400,
      type: 'validation_error',
      code: 'mutation.invalid_input',
      message: error.message,
    });
  }

  return publicErrorResponse(c, {
    status: 500,
    type: 'internal_error',
    code: 'mutation.error',
    message: 'Mutation failed',
  });
}
