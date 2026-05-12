// Ticket-detail data preload — used by `WorkbenchLink` to warm the
// `ticketAnchor` query in IndexedDB while the user is still hovering an
// inbox row. By the time they click, the conversation is already local
// and `useQuery` returns synchronously — no skeleton, no WS round-trip.
//
// Why this is its own module:
//   * A module-level LRU caps the number of concurrent preloads so a
//     fast cursor-sweep across the inbox can't open hundreds of Zero
//     subscriptions at once.
//   * Multiple links to the same ticket (e.g. an inbox row + a
//     left-rail "recents" entry) share a single underlying preload via
//     ref counting.
//
// Counterpart: the workspace-wide warm-up in `zero-preload.ts` (which
// covers list rows + metadata, but not per-ticket conversations).

import { queries } from '@salve/zero-schema';
import { CACHE_NAV } from './zero-cache';

interface PreloadHandle {
  cleanup: () => void;
  complete: Promise<void>;
}

// biome-ignore lint/suspicious/noExplicitAny: zero's preload signature is generic
type ZeroLike = { preload: (q: any, opts?: any) => PreloadHandle };

// Cap concurrent hover-preloads. Each entry holds one Zero subscription
// alive in IndexedDB. 8 is generous (covers a full visible inbox screen)
// but bounded enough that a runaway cursor can't flood the WS link.
const MAX_ACTIVE_PRELOADS = 8;

interface Entry {
  handle: PreloadHandle;
  refCount: number;
}

const active = new Map<string, Entry>();

// biome-ignore lint/suspicious/noExplicitAny: queries catalog is augmented at runtime in some builds
const ticketAnchor = (queries as any).ticketAnchor as
  | ((args: { id: string; messageLimit?: number; activityLimit?: number }) => unknown)
  | undefined;

/**
 * Acquire a preload subscription for the given ticket. Returns a release
 * function — call it once you no longer need the data warm (e.g. when
 * the user moves the cursor off the row + a grace period elapses).
 *
 * Safe to call repeatedly: subsequent calls reuse the existing handle
 * and bump a refcount. Eviction is LRU-by-insertion-order; the oldest
 * non-referenced handle is cleaned up when the cap is hit.
 */
export function acquireTicketPreload(z: ZeroLike, ticketID: string): () => void {
  let entry = active.get(ticketID);
  if (entry) {
    entry.refCount++;
    // Refresh LRU position so frequently-hovered tickets aren't evicted.
    active.delete(ticketID);
    active.set(ticketID, entry);
  } else {
    if (active.size >= MAX_ACTIVE_PRELOADS) {
      const firstKey = active.keys().next().value as string | undefined;
      if (firstKey !== undefined) {
        const victim = active.get(firstKey);
        active.delete(firstKey);
        victim?.handle.cleanup();
      }
    }
    const q = ticketAnchor
      ? ticketAnchor({ id: ticketID, messageLimit: 51, activityLimit: 51 })
      : queries.ticketByID({ id: ticketID });
    const handle = z.preload(q, CACHE_NAV);
    entry = { handle, refCount: 1 };
    active.set(ticketID, entry);
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const current = active.get(ticketID);
    if (!current) return;
    current.refCount--;
    if (current.refCount <= 0) {
      active.delete(ticketID);
      current.handle.cleanup();
    }
  };
}

/**
 * Extract the ticket id from a workbench href like
 * `/app/inbox/t/abc123?view=...`. Returns null for non-ticket hrefs.
 */
export function extractTicketIDFromHref(href: string): string | null {
  const match = href.match(/^\/app\/inbox\/t\/([^/?#]+)/);
  return match?.[1] ?? null;
}
