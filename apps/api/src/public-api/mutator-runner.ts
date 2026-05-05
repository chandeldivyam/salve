import { mustGetMutator, type ReadonlyJSONValue } from '@rocicorp/zero';
import type { AuthData } from '@salve/zero-schema';
import { createServerMutators, type PostCommitTask } from '../server-mutators.js';
import { getZql } from '../zero-upstream.js';

export async function runServerMutation(
  name: string,
  args: unknown,
  authData: AuthData,
): Promise<void> {
  const postCommitTasks: PostCommitTask[] = [];
  const serverMutators = createServerMutators(postCommitTasks);

  await getZql().transaction(async (tx) => {
    const mutator = mustGetMutator(serverMutators, name);
    await mutator.fn({ tx, args: args as ReadonlyJSONValue | undefined, ctx: authData });
  });

  for (const task of postCommitTasks) {
    await task();
  }
}
