import type { ActionInput, ActionOutput, AnyActionContract } from '@opendesk/action-contracts';
import type { Database } from '@opendesk/db';

export type ExecutorRole = 'owner' | 'admin' | 'agent' | null;
export type ExecutorPrincipalKind = 'user' | 'service_account';

export interface ExecutorAuth {
  sub: string;
  workspaceID: string;
  role: ExecutorRole;
  principalKind: ExecutorPrincipalKind;
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
