export type PublicErrorType =
  | 'validation_error'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'internal_error';

export class ActionExecutorError extends Error {
  readonly status: number;
  readonly type: PublicErrorType;
  readonly code: string;
  readonly field: string | undefined;

  constructor(args: {
    status: number;
    type: PublicErrorType;
    code: string;
    message: string;
    field?: string;
  }) {
    super(args.message);
    this.name = 'ActionExecutorError';
    this.status = args.status;
    this.type = args.type;
    this.code = args.code;
    this.field = args.field;
  }
}

export function validationError(
  code: string,
  message: string,
  field?: string,
): ActionExecutorError {
  return new ActionExecutorError({
    status: 400,
    type: 'validation_error',
    code,
    message,
    field,
  });
}

export function notFound(code: string, message: string): ActionExecutorError {
  return new ActionExecutorError({
    status: 404,
    type: 'not_found',
    code,
    message,
  });
}
