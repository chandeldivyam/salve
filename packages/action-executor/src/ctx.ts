import type {
  ActionInput,
  ActionOutput,
  AnyActionContract,
  Scope,
} from '@opendesk/action-contracts';
import type { Database } from '@opendesk/db';

export type ExecutorRole = 'owner' | 'admin' | 'agent' | null;
export type ExecutorPrincipalKind = 'user' | 'service_account';

export interface ExecutorAuth {
  sub: string;
  workspaceID: string;
  role: ExecutorRole;
  principalKind: ExecutorPrincipalKind;
  // Bearer-token scopes if the caller authenticated via PAT/service-account.
  // Undefined for cookie-authenticated callers (the dashboard). Executors that
  // need to bound a granted privilege should treat undefined as "use the role's
  // default envelope" — see scopesForRole in apps/api/src/public-api/scopes.ts.
  scopes?: readonly Scope[];
}

export interface ExecutorCtx {
  db: Database;
  auth: ExecutorAuth;
  requestId: string;
  idempotencyKey?: string | null;
  runMutation: (name: string, args: unknown) => Promise<void>;
}

export type Executor<C extends AnyActionContract> = (
  ctx: ExecutorCtx,
  input: ActionInput<C>,
) => Promise<ActionOutput<C>>;

export type UntypedExecutor = (ctx: ExecutorCtx, input: unknown) => Promise<unknown>;

export function asUntypedExecutor<C extends AnyActionContract>(
  executor: Executor<C>,
): UntypedExecutor {
  return (ctx, input) => executor(ctx, input as ActionInput<C>);
}
