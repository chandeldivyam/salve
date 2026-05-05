// Bulk-action runner. Fans out single mutators in a `Promise.all` (the
// "option 1" strategy from `docs/port/50-bulk-actions-and-soft-delete.md`).
// A dedicated bulk mutator suite is planned but blocked on the schema
// changes outlined in that doc — for now we lean on the existing
// per-ticket mutators.
//
// Why a separate module: both `bulk-action-bar.tsx` and
// `workbench/command-palette.tsx` need to fire the same actions. Keeping
// the logic here means the palette's bulk section is a thin shim over the
// same calls the bar uses.

import { mutators } from '@salve/mutators';
import { showError, showSuccess } from '@/lib/feedback';
import type { useZero } from '@/lib/zero';

type ZeroClient = ReturnType<typeof useZero>;

// Shape of `z.mutate(...)`'s return. Defined inline because @rocicorp/zero
// 1.3 doesn't re-export `MutatorResult` from the package root; mirrors
// `node_modules/@rocicorp/zero/.../custom.d.ts:38-41`.
type ZMutatorResult = {
  client: Promise<{ readonly type: 'success' } | { readonly type: 'error' }>;
  server: Promise<{ readonly type: 'success' } | { readonly type: 'error' }>;
};

export type BulkStatus = 'open' | 'in_progress' | 'snoozed' | 'resolved' | 'closed';
export type BulkPriority = 'urgent' | 'high' | 'normal' | 'low';

interface RunOptions {
  ids: ReadonlyArray<string>;
  z: ZeroClient;
  /** Cleared on success; not on failure. */
  onSuccess?: () => void;
}

const SNOOZE_24H_MS = 24 * 60 * 60 * 1000;

function pluralize(count: number, singular: string, plural?: string): string {
  return `${count} ${count === 1 ? singular : (plural ?? `${singular}s`)}`;
}

/**
 * `z.mutate(...)` returns `{ client, server }` with two awaitable promises
 * (see `node_modules/@rocicorp/zero/.../custom.d.ts:38-41`). We wait on
 * `client` so the optimistic write has applied locally before reporting
 * success — matches zbugs `use-user-pref.ts:16` and
 * `issue-page.tsx:388`. Server errors still surface via Zero's rollback
 * path and the global feedback toast.
 */
async function runAll(promises: Array<ZMutatorResult>): Promise<{ ok: number; fail: number }> {
  const results = await Promise.allSettled(promises.map((p) => p.client));
  let ok = 0;
  let fail = 0;
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value.type === 'success') ok++;
    else fail++;
  }
  return { ok, fail };
}

function reportOutcome(
  { ok, fail }: { ok: number; fail: number },
  successCopy: (n: number) => string,
  noun = 'ticket',
) {
  if (fail === 0) {
    showSuccess(successCopy(ok));
    return true;
  }
  showError(
    new Error(
      `${pluralize(fail, noun)} failed${ok > 0 ? `; ${pluralize(ok, noun)} updated` : ''}.`,
    ),
    'Bulk action partially failed',
  );
  return false;
}

export async function bulkAssign({ ids, z, onSuccess }: RunOptions, assigneeID: string | null) {
  if (ids.length === 0) return;
  const result = await runAll(
    ids.map((id) => z.mutate(mutators.ticket.assign({ id, assigneeID }))),
  );
  const ok = reportOutcome(result, (n) =>
    assigneeID ? `Assigned ${pluralize(n, 'ticket')}` : `Unassigned ${pluralize(n, 'ticket')}`,
  );
  if (ok) onSuccess?.();
}

export async function bulkSetStatus({ ids, z, onSuccess }: RunOptions, status: BulkStatus) {
  if (ids.length === 0) return;
  // `mutators.ticket.update` does not yet accept `status` (Phase 4 todo per
  // the existing single-ticket code in `inbox.t.$ticketId.tsx:setStatus`).
  // Mirror the same close/reopen/snooze fallbacks here so behaviour stays
  // consistent.
  const promises: Array<ZMutatorResult> = ids.map((id) => {
    if (status === 'closed' || status === 'resolved') {
      return z.mutate(mutators.ticket.close({ id }));
    }
    if (status === 'open' || status === 'in_progress') {
      return z.mutate(mutators.ticket.reopen({ id }));
    }
    return z.mutate(mutators.ticket.snooze({ id, until: Date.now() + SNOOZE_24H_MS }));
  });
  const result = await runAll(promises);
  const ok = reportOutcome(result, (n) => `Set status on ${pluralize(n, 'ticket')}`);
  if (ok) onSuccess?.();
}

export async function bulkSetPriority({ ids, z, onSuccess }: RunOptions, priority: BulkPriority) {
  if (ids.length === 0) return;
  const result = await runAll(ids.map((id) => z.mutate(mutators.ticket.update({ id, priority }))));
  const ok = reportOutcome(result, (n) => `Set priority on ${pluralize(n, 'ticket')}`);
  if (ok) onSuccess?.();
}

export async function bulkSnooze24h({ ids, z, onSuccess }: RunOptions) {
  if (ids.length === 0) return;
  const until = Date.now() + SNOOZE_24H_MS;
  const result = await runAll(ids.map((id) => z.mutate(mutators.ticket.snooze({ id, until }))));
  const ok = reportOutcome(result, (n) => `Snoozed ${pluralize(n, 'ticket')}`);
  if (ok) onSuccess?.();
}

export async function bulkClose({ ids, z, onSuccess }: RunOptions) {
  if (ids.length === 0) return;
  const result = await runAll(ids.map((id) => z.mutate(mutators.ticket.close({ id }))));
  const ok = reportOutcome(result, (n) => `Closed ${pluralize(n, 'ticket')}`);
  if (ok) onSuccess?.();
}
