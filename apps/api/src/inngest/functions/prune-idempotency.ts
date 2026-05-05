// Daily sweep that drops `idempotency_record` rows older than 24h.
//
// `withIdempotency` (apps/api/src/public-api/middleware/idempotency-store.ts)
// inserts one row per `Idempotency-Key` per (workspaceID, actionID). Without
// pruning, the table grows unboundedly — every PAT-driven retry adds a row
// that's never read again after its 24h dedup window.
//
// The schema's `idempotency_record_created_at_idx` exists precisely to keep
// this scan cheap. We delete in a single statement; locking pressure is
// minimal because the rows being deleted are the oldest ones and not
// concurrently re-read by `withIdempotency` (which always queries by
// `(workspaceID, actionID, key)`).

import { getDb, schema } from '@opendesk/db';
import { lt } from 'drizzle-orm';
import { inngest } from '../client.js';

const DEDUP_WINDOW_HOURS = 24;

export const pruneIdempotencyRecords = inngest.createFunction(
  {
    id: 'prune-idempotency-records',
    name: 'Prune idempotency records',
    retries: 1,
    concurrency: [{ scope: 'fn', limit: 1 }],
    triggers: [{ cron: '17 3 * * *' }],
  },
  async ({ step }) => {
    return step.run('delete-stale-rows', async () => {
      const cutoff = new Date(Date.now() - DEDUP_WINDOW_HOURS * 3_600_000);
      const deleted = await getDb()
        .delete(schema.idempotencyRecord)
        .where(lt(schema.idempotencyRecord.createdAt, cutoff))
        .returning({ key: schema.idempotencyRecord.key });
      return { cutoff: cutoff.toISOString(), deleted: deleted.length };
    });
  },
);
