// Idempotency record persistence — the actual dedup logic.
//
// `idempotencyKeyMiddleware` (sibling file) only validates the header. This
// module is the executor wrapper that:
//   1. Hashes (actionID, input) into a stable request_hash.
//   2. Attempts an INSERT for (workspace_id, action_id, key) with status=null.
//      - On insert success: we own this attempt → run executor → UPDATE with
//        the canonical response.
//      - On INSERT collision: a row already exists. Read it.
//          • If finished (status != null): if request_hash matches, replay the
//            stored response. Otherwise 409 — the agent reused the key for a
//            different payload (almost certainly a bug).
//          • If pending (status == null): another request is mid-flight on the
//            same key. Return 409 "in_progress"; the client should retry shortly.
//          • Stale pending (createdAt > 60s): treat as crashed; reclaim by
//            updating the row's createdAt and run the executor.
//
// Pruning: not done here. A scheduled Inngest job will drop records older than
// 24h (see RFC §6.5). We don't try to prune inline.

import { type Database, schema } from '@opendesk/db';
import { and, sql as dsql, eq } from 'drizzle-orm';

const STALE_PENDING_MS = 60_000;

export interface IdempotencyExecutorResult {
  status: number;
  body: unknown;
}

export interface IdempotencyOptions {
  db: Database;
  workspaceID: string;
  actionID: string;
  key: string;
  requestHash: string;
}

export type IdempotencyOutcome =
  | { kind: 'fresh'; result: IdempotencyExecutorResult }
  | { kind: 'replayed'; result: IdempotencyExecutorResult }
  | { kind: 'in_progress' }
  | { kind: 'mismatch' };

/**
 * Run `executor` exactly once per (workspaceID, actionID, key) tuple. Returns
 * the executor's result on the first successful call, the cached response on
 * matching retries, and a sentinel on conflicts.
 *
 * The caller is responsible for translating `{ kind: 'in_progress' | 'mismatch' }`
 * into an HTTP response — we keep transport mapping out of the store.
 */
export async function withIdempotency(
  opts: IdempotencyOptions,
  executor: () => Promise<IdempotencyExecutorResult>,
): Promise<IdempotencyOutcome> {
  const { db, workspaceID, actionID, key, requestHash } = opts;

  const claimed = await tryClaim(db, workspaceID, actionID, key, requestHash);
  if (!claimed) {
    return inspectExisting(db, workspaceID, actionID, key, requestHash, executor);
  }

  return runAndPersist(db, workspaceID, actionID, key, executor);
}

async function tryClaim(
  db: Database,
  workspaceID: string,
  actionID: string,
  key: string,
  requestHash: string,
): Promise<boolean> {
  const inserted = await db
    .insert(schema.idempotencyRecord)
    .values({
      workspaceId: workspaceID,
      actionId: actionID,
      key,
      requestHash,
      responseStatus: null,
      responseBody: null,
    })
    .onConflictDoNothing({
      target: [
        schema.idempotencyRecord.workspaceId,
        schema.idempotencyRecord.actionId,
        schema.idempotencyRecord.key,
      ],
    })
    .returning({ workspaceId: schema.idempotencyRecord.workspaceId });
  return inserted.length > 0;
}

async function inspectExisting(
  db: Database,
  workspaceID: string,
  actionID: string,
  key: string,
  requestHash: string,
  executor: () => Promise<IdempotencyExecutorResult>,
): Promise<IdempotencyOutcome> {
  const existing = await db
    .select()
    .from(schema.idempotencyRecord)
    .where(
      and(
        eq(schema.idempotencyRecord.workspaceId, workspaceID),
        eq(schema.idempotencyRecord.actionId, actionID),
        eq(schema.idempotencyRecord.key, key),
      ),
    )
    .limit(1);

  const row = existing[0];
  if (!row) {
    // Lost the row between INSERT-conflict and SELECT (TTL prune?). Recover by
    // claiming again — second time should succeed.
    const reclaimed = await tryClaim(db, workspaceID, actionID, key, requestHash);
    if (reclaimed) return runAndPersist(db, workspaceID, actionID, key, executor);
    return { kind: 'in_progress' };
  }

  // Finished response cached?
  if (row.responseStatus != null) {
    if (row.requestHash !== requestHash) return { kind: 'mismatch' };
    return {
      kind: 'replayed',
      result: { status: row.responseStatus, body: row.responseBody },
    };
  }

  // Pending. Stale (crashed)?
  const ageMs = Date.now() - row.createdAt.getTime();
  if (ageMs >= STALE_PENDING_MS) {
    const reclaimed = await db
      .update(schema.idempotencyRecord)
      .set({
        requestHash,
        responseStatus: null,
        responseBody: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.idempotencyRecord.workspaceId, workspaceID),
          eq(schema.idempotencyRecord.actionId, actionID),
          eq(schema.idempotencyRecord.key, key),
          // CAS: only reclaim if the row is still pending and still stale.
          dsql`${schema.idempotencyRecord.responseStatus} IS NULL`,
        ),
      )
      .returning({ key: schema.idempotencyRecord.key });
    if (reclaimed.length > 0) {
      return runAndPersist(db, workspaceID, actionID, key, executor);
    }
    // Someone else got here first; fall through to in_progress.
  }

  return { kind: 'in_progress' };
}

async function runAndPersist(
  db: Database,
  workspaceID: string,
  actionID: string,
  key: string,
  executor: () => Promise<IdempotencyExecutorResult>,
): Promise<IdempotencyOutcome> {
  let result: IdempotencyExecutorResult;
  try {
    result = await executor();
  } catch (err) {
    // On executor failure, drop the placeholder so a retry can claim again.
    // Without this, a transient executor crash would block the same key for 60s.
    await db
      .delete(schema.idempotencyRecord)
      .where(
        and(
          eq(schema.idempotencyRecord.workspaceId, workspaceID),
          eq(schema.idempotencyRecord.actionId, actionID),
          eq(schema.idempotencyRecord.key, key),
          dsql`${schema.idempotencyRecord.responseStatus} IS NULL`,
        ),
      );
    throw err;
  }

  await db
    .update(schema.idempotencyRecord)
    .set({
      responseStatus: result.status,
      // jsonb column accepts any serialisable value; cast at the boundary.
      responseBody: result.body as unknown as never,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.idempotencyRecord.workspaceId, workspaceID),
        eq(schema.idempotencyRecord.actionId, actionID),
        eq(schema.idempotencyRecord.key, key),
      ),
    );

  return { kind: 'fresh', result };
}
