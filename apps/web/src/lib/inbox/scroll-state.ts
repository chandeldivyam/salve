// Persisted per-view scroll state for the inbox list. Lifted out of
// inbox-list.tsx so other surfaces (notably the ticket-detail page's
// prev/next navigator) can read the same `pageLimit` and stay in sync
// with however far the user has scrolled.
//
// Storage shape (per workspace + view, JSON):
//   { offset: number, pageLimit: number }
//
// Why both fields: `offset` lets the virtualizer restore visual scroll
// position; `pageLimit` lets the Zero subscription request the same
// row window the user was looking at. Without `pageLimit` round-trip,
// the user scrolls to row 600 in the inbox, clicks a ticket, and the
// detail page's nav list silently truncates back to 200 rows — making
// prev/next gray out even though there are 400+ tickets after the
// current one.

import { INBOX_INITIAL_PAGE, MAX_INBOX_LIMIT } from '@salve/zero-schema';

export interface SavedInboxState {
  offset: number;
  pageLimit: number;
}

const SCROLL_KEY_PREFIX = 'salve.inbox.state.';

export function inboxScrollKey(workspaceID: string | null, viewID: string): string {
  return `${SCROLL_KEY_PREFIX}${workspaceID ?? 'no-workspace'}.${viewID}`;
}

export function readSavedInboxState(workspaceID: string | null, viewID: string): SavedInboxState {
  const fallback: SavedInboxState = { offset: 0, pageLimit: INBOX_INITIAL_PAGE };
  if (typeof window === 'undefined') return fallback;
  const raw = window.sessionStorage.getItem(inboxScrollKey(workspaceID, viewID));
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as Partial<SavedInboxState>;
    const offset =
      Number.isFinite(parsed.offset) && (parsed.offset ?? 0) > 0 ? Number(parsed.offset) : 0;
    // Restore pageLimit *only* when we also have a scroll offset to restore.
    // Without this, switching back to an inbox view replays whatever
    // pageLimit the user had grown the window to — even though the
    // virtualizer is at row 0 and could happily start from
    // `INBOX_INITIAL_PAGE`. A 2000-row materialization on every cold load
    // is exactly what made the inbox feel like "all tickets at once".
    // The grow-on-scroll effect still bumps the limit back up the moment
    // the user scrolls past `LOAD_MORE_THRESHOLD`.
    const savedLimit =
      Number.isFinite(parsed.pageLimit) &&
      (parsed.pageLimit ?? 0) >= INBOX_INITIAL_PAGE &&
      (parsed.pageLimit ?? 0) <= MAX_INBOX_LIMIT
        ? Number(parsed.pageLimit)
        : INBOX_INITIAL_PAGE;
    const limit = offset > 0 ? savedLimit : INBOX_INITIAL_PAGE;
    return { offset, pageLimit: limit };
  } catch {
    return fallback;
  }
}

export function writeSavedInboxState(
  workspaceID: string | null,
  viewID: string,
  state: SavedInboxState,
): void {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(inboxScrollKey(workspaceID, viewID), JSON.stringify(state));
}
