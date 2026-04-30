// Mutator-side error type — mirrors zbugs's `shared/error.ts:13-24`. Uses
// Zero's `ApplicationError` so the framework propagates the error verbatim
// from the server-side replay back to the optimistic client (and the client's
// promise rejects with the same `code`/`id` payload).
//
// Codes intentionally match the failure modes the assertions in `auth.ts`
// throw plus a few generic ones for input validation / missing rows.

import { ApplicationError } from '@rocicorp/zero';

export const MutationErrorCode = {
  /** No JWT / unauthenticated request. */
  NOT_LOGGED_IN: 'NOT_LOGGED_IN',
  /** Authenticated but no active workspace claim on the JWT. */
  NO_WORKSPACE: 'NO_WORKSPACE',
  /** Authenticated, has workspace, but the action is forbidden (role / ownership). */
  NOT_AUTHORIZED: 'NOT_AUTHORIZED',
  /** Generic "row by id not found" — also returned for cross-workspace reads
   *  to avoid leaking existence (matches zbugs's pattern). */
  NOT_FOUND: 'NOT_FOUND',
  /** Zod failed before the mutator body even ran. */
  INVALID_INPUT: 'INVALID_INPUT',
  /** Caller tried to write into a workspace that isn't theirs. Distinguished
   *  from NOT_AUTHORIZED so the API server can log it as a security event. */
  CROSS_WORKSPACE: 'CROSS_WORKSPACE',
} as const;

export type MutationErrorCode = (typeof MutationErrorCode)[keyof typeof MutationErrorCode];

/**
 * Thrown by mutators / assertion helpers. The `details` payload travels
 * verbatim from server → client through Zero's mutation protocol; consumers
 * narrow on `code`.
 */
export class MutationError<
  const T extends MutationErrorCode = MutationErrorCode,
> extends ApplicationError<{
  code: T;
  id: string | undefined;
}> {
  constructor(message: string, code: T, id?: string) {
    super(message, {
      details: { code, id },
    });
  }
}
