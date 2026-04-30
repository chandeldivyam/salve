// Phase 3a — outbox → Inngest bridge.
//
// Strategy B (per Phase 3a plan): short-interval poll (default 2s in dev) that
// claims unprocessed `outbox` rows of `kind='email.send'` via
// `SELECT ... FOR UPDATE SKIP LOCKED`, dispatches `email/send.requested` events
// to Inngest, and leaves the row marked-claimed (`processed_at` is updated by
// the Inngest function once the send completes — we don't update it here so
// retries past the Inngest retry budget remain visible).
//
// Idempotency: Inngest dedupes by event id. We use the outbox row id as the
// `id` so a redelivery from the poller never produces a duplicate send.
//
// TODO Phase 6: migrate to Postgres LISTEN/NOTIFY (trigger on outbox INSERT
// → NOTIFY → long-lived listener). The poll loop is fine for dev; replace
// when CPU on prod becomes a measurable cost.

import { getClient } from '@opendesk/db';
import { ZERO_OUTBOX_KIND } from '@opendesk/zero-schema';
import { inngest } from './inngest/client.js';

const DEFAULT_INTERVAL_MS = Number.parseInt(process.env.OUTBOX_POLL_INTERVAL_MS ?? '2000', 10);
const BATCH_SIZE = 25;

interface ClaimedRow {
  id: string;
  workspace_id: string;
  payload: {
    messageID?: string;
    ticketID?: string;
    customerID?: string;
  };
}

let _started = false;
let _stopRequested = false;

export function startOutboxPoller(intervalMs = DEFAULT_INTERVAL_MS): void {
  if (_started) return;
  _started = true;
  _stopRequested = false;
  console.log(`[opendesk-api] outbox-poller starting (every ${intervalMs}ms)`);
  void runLoop(intervalMs);
}

export function stopOutboxPoller(): void {
  _stopRequested = true;
}

async function runLoop(intervalMs: number): Promise<void> {
  while (!_stopRequested) {
    try {
      await tickOnce();
    } catch (err) {
      console.warn('[opendesk-api] outbox-poller tick failed', err);
    }
    await sleep(intervalMs);
  }
  _started = false;
}

async function tickOnce(): Promise<void> {
  const sql = getClient();
  // Claim rows in a single tx via FOR UPDATE SKIP LOCKED. We don't UPDATE
  // here — the Inngest function flips processed_at after a successful send.
  // (The same row will be re-selected on every tick until processed_at is
  // set, which is fine: Inngest dedupes by event id = outbox.id.)
  const rows: ClaimedRow[] = await sql<ClaimedRow[]>`
    SELECT id, workspace_id, payload
    FROM "outbox"
    WHERE "kind" = ${ZERO_OUTBOX_KIND.EMAIL_SEND}
      AND "processed_at" IS NULL
    ORDER BY "created_at" ASC
    LIMIT ${BATCH_SIZE}
    FOR UPDATE SKIP LOCKED
  `;

  if (rows.length === 0) return;

  for (const row of rows) {
    const messageID = row.payload?.messageID;
    const ticketID = row.payload?.ticketID;
    const customerID = row.payload?.customerID;
    if (!messageID || !ticketID || !customerID) {
      // Malformed payload — mark processed so we don't loop forever.
      await sql`UPDATE "outbox" SET "processed_at" = now() WHERE "id" = ${row.id}`;
      console.warn('[opendesk-api] outbox: skipping malformed email.send row', row);
      continue;
    }
    try {
      await inngest.send({
        // event id used by Inngest for natural idempotency
        id: `email-send-${row.id}`,
        name: 'email/send.requested',
        data: {
          outboxID: row.id,
          workspaceID: row.workspace_id,
          messageID,
          ticketID,
          customerID,
        },
      });
    } catch (err) {
      // Don't update processed_at on dispatch failure — next tick retries.
      console.warn(`[opendesk-api] outbox: inngest dispatch failed for ${row.id}`, err);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
