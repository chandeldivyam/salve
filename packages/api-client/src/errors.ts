export type SalveApiErrorType =
  | 'validation_error'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'rate_limited'
  | 'internal_error';

export interface SalveApiErrorArgs {
  type: SalveApiErrorType;
  code: string;
  message: string;
  status: number;
  field?: string;
  requestId?: string;
  cause?: unknown;
}

export class SalveApiError extends Error {
  readonly type: SalveApiErrorType;
  readonly code: string;
  readonly status: number;
  readonly field: string | undefined;
  readonly requestId: string;
  override readonly cause: unknown;

  constructor(args: SalveApiErrorArgs) {
    super(args.message);
    this.name = 'SalveApiError';
    this.type = args.type;
    this.code = args.code;
    this.status = args.status;
    this.field = args.field;
    this.requestId = args.requestId ?? '';
    this.cause = args.cause;
  }
}

export function isSalveApiError(error: unknown): error is SalveApiError {
  return error instanceof SalveApiError;
}
