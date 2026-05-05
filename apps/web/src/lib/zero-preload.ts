// Workspace data preloads. Mirrors zbugs `src/zero-preload.ts`.
//
// Called once when `<ZeroProvider>` mounts (see `routes/app.tsx`) so the
// inbox + every metadata query the agent will need is fetched eagerly into
// IndexedDB. Without this, the first navigation into /app/inbox kicks off a
// cold query and the user sees a loading flash. With this, the queries are
// already warm by the time the inbox component mounts.
//
// `z.preload(query, options)` returns `{ cleanup, complete }`. The
// subscription stays alive until `cleanup()` is called. The returned
// composite cleanup releases all underlying subscriptions at once.

import { INBOX_INITIAL_PAGE, queries } from '@salve/zero-schema';
import { CACHE_PRELOAD } from './zero-cache';

// Phase 40 default-view warm-up: the inbox now subscribes to
// `ticketsForView` keyed on the active view's id + filters. Match the
// `builtin:all` shape exactly so the preload pipeline is the same one
// `<InboxList>` later subscribes to. If the agent lands on a different
// view, that one's subscription opens cold — acceptable since the
// view-strip pills are bounded and most agents start at All open.
const DEFAULT_BUILTIN_ALL: {
  viewID: string;
  viewQuery: { filters: unknown[]; matchAll?: boolean };
  sort: { field: string; direction: 'asc' | 'desc' };
  limit: number;
} = {
  viewID: 'builtin:all',
  viewQuery: {
    filters: [{ field: 'status', operator: 'in', values: ['open', 'in_progress', 'snoozed'] }],
    matchAll: true,
  },
  sort: { field: 'updatedAt', direction: 'desc' },
  limit: INBOX_INITIAL_PAGE,
};

interface PreloadHandle {
  cleanup: () => void;
  complete: Promise<void>;
}

// biome-ignore lint/suspicious/noExplicitAny: zero's preload signature is generic
type ZeroLike = { preload: (q: any, opts?: any) => PreloadHandle };

/**
 * Preload everything an authenticated agent will touch in the first ~5
 * seconds: the open inbox, workspace members (assignee picker), sendable
 * email addresses (composer from-picker), tags + custom fields metadata.
 *
 * Returns a cleanup that releases all underlying subscriptions. Wire it to
 * a `useEffect` cleanup in the route component that owns the lifetime.
 */
export function preloadWorkspace(z: ZeroLike): () => void {
  const handles: PreloadHandle[] = [
    z.preload(queries.ticketsForView(DEFAULT_BUILTIN_ALL), CACHE_PRELOAD),
    z.preload(queries.views(), CACHE_PRELOAD),
    z.preload(queries.builtinViewMembers(), CACHE_PRELOAD),
    z.preload(queries.workspaceMembers(), CACHE_PRELOAD),
    z.preload(queries.sendableEmailAddresses(), CACHE_PRELOAD),
    z.preload(queries.receivableEmailAddresses(), CACHE_PRELOAD),
    z.preload(queries.tags(), CACHE_PRELOAD),
    z.preload(queries.tagGroups(), CACHE_PRELOAD),
    z.preload(queries.sendingDomains(), CACHE_PRELOAD),
  ];
  return () => {
    for (const h of handles) h.cleanup();
  };
}
