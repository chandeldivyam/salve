// Outbox enqueue helper.
//
// Phase 2b: writes a single row to the `outbox` table inside whatever
// transaction the caller passes. The row sits there until Phase 3 wires the
// Inngest dispatcher (Postgres LISTEN/NOTIFY → Inngest event). For 2b the
// existence of the row is the entire test surface — `verification step 8`
// counts unprocessed rows.
//
// Wire pattern:
//   - server-mutator wrapper has access to the postgres.js transaction via
//     `tx.dbTransaction.wrappedTransaction` (see Zero's postgresjs adapter).
//   - we INSERT through that wrapped transaction so the outbox row commits
//     atomically with the domain rows the mutator wrote.
//
// TODO(phase-3): Inngest dispatcher reads `outbox WHERE processed_at IS NULL`
// via SELECT ... FOR UPDATE SKIP LOCKED + Postgres LISTEN/NOTIFY trigger.

import type postgres from 'postgres';

// JSON-serialisable payload. We don't import Zero's `ReadonlyJSONValue` here
// because it's structural (nested) and the postgres.js `sql.json()` helper
// just needs JSON-coercible input.
export type OutboxPayload =
  | string
  | number
  | boolean
  | null
  | { readonly [k: string]: OutboxPayload | undefined }
  | readonly OutboxPayload[];

export interface EnqueueOutboxArgs {
  workspaceID: string;
  kind: string;
  payload: OutboxPayload;
}

/**
 * Insert a single outbox row inside an active postgres.js transaction.
 *
 * Designed to be called from the Zero server-mutator wrapper:
 *
 * ```ts
 * await enqueueOutbox(tx.dbTransaction.wrappedTransaction, {
 *   workspaceID: auth.workspaceID,
 *   kind: 'email.send',
 *   payload: { messageID, ticketID },
 * });
 * ```
 */
export async function enqueueOutbox(
  sql: postgres.TransactionSql,
  { workspaceID, kind, payload }: EnqueueOutboxArgs,
): Promise<void> {
  await sql`
    INSERT INTO "outbox" ("workspace_id", "kind", "payload")
    VALUES (${workspaceID}, ${kind}, ${sql.json(payload)})
  `;
}
