// Phase 2c inbox list — Linear-tight, virtualized, keyboard-driven.
//
// Reads `inboxOpen` (workspace-scoped) with a growing window for infinite
// scroll, applies `filter` + `search` client-side, and renders rows from
// IndexedDB immediately on mount so a hard reload never flashes a loading
// state. The query is paged: initial limit `INITIAL_PAGE`, grown by
// `PAGE_GROWTH` whenever the user scrolls within `LOAD_MORE_THRESHOLD` of
// the bottom. Mirrors zbugs `issueListV2` cursor pattern in spirit (limit
// instead of cursor, since Zero already de-duplicates an expanded window
// efficiently).
//
// Phase 2 multi-select: bulk selection state is kept in
// `lib/inbox-selection.ts` (Zustand, transient — no persist) so the
// command palette can read it. Per-row state used by InboxRow is wired
// down via props to keep the row component dumb.

import { mutators } from '@opendesk/mutators';
import { Button, cn, Input, Tooltip, TooltipContent, TooltipTrigger } from '@opendesk/ui';
import { type InboxRow as InboxRowData, queries } from '@opendesk/zero-schema';
import { useQuery } from '@rocicorp/zero/react';
import { Link, useNavigate, useRouteContext } from '@tanstack/react-router';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowRight, Filter, Inbox, ListChecks, Search } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { BulkActionBar } from '@/components/inbox/bulk-action-bar';
import { InboxRow } from '@/components/inbox/inbox-row';
import { useInboxSelectionStore } from '@/lib/inbox-selection';
import { useSetupProgress } from '@/lib/setup-progress';
import { isMod, useShortcut } from '@/lib/shortcuts';
import { useZero } from '@/lib/zero';
import { CACHE_FOREVER } from '@/lib/zero-cache';
import { InboxListSkeleton } from './skeletons';

type InboxFilter = 'all' | 'unassigned' | 'mine' | 'resolved';

interface InboxListProps {
  selectedTicketID: string | null;
  currentUserID: string;
}

const FILTERS: Array<{ id: InboxFilter; label: string }> = [
  { id: 'all', label: 'All open' },
  { id: 'unassigned', label: 'Unassigned' },
  { id: 'mine', label: 'Mine' },
  { id: 'resolved', label: 'Resolved' },
];

// Pagination knobs. Initial page mirrors the zbugs `issueListV2` window
// (small enough to render quickly on a cold IDB), growth doubles until we
// hit MAX_INBOX_LIMIT in the schema (2000). Most workspaces never grow
// past the initial page.
const INITIAL_PAGE = 200;
const PAGE_GROWTH = 200;
const PAGE_CEILING = 2000;
const LOAD_MORE_THRESHOLD = 16; // grow when within this many rows of the bottom

const ROW_HEIGHT = 44;

export function InboxList({ selectedTicketID, currentUserID }: InboxListProps) {
  const navigate = useNavigate();
  const z = useZero();
  const ctx = useRouteContext({ from: '/app' }) as {
    session: { session: { activeOrganizationId: string | null } };
  };
  const workspaceID = ctx.session.session.activeOrganizationId ?? null;
  const setupProgress = useSetupProgress(workspaceID);
  const [pageLimit, setPageLimit] = useState(INITIAL_PAGE);
  // CACHE_FOREVER (10m) so the inbox hydrates from IDB before the first
  // render after a hard reload. Without this, a fresh mount has nothing
  // to show until the server replies and the UI flashes a loading state.
  const [tickets, status] = useQuery(queries.inboxOpen({ limit: pageLimit }), CACHE_FOREVER);
  const ready = status?.type === 'complete';
  const [filter, setFilter] = useState<InboxFilter>('all');
  const [search, setSearch] = useState('');

  // Bulk selection (transient — see lib/inbox-selection.ts).
  const selectionIds = useInboxSelectionStore((s) => s.ids);
  const setSelectionWorkspace = useInboxSelectionStore((s) => s.setWorkspace);
  const setMany = useInboxSelectionStore((s) => s.setMany);
  const clearSelection = useInboxSelectionStore((s) => s.clear);
  const toggleOne = useInboxSelectionStore((s) => s.toggle);
  const setLastToggledIndex = useInboxSelectionStore((s) => s.setLastToggledIndex);
  const lastToggledIndex = useInboxSelectionStore((s) => s.lastToggledIndex);
  const selectionSet = useMemo(() => new Set(selectionIds), [selectionIds]);
  const hasSelection = selectionIds.length > 0;

  // Reset selection on workspace change (and on mount). The store keys by
  // workspaceID and clears its own state when it changes.
  useEffect(() => {
    setSelectionWorkspace(workspaceID);
  }, [workspaceID, setSelectionWorkspace]);

  // Drop selection on filter / search change so the bar's count stays
  // honest (selection refers to ids, not indices, but the user's mental
  // model is "this list" — switching the list resets the operation).
  // Tracked via a ref so biome's exhaustive-deps rule sees a single
  // legitimate dep (`clearSelection`).
  const lastFilterRef = useRef<string>(`${filter}\u0000${search}`);
  useEffect(() => {
    const next = `${filter}\u0000${search}`;
    if (lastFilterRef.current !== next) {
      lastFilterRef.current = next;
      clearSelection();
    }
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tickets.filter((t: InboxRowData) => {
      // status filter
      if (filter === 'unassigned' && t.assigneeID) return false;
      if (filter === 'mine' && t.assigneeID !== currentUserID) return false;
      if (filter === 'resolved') {
        if (t.status !== 'resolved' && t.status !== 'closed') return false;
      } else if (t.status === 'resolved' || t.status === 'closed') {
        // The default `inboxOpen` query already excludes resolved/closed —
        // this branch is a defence in depth in case the query changes.
        return false;
      }
      if (!q) return true;
      return (
        t.title.toLowerCase().includes(q) ||
        (t.customer?.email?.toLowerCase().includes(q) ?? false) ||
        (t.customer?.name?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [tickets, filter, search, currentUserID]);

  // Selected index based on URL — keeps J/K + selected highlight in sync
  // with the actual route param. With push-nav the list is hidden when a
  // ticket is open, but selection still drives j/k starting position.
  const selectedIndex = useMemo(() => {
    if (!selectedTicketID) return -1;
    return filtered.findIndex((t) => t.id === selectedTicketID);
  }, [filtered, selectedTicketID]);

  const parentRef = useRef<HTMLDivElement | null>(null);
  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  // Scroll restoration: when a row is clicked, the list unmounts (push-nav).
  // Capture parentRef.current.scrollTop into sessionStorage on row click and
  // on unmount; restore it on mount. Keyed per-workspace.
  const scrollKey = useMemo(
    () => `opendesk.inbox.scroll.${workspaceID ?? 'no-workspace'}`,
    [workspaceID],
  );
  const restoredRef = useRef(false);

  useLayoutEffect(() => {
    if (restoredRef.current) return;
    if (typeof window === 'undefined') return;
    const node = parentRef.current;
    if (!node) return;
    const raw = window.sessionStorage.getItem(scrollKey);
    if (!raw) return;
    const saved = Number.parseInt(raw, 10);
    if (!Number.isFinite(saved) || saved <= 0) return;
    // Defer until the virtualizer has measured at least once so its
    // scrollHeight reflects the rendered rows; otherwise setting scrollTop
    // gets clamped to 0.
    const total = virtualizer.getTotalSize();
    if (total > 0 && saved < total) {
      node.scrollTop = saved;
      restoredRef.current = true;
    } else if (total > 0) {
      // total exists but saved is past the end → clear stale value.
      restoredRef.current = true;
    }
  });

  function captureScroll() {
    if (typeof window === 'undefined') return;
    const node = parentRef.current;
    if (!node) return;
    window.sessionStorage.setItem(scrollKey, String(node.scrollTop));
  }

  // Capture on unmount as a safety net (covers j/k navigation that doesn't
  // run a click handler). Reads parentRef + scrollKey at unmount time.
  useEffect(() => {
    return () => {
      if (typeof window === 'undefined') return;
      const node = parentRef.current;
      if (!node) return;
      window.sessionStorage.setItem(scrollKey, String(node.scrollTop));
    };
  }, [scrollKey]);

  // J/K + arrow keys for keyboard navigation. E archives (close mutator).
  // `useShortcut` centralises the "skip while typing" gate (lib/shortcuts).
  const goToIndex = useCallback(
    (idx: number) => {
      const t = filtered[idx];
      if (!t) return;
      // Persist current scroll so the list can restore on return.
      if (typeof window !== 'undefined' && parentRef.current) {
        window.sessionStorage.setItem(scrollKey, String(parentRef.current.scrollTop));
      }
      navigate({ to: '/app/inbox/t/$ticketId', params: { ticketId: t.id } });
    },
    [filtered, navigate, scrollKey],
  );
  const cur = selectedIndex < 0 ? 0 : selectedIndex;
  useShortcut(['j', 'ArrowDown'], () => {
    if (filtered.length === 0) return;
    goToIndex(Math.min(filtered.length - 1, cur + 1));
  });
  useShortcut(['k', 'ArrowUp'], () => {
    if (filtered.length === 0) return;
    goToIndex(Math.max(0, cur - 1));
  });
  useShortcut('Enter', () => {
    if (filtered.length > 0) goToIndex(cur);
  });
  useShortcut(['e', 'E'], () => {
    const t = filtered[cur];
    if (t) z.mutate(mutators.ticket.close({ id: t.id }));
  });

  // Selection toggling. Range mode looks up the indexes in the *current*
  // filtered list — not the underlying ticket array — because that's the
  // user's mental model. Selection survives sort/order changes since it's
  // ID-based, but range bounds are recomputed each call.
  const toggleSelection = useCallback(
    (id: string, opts: { shiftRange?: boolean }) => {
      const idx = filtered.findIndex((t) => t.id === id);
      if (idx < 0) return;
      if (opts.shiftRange && lastToggledIndex !== null) {
        const start = Math.min(lastToggledIndex, idx);
        const end = Math.max(lastToggledIndex, idx);
        const rangeIDs = filtered.slice(start, end + 1).map((t) => t.id);
        // Union with existing selection so shift-click extends rather than
        // replaces — matches Linear / macOS Finder semantics.
        const next = Array.from(new Set([...selectionIds, ...rangeIDs]));
        setMany(next);
      } else {
        toggleOne(id);
      }
      setLastToggledIndex(idx);
    },
    [filtered, lastToggledIndex, selectionIds, setMany, toggleOne, setLastToggledIndex],
  );

  // `x` toggles selection on the current j/k cursor row.
  useShortcut(['x', 'X'], () => {
    const t = filtered[cur];
    if (!t) return;
    toggleSelection(t.id, { shiftRange: false });
  });

  // Esc clears selection — but only when a selection exists, so it falls
  // through to BackToInbox / other Esc handlers when there's nothing to clear.
  useShortcut(
    'Escape',
    (event) => {
      if (selectionIds.length === 0) return;
      event.stopPropagation();
      clearSelection();
    },
    { preventDefault: false, enabled: hasSelection },
  );

  // Cmd/Ctrl + A selects all visible (filtered) rows.
  useShortcut(
    'a',
    (event) => {
      if (!isMod(event)) return;
      event.preventDefault();
      setMany(filtered.map((t) => t.id));
      setLastToggledIndex(filtered.length > 0 ? 0 : null);
    },
    { preventDefault: false },
  );

  // Infinite scroll — when the last virtualized row index is within
  // LOAD_MORE_THRESHOLD of the end, grow the query window. Capped at
  // PAGE_CEILING (also enforced server-side via MAX_INBOX_LIMIT in the
  // schema). Done via the virtualizer's reported items so we don't have
  // to attach our own scroll listener.
  const virtualItems = virtualizer.getVirtualItems();
  const lastVirtualIndex = virtualItems[virtualItems.length - 1]?.index ?? 0;
  useEffect(() => {
    if (!ready) return;
    if (tickets.length < pageLimit) return; // server has fewer rows than the cap → fully loaded
    if (pageLimit >= PAGE_CEILING) return;
    if (filtered.length - lastVirtualIndex <= LOAD_MORE_THRESHOLD) {
      setPageLimit((p) => Math.min(PAGE_CEILING, p + PAGE_GROWTH));
    }
  }, [ready, tickets.length, pageLimit, filtered.length, lastVirtualIndex]);

  async function onCreateSampleTicket() {
    const samples = [
      {
        title: 'Where is my refund?',
        priority: 'high' as const,
        customerEmail: 'amelia@northwind.com',
        customerName: 'Amelia Hart',
      },
      {
        title: 'Cannot connect Slack integration',
        priority: 'normal' as const,
        customerEmail: 'priya@acme.io',
        customerName: 'Priya Shah',
      },
      {
        title: 'Feature request: keyboard shortcut for snooze',
        priority: 'low' as const,
        customerEmail: 'leo@cobalt.dev',
        customerName: 'Leo Park',
      },
    ];
    for (const s of samples) {
      await z.mutate(
        mutators.ticket.create({
          id: crypto.randomUUID(),
          ...s,
        }),
      );
    }
  }

  return (
    <div className="flex h-full w-full flex-col bg-surface">
      <div className="flex shrink-0 flex-col gap-2 border-b border-border px-3 py-2.5">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search title or customer…"
              className="h-9 pl-8 text-sm"
            />
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="Filters"
                className="grid h-9 w-9 place-items-center rounded-md border border-border text-muted-foreground hover:bg-surface-muted"
              >
                <Filter className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Filters (placeholder)</TooltipContent>
          </Tooltip>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={cn(
                'rounded-md px-2 py-1 text-xs font-medium transition-colors',
                filter === f.id
                  ? 'bg-brand-soft text-brand-soft-foreground ring-1 ring-brand-border'
                  : 'text-muted-foreground hover:bg-surface-muted',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="relative flex-1 overflow-hidden">
        <div ref={parentRef} className="h-full overflow-y-auto" onClickCapture={captureScroll}>
          {/*
           * Render order matters here:
           *   1. tickets present → render the list (covers both "live data"
           *      and "IDB cache from a previous mount", so reload never
           *      flashes a loading state).
           *   2. server confirmed empty + matches the empty filter → empty state.
           *   3. server hasn't responded yet → skeleton at the row shape.
           * Gating purely on `ready` (zbugs `ticketStatus.type === 'complete'`)
           * was the source of the previous loading flash on every mount.
           */}
          {filtered.length === 0 && !ready ? (
            <InboxListSkeleton />
          ) : filtered.length === 0 ? (
            <EmptyInbox
              showSampleCreate={tickets.length === 0 && filter === 'all' && search === ''}
              onCreate={onCreateSampleTicket}
              setup={setupProgress}
            />
          ) : (
            <div
              style={{
                height: virtualizer.getTotalSize(),
                width: '100%',
                position: 'relative',
              }}
            >
              {virtualizer.getVirtualItems().map((vi) => {
                const t = filtered[vi.index];
                if (!t) return null;
                const isSelected = t.id === selectedTicketID;
                const multiSelected = selectionSet.has(t.id);
                return (
                  <div
                    key={t.id}
                    data-testid="inbox-row"
                    data-selected={isSelected ? 'true' : 'false'}
                    data-multi-selected={multiSelected ? 'true' : 'false'}
                    ref={virtualizer.measureElement}
                    data-index={vi.index}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      right: 0,
                      transform: `translateY(${vi.start}px)`,
                    }}
                  >
                    <InboxRow
                      ticket={t}
                      isSelected={isSelected}
                      multiSelected={multiSelected}
                      showCheckbox={hasSelection}
                      onToggleSelect={toggleSelection}
                      onNavigate={clearSelection}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <BulkActionBar currentUserID={currentUserID} />
      </div>
    </div>
  );
}

function EmptyInbox({
  showSampleCreate,
  onCreate,
  setup,
}: {
  showSampleCreate: boolean;
  onCreate: () => void;
  setup: ReturnType<typeof useSetupProgress>;
}) {
  const isDev = import.meta.env.DEV;
  const promoteSetup = setup.ready && !setup.isComplete && !setup.dismissed;
  const nextItem = setup.items.find((item) => !item.completed);

  if (promoteSetup) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-8 py-12 text-center">
        <div className="grid h-12 w-12 place-items-center rounded-full bg-brand-soft text-brand-soft-foreground ring-1 ring-brand-border">
          <ListChecks className="h-6 w-6" />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">Set up your inbox</p>
          <p className="text-xs text-muted-foreground">
            {setup.completedCount} of {setup.total} complete
            {nextItem ? ` · Next: ${NEXT_LABEL[nextItem.id]}` : ''}
          </p>
        </div>
        <Button asChild size="sm">
          <Link to="/app/settings/setup">
            Continue setup <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </Button>
        {isDev && showSampleCreate ? (
          <button
            type="button"
            onClick={onCreate}
            className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            Dev: create sample tickets
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-8 py-12 text-center">
      <div className="grid h-12 w-12 place-items-center rounded-full bg-brand-soft text-brand-soft-foreground">
        <Inbox className="h-6 w-6" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">Your inbox is empty</p>
        <p className="text-xs text-muted-foreground">Replies will appear here.</p>
      </div>
      {isDev && showSampleCreate ? (
        <button
          type="button"
          onClick={onCreate}
          className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          Dev: create sample tickets
        </button>
      ) : null}
    </div>
  );
}

const NEXT_LABEL: Record<ReturnType<typeof useSetupProgress>['items'][number]['id'], string> = {
  workspace: 'create your workspace',
  domain: 'add a sending domain',
  dnsVerified: 'verify DNS',
  address: 'create a support address',
  routing: 'configure routing',
  firstMessage: 'receive your first message',
  invite: 'invite a teammate',
};
