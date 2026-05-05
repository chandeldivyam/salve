// Assertion helpers — mirror zbugs's `shared/auth.ts:23-86`. The plan's
// permission model is "TS code in mutators is the security boundary", so
// EVERY mutator funnels its auth checks through one of these helpers.
//
// Functions are designed as `asserts` so the type narrows in the caller after
// the assertion runs (zbugs does the same — the trick is what makes the
// `authData.workspaceID` access typed-as-non-null inside the body).

import type { AuthData } from '@opendesk/zero-schema';
import { builder } from '@opendesk/zero-schema';
import type { Transaction } from '@rocicorp/zero';
import { MutationError, MutationErrorCode } from './error.js';

/**
 * Auth context after a workspace assertion passes — `workspaceID` is
 * guaranteed non-null. `role` may still be null on the optimistic client path
 * (the web app's `<ZeroProvider>` doesn't have access to the role; only the
 * server JWT does), so per-mutator role checks must call `isAdmin(authData)`
 * etc. explicitly.
 */
export type WorkspaceAuthData = AuthData & {
  workspaceID: string;
};

export function auditActorKind(authData: WorkspaceAuthData): 'user' | 'service_account' {
  return authData.principalKind === 'service_account' ? 'service_account' : 'user';
}

export function assertIsLoggedIn(
  authData: AuthData | undefined | null,
): asserts authData is AuthData {
  if (!authData) {
    throw new MutationError(
      'User must be logged in for this operation',
      MutationErrorCode.NOT_LOGGED_IN,
    );
  }
}

export function assertHasWorkspace(
  authData: AuthData | undefined | null,
): asserts authData is WorkspaceAuthData {
  assertIsLoggedIn(authData);
  if (!authData.workspaceID) {
    throw new MutationError('No active workspace on this session', MutationErrorCode.NO_WORKSPACE);
  }
}

/**
 * Confirm the JWT names the workspace the caller is trying to write to. Refuse
 * stale tokens (where the JWT's claim doesn't match the row's workspace). Pass
 * `targetWorkspaceID` as the workspace embedded in the payload the caller sent
 * us — for opendesk that means we never trust a `workspaceID` field on
 * `args` (callers don't supply one — we always derive it from `authData`).
 * This helper exists for the rare case we need to verify a related row's
 * workspace inside a mutator (e.g. assigning a ticket to an assignee — we check
 * the assignee's membership matches `auth.workspaceID`).
 */
export function assertActorIsAgentInWorkspace(
  authData: AuthData | undefined | null,
  targetWorkspaceID: string,
): asserts authData is WorkspaceAuthData {
  assertHasWorkspace(authData);
  if (authData.workspaceID !== targetWorkspaceID) {
    throw new MutationError('cross-workspace write blocked', MutationErrorCode.CROSS_WORKSPACE);
  }
}

/**
 * Read-side assertion: the caller is allowed to see ticket `ticketID`. We
 * re-fetch the row inside the transaction (NOT trusting any `args.workspaceID`
 * the client could have lied about) and verify same-workspace.
 *
 * For Phase 2b every authenticated agent can see every ticket in their own
 * workspace — Phase 4 will layer team/visibility scoping on top.
 *
 * Returns the ticket so callers don't need a second `.run(...)`.
 */
export async function assertCanReadTicket<TTx extends Transaction>(
  tx: TTx,
  authData: AuthData | undefined | null,
  ticketID: string,
) {
  assertHasWorkspace(authData);
  const ticket = await tx.run(builder.ticket.where('id', ticketID).one());
  if (!ticket) {
    // Generic NOT_FOUND avoids leaking existence across workspaces (zbugs
    // pattern — `assertIsCreatorOrAdmin` does the same).
    throw new MutationError('ticket not found', MutationErrorCode.NOT_FOUND, ticketID);
  }
  if (ticket.workspaceID !== authData.workspaceID) {
    // Same generic surface to the caller — distinct code internally so server
    // logs can flag the cross-workspace probe.
    throw new MutationError('ticket not found', MutationErrorCode.CROSS_WORKSPACE, ticketID);
  }
  return ticket;
}

/**
 * Write-side assertion: the caller is allowed to mutate ticket `ticketID`.
 * For Phase 2b: any agent in the ticket's workspace can modify (mirrors how
 * zbugs grants `crew` blanket write access). Phase 4 will narrow this to
 * "creator OR assignee OR admin/owner" using the same shape as zbugs's
 * `assertIsCreatorOrAdmin`.
 */
export async function assertCanModifyTicket<TTx extends Transaction>(
  tx: TTx,
  authData: AuthData | undefined | null,
  ticketID: string,
) {
  return assertCanReadTicket(tx, authData, ticketID);
}

/**
 * Read-side assertion for customer rows. Mirrors `assertCanReadTicket`: fetch
 * inside the transaction and compare the row's workspace to the JWT claim.
 */
export async function assertCanReadCustomer<TTx extends Transaction>(
  tx: TTx,
  authData: AuthData | undefined | null,
  customerID: string,
) {
  assertHasWorkspace(authData);
  const customer = await tx.run(builder.customer.where('id', customerID).one());
  if (!customer) {
    throw new MutationError('customer not found', MutationErrorCode.NOT_FOUND, customerID);
  }
  if (customer.workspaceID !== authData.workspaceID) {
    throw new MutationError('customer not found', MutationErrorCode.CROSS_WORKSPACE, customerID);
  }
  return customer;
}

/**
 * Write-side customer assertion. Any authenticated agent in the workspace can
 * edit customer metadata; later roles can narrow here.
 */
export async function assertCanModifyCustomer<TTx extends Transaction>(
  tx: TTx,
  authData: AuthData | undefined | null,
  customerID: string,
) {
  return assertCanReadCustomer(tx, authData, customerID);
}
